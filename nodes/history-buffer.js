module.exports = function(RED) {
    const fs = require('fs');
    const path = require('path');
    const readline = require('readline');
    const utils = require('./utils')(RED);

    function HistoryBufferNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.name = config.name;
        node.bufferHours = parseFloat(config.bufferHours) || 3;

        // Validate configuration
        if (isNaN(node.bufferHours) || node.bufferHours < 0.01 || node.bufferHours > 24) {
            node.bufferHours = 3;
        }

        // Constants
        const TRENDS_DIR = getTrendsDirPath();
        // Use node ID in filename to prevent collisions between multiple history nodes
        const BUFFER_FILE = path.join(TRENDS_DIR, `buffer_${node.id}.json`);
        // Legacy file path for migration
        const LEGACY_BUFFER_FILE = path.join(TRENDS_DIR, 'buffer_current.json');
        
        const COMMIT_INTERVAL_MS = 30 * 1000;  // 30 seconds
        const PRUNE_INTERVAL_MS = 60 * 1000;   // 60 seconds
        const STARTUP_DELAY_MS = 5000;         // 5 seconds before loading history
        const MAX_BUFFER_AGE_MS = node.bufferHours * 3600 * 1000;

        // State
        let liveBuffer = [];                    // Accumulate points since last commit to BUFFER_FILE
        let commitTimer = null;
        let pruneTimer = null;
        let messageCount = 0;
        let cachedChunkCount = 0;               // Cached count of historical files
        let isInitializing = true;              // Flag: initialization in progress
        let queuedMessages = [];                // Queue messages during initialization
        
        // Status throttling
        let lastStatusUpdate = 0;

        utils.setStatusOK(node, `ready, buffer: ${node.bufferHours}h`);

        // =====================================================================
        // Directory Helper
        // =====================================================================
        function getTrendsDirPath() {
            const userDir = RED.settings.userDir || 
                           process.env.NODE_RED_HOME ||
                           path.join(require('os').homedir(), '.node-red');
            return path.join(userDir, '.bldgblocks', 'trends');
        }

        // =====================================================================
        // Initialize from files on startup (Async/Streaming)
        // =====================================================================
        async function initializeFromFiles() {
            // 1. Ensure directory exists
            try {
                await fs.promises.mkdir(TRENDS_DIR, { recursive: true });
            } catch (err) {
                node.error(`Failed to create trends directory: ${err.message}`);
                return;
            }

            // 2. Rotate/Migrate buffers
            // Only rotate if they are "stale" (from a previous hour), otherwise append to them.
            await rotateStartupBuffers();

            // 3. Find and filter valid trend files
            const historicalFiles = await getHistoricalFiles();

            const validFiles = historicalFiles.filter(fileName => {
                // Filename format: trend_TIMESTAMP_NODEID.json
                // We split by '_' and take index 1.
                const parts = fileName.split('_');
                const timestamp = parseInt(parts[1]);
                if (isNaN(timestamp)) return false;

                // Simple check: is the file from within our retention window?
                // Timestamp in filename is the time of rotation (end of that file's period)
                const ageMs = Date.now() - (timestamp * 1000);
                return ageMs <= MAX_BUFFER_AGE_MS + (3600 * 1000); // Add 1h grace period
            });

            updateStatus(`loading ${validFiles.length} files...`, true);

            // 4. Stream load all data into memory for the chart
            // We load into a single array because the Chart node needs a 'replace' action with full dataset.
            // Streaming happens file-by-line to avoid loading full file string content into RAM.
            let allHistory = [];

            // 4a. Load Trend Files
            for (let i = 0; i < validFiles.length; i++) {
                const filePath = path.join(TRENDS_DIR, validFiles[i]);
                try {
                    await streamLoadFile(filePath, allHistory);
                } catch (err) {
                    node.warn(`Failed to process ${validFiles[i]}: ${err.message}`);
                }
                
                if (i % 2 === 0) updateStatus(`loading ${i + 1}/${validFiles.length}...`);
            }

    
            // 4b. Load Active Buffer (if it wasn't rotated)
            try {
                await fs.promises.access(BUFFER_FILE);
                await streamLoadFile(BUFFER_FILE, allHistory);
            } catch (err) {
                // No active buffer, that's fine
            }

            // 5. Finalize setup
            finalizeAndSend(allHistory, validFiles.length);
        }

        async function rotateStartupBuffers() {
            const now = new Date();
            const currentTimestamp = Math.floor(now.getTime() / 1000);

            // Check for this node's specific buffer
            try {
                const stats = await fs.promises.stat(BUFFER_FILE);
                const fileModifiedTime = new Date(stats.mtime);
                
                // Rotation Logic:
                // If the file is from a different hour than NOW, it is "stale" and should be rotated.
                // If it is from current hour, keep it active (resume appending). 
                // This prevents creating many small files on repeated reboots.
                const isStale = (fileModifiedTime.getHours() !== now.getHours()) || 
                                (now.getTime() - stats.mtimeMs > 3600 * 1000 * 1.5); // Safety: > 1.5h old

                if (isStale) {
                    const fileTs = Math.floor(stats.mtimeMs / 1000);
                    const newName = path.join(TRENDS_DIR, `trend_${fileTs}_${node.id}.json`);
                    await fs.promises.rename(BUFFER_FILE, newName);
                }

            } catch (err) {
                // File likely doesn't exist, ignore
            }

            // Check for legacy buffer (migration)
            try {
                await fs.promises.access(LEGACY_BUFFER_FILE);
                const legacyName = path.join(TRENDS_DIR, `trend_${currentTimestamp}_legacy.json`);
                await fs.promises.rename(LEGACY_BUFFER_FILE, legacyName);
            } catch (err) {
                // Ignore
            }
        }

        async function getHistoricalFiles() {
            try {
                const files = await fs.promises.readdir(TRENDS_DIR);
                // Filter for our files: trend_TIMESTAMP_*.json
                return files
                    .filter(f => f.startsWith('trend_') && f.endsWith('.json'))
                    .sort(); // String sort works for fixed-length timestamps usually, but numeric would be safer
            } catch (err) {
                return [];
            }
        }

        function streamLoadFile(filePath, accumulatorArray) {
            return new Promise((resolve, reject) => {
                const fileStream = fs.createReadStream(filePath);
                
                fileStream.on('error', (err) => {
                    // Log the specific error before resolving
                    node.warn(`Stream read error for ${path.basename(filePath)}: ${err.message}`);
                    resolve(); 
                });

                const rl = readline.createInterface({
                    input: fileStream,
                    crlfDelay: Infinity
                });

                rl.on('line', (line) => {
                    if (!line.trim()) return;
                    try {
                        const pt = JSON.parse(line);
                        // Optional: we could validate timestamp here if needed
                        accumulatorArray.push(pt);
                    } catch (err) {
                        // Skip malformed lines
                    }
                });

                rl.on('close', () => {
                    resolve();
                });
            });
        }

        function finalizeAndSend(allHistory, fileCount) {
            if (allHistory.length > 0) {
                // Don't set msg.topic - let chart read topic from each data point
                node.send({
                    payload: allHistory,
                    action: 'replace'
                });
            }

            isInitializing = false;
            cachedChunkCount = fileCount;
            
            startCommitTimer();
            startPruneTimer();

            // Dump queue
            if (queuedMessages.length > 0) {
                const toProcess = queuedMessages.splice(0, queuedMessages.length);
                const msgsToEmit = [];
                
                toProcess.forEach(qMsg => {
                    liveBuffer.push(qMsg);
                    msgsToEmit.push({
                        topic: qMsg.topic,
                        payload: qMsg.payload,
                        ts: qMsg.ts,
                        action: 'append'
                    });
                });
                
                msgsToEmit.forEach(m => node.send(m));
            }
            
            updateStatus(`${messageCount} msgs, ${cachedChunkCount} chunks, buf: ${liveBuffer.length}`, true);
        }

        // =====================================================================
        // Timers & File Management
        // =====================================================================
        function startCommitTimer() {
            if (commitTimer) clearInterval(commitTimer);

            commitTimer = setInterval(async () => {
                // Yield to rotation or empty buffer
                if (liveBuffer.length === 0 || node.isRotating) return;

                // Take control of current points
                const pointsToCommit = liveBuffer;
                // Reset live buffer immediately so new messages go into next batch
                liveBuffer = [];
                
                const lines = pointsToCommit.map(p => JSON.stringify(p)).join('\n') + '\n';

                try {
                    await fs.promises.appendFile(BUFFER_FILE, lines);
                } catch (err) {
                    node.warn(`Buffer commit failed: ${err.message}`);
                    // Put points back at the start of buffer if write failed
                    // Use concat to avoid stack overflow with large arrays
                    liveBuffer = pointsToCommit.concat(liveBuffer);
                }
            }, COMMIT_INTERVAL_MS);
        }

        function startPruneTimer() {
            if (pruneTimer) clearInterval(pruneTimer);
            pruneTimer = setInterval(() => pruneOldChunks(), PRUNE_INTERVAL_MS);
        }

        async function pruneOldChunks() {
            const files = await getHistoricalFiles();
            const now = Date.now();

            for (const file of files) {
                const parts = file.split('_');
                const timestamp = parseInt(parts[1]);
                if (isNaN(timestamp)) continue;

                // Age check
                const ageMs = now - (timestamp * 1000);
                if (ageMs > MAX_BUFFER_AGE_MS) {
                    try {
                        await fs.promises.unlink(path.join(TRENDS_DIR, file));
                        cachedChunkCount = Math.max(0, cachedChunkCount - 1);
                    } catch (err) {
                        node.warn(`Prune failed for ${file}: ${err.message}`);
                    }
                }
            }
        }

        async function checkHourBoundary() {
            const currentHour = new Date().getHours();
            
            if (node.lastRotationHour === undefined) {
                node.lastRotationHour = currentHour;
                return;
            }

            if (currentHour !== node.lastRotationHour) {
                // Prevent race condition:
                // If multiple msgs arrive while rotating, ignore them.
                if (node.isRotating) return;
                
                node.isRotating = true; // Lock
                
                try {
                    await rotateBuffer();
                    // Update hour only on success to allow retry if it fails
                    node.lastRotationHour = currentHour;
                } catch (err) {
                    node.warn(`Rotation failed: ${err.message}`);
                } finally {
                    node.isRotating = false; // Unlock
                }
            }
        }

        async function rotateBuffer() {
            // Force commit of anything pending in memory before rotation
            // Note: In this architecture, liveBuffer is usually empty due to commit timer,
            // but might have recent points. 
            // We just append to file, THEN rename.
            
            if (liveBuffer.length > 0) {
                const pointsToCommit = liveBuffer;
                liveBuffer = []; // Clear memory
                const lines = pointsToCommit.map(p => JSON.stringify(p)).join('\n') + '\n';
                try {
                    await fs.promises.appendFile(BUFFER_FILE, lines);
                } catch (err) {
                    // If append fails, we might lose these points during rotation, 
                    // put them back and abort rotation. Use concat for safety.
                    liveBuffer = pointsToCommit.concat(liveBuffer);
                    node.warn(`Rotation aborted, append failed: ${err.message}`);
                    return;
                }
            }

            // Perform Rotation (Rename)
            const timestamp = Math.floor(Date.now() / 1000);
            const newName = path.join(TRENDS_DIR, `trend_${timestamp}_${node.id}.json`);

            try {
                await fs.promises.access(BUFFER_FILE);
                await fs.promises.rename(BUFFER_FILE, newName);
                cachedChunkCount++;
            } catch (err) {
                // BUFFER_FILE doesn't exist - no data to rotate
            }
        }

        function updateStatus(text, force) {
            const now = Date.now();
            if (force || (now - lastStatusUpdate > 1000)) {
                utils.setStatusChanged(node, text);
                lastStatusUpdate = now;
            }
        }

        // =====================================================================
        // Message Handler
        // =====================================================================
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg || !msg.hasOwnProperty('payload')) {
                if (done) done();
                return;
            }

            // Initialization Queue
            if (isInitializing) {
                queuedMessages.push({
                    topic: msg.topic,
                    payload: msg.payload,
                    ts: msg.ts || Date.now()
                });
                if (done) done();
                return;
            }

            // Check if we need to rotate files
            checkHourBoundary(); 

            // Process Message
            const ts = msg.ts || Date.now();
            
            // Add to in-memory buffer for the next commit cycle
            liveBuffer.push({
                topic: msg.topic,
                payload: msg.payload,
                ts: ts
            });

            // Pass through to chart immediately
            send({
                topic: msg.topic,
                payload: msg.payload,
                ts: ts,
                action: 'append'
            });

            messageCount++;
            
            // Loose status update
            if (messageCount % 10 === 0) {
                updateStatus(`${messageCount} msgs, ${cachedChunkCount} chunks, buf: ${liveBuffer.length}`);
            }

            if (done) done();
        });

        // =====================================================================
        // Shutdown
        // =====================================================================
        node.on('close', function(done) {
            if (commitTimer) clearInterval(commitTimer);
            if (pruneTimer) clearInterval(pruneTimer);

            // Attempt one final sync save if data exists
            if (liveBuffer.length > 0) {
                const lines = liveBuffer.map(p => JSON.stringify(p)).join('\n') + '\n';
                try {
                    // We must use Sync here because Node-RED close can lead to process exit
                    // before async callbacks fire.
                    fs.appendFileSync(BUFFER_FILE, lines);
                } catch (e) {
                    // ignore
                }
            }

            utils.setStatusOK(node, 'closed');
            done();
        });

        // Start
        setTimeout(() => {
            initializeFromFiles();
        }, STARTUP_DELAY_MS);
    }

    RED.nodes.registerType("history-buffer", HistoryBufferNode);
};
