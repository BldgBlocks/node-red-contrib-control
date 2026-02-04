module.exports = function(RED) {
    const fs = require('fs');
    const path = require('path');
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
        const TRENDS_DIR = getTrendsDir();
        const BUFFER_FILE = path.join(TRENDS_DIR, 'buffer_current.json');
        const COMMIT_INTERVAL_MS = 30 * 1000;  // 30 seconds
        const PRUNE_INTERVAL_MS = 60 * 1000;   // 60 seconds
        const STARTUP_DELAY_MS = 5000;         // 5 seconds before loading history
        const MAX_BUFFER_AGE_MS = node.bufferHours * 3600 * 1000;

        // State
        let liveBuffer = [];                    // Accumulate points between commits
        let commitTimer = null;
        let pruneTimer = null;
        let firstMessageSent = false;
        let messageCount = 0;
        let cachedChunkCount = 0;               // Cached count of historical files
        let isInitializing = true;              // Flag: initialization in progress
        let queuedMessages = [];                // Queue messages during initialization

        utils.setStatusOK(node, `ready, buffer: ${node.bufferHours}h`);

        // =====================================================================
        // Initialize from files on startup
        // =====================================================================
        function getTrendsDir() {
            // Use RED.settings.userDir (the actual Node-RED user directory)
            // This works whether Node-RED is installed globally or locally
            const userDir = RED.settings.userDir || 
                           process.env.NODE_RED_HOME ||
                           path.join(require('os').homedir(), '.node-red');
            const trendsDir = path.join(userDir, '.bldgblocks', 'trends');

            // Create directory if it doesn't exist
            if (!fs.existsSync(trendsDir)) {
                try {
                    fs.mkdirSync(trendsDir, { recursive: true });
                } catch (err) {
                    node.error(`Failed to create trends directory: ${err.message}`);
                }
            }

            return trendsDir;
        }

        function getHistoricalFiles() {
            try {
                return fs.readdirSync(TRENDS_DIR)
                    .filter(f => f.startsWith('trend_') && f.endsWith('.json'))
                    .sort();  // Filenames with timestamps sort chronologically
            } catch (err) {
                node.warn(`Failed to list trend files: ${err.message}`);
                return [];
            }
        }

        function loadChunkFile(filePath) {
            return new Promise((resolve) => {
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        node.warn(`Failed to read ${path.basename(filePath)}: ${err.message}`);
                        resolve([]);
                        return;
                    }

                    const points = [];
                    const lines = data.split('\n').filter(line => line.trim());
                    let parseErrors = 0;
                    let skippedOldFormat = 0;

                    for (const line of lines) {
                        try {
                            const pt = JSON.parse(line);
                            // Filter out value with invalid timestamps (e.g. old Seconds format < Year 2001)
                            // Valid milliseconds > 1000000000000
                            if (pt.ts && pt.ts > 1000000000000) {
                                points.push(pt);
                            } else {
                                skippedOldFormat++;
                            }
                        } catch (parseErr) {
                            parseErrors++;
                            node.debug(`Skipped invalid line in ${path.basename(filePath)}: ${line.substring(0, 50)}...`);
                        }
                    }

                    if (parseErrors > 0 || skippedOldFormat > 0) {
                        node.warn(`${path.basename(filePath)}: loaded ${points.length}, skipped ${parseErrors} invalid, ${skippedOldFormat} old-format`);
                    } else {
                        node.debug(`Loaded ${points.length} points from ${path.basename(filePath)}`);
                    }
                    resolve(points);
                });
            });
        }

        function initializeFromFiles() {
            const historicalFiles = getHistoricalFiles();

            // Filter files within buffer age (3 hours by default)
            const now = Date.now();
            const validFiles = historicalFiles.filter(file => {
                const timestamp = parseInt(file.split('_')[1]);
                const ageMs = now - (timestamp * 1000);
                return ageMs <= MAX_BUFFER_AGE_MS;
            });

            // Append the active buffer to the loading list
            if (fs.existsSync(BUFFER_FILE)) {
                validFiles.push('buffer_current.json');
            }

            // Accumulate all points before sending
            let allHistory = [];
            let index = 0;

            function loadNext() {
                if (index >= validFiles.length) {
                    // All files loaded - Process and send
                    if (allHistory.length > 0) {
                        // 1. Sort by timestamp (oldest first)
                        allHistory.sort((a, b) => a.ts - b.ts);

                        // 2. Ensure Dashboard 2.0 compatibility
                        // ui-chart expects 'series' property to separate lines in a single array
                        allHistory = allHistory.map(pt => {
                            if (!pt.series && pt.topic) {
                                pt.series = pt.topic;
                            }
                            return pt;
                        });

                        // 3. Send single REPLACE message
                        // This forces the chart to redraw the entire timeline correctly using 'ts'
                        node.send({
                            payload: allHistory,
                            action: 'replace'
                        });
                        
                        utils.setStatusChanged(node, `history loaded: ${allHistory.length} points (replace)`);
                    } else {
                        utils.setStatusChanged(node, `history loaded: empty`);
                    }

                    // 4. Initialization complete
                    firstMessageSent = true;
                    isInitializing = false;
                    cachedChunkCount = validFiles.length; // Approximate
                    
                    startCommitTimer();
                    startPruneTimer();

                    // 5. Process queued live messages (Append)
                    if (queuedMessages.length > 0) {
                        const toProcess = queuedMessages.splice(0, queuedMessages.length);
                        toProcess.forEach(qMsg => {
                            liveBuffer.push(qMsg); // Add to internal commit buffer
                            
                            // Send to chart (Append)
                            node.send({
                                topic: qMsg.topic,
                                payload: qMsg.payload,
                                ts: qMsg.ts,
                                action: 'append'
                            });
                        });
                        utils.setStatusChanged(node, `processed ${toProcess.length} queued messages`);
                    }
                    return;
                }

                const filePath = path.join(TRENDS_DIR, validFiles[index]);
                loadChunkFile(filePath)
                    .then(points => {
                        if (points && points.length > 0) {
                            allHistory.push(...points);
                            // Optional: Update status to show progress
                            if (index % 5 === 0) {
                                utils.setStatusChanged(node, `loading file ${index + 1}/${validFiles.length}...`);
                            }
                        }
                        index++;
                        // Pause 50ms between chunks to yield CPU and avoid disk contention
                        setTimeout(loadNext, 50);
                    })
                    .catch(err => {
                        node.error(`Error loading chunk: ${err.message}`);
                        index++;
                        setTimeout(loadNext, 50);
                    });
            }

            loadNext();
        }

        // =====================================================================
        // Commit live buffer to disk every 30 seconds
        // =====================================================================
        function startCommitTimer() {
            if (commitTimer) clearInterval(commitTimer);

            commitTimer = setInterval(() => {
                if (liveBuffer.length === 0) {
                    return;  // Nothing to commit
                }

                const pointsToCommit = liveBuffer.splice(0, liveBuffer.length);  // Take all, clear buffer
                const lines = pointsToCommit.map(p => JSON.stringify(p)).join('\n') + '\n';

                fs.appendFile(BUFFER_FILE, lines, (err) => {
                    if (err) {
                        node.warn(`Failed to commit buffer: ${err.message}`);
                        // Re-add points to buffer if write failed (bounded loss)
                        liveBuffer.unshift(...pointsToCommit);
                    }
                });
            }, COMMIT_INTERVAL_MS);
        }

        // =====================================================================
        // Prune old files every 60 seconds
        // =====================================================================
        function startPruneTimer() {
            if (pruneTimer) clearInterval(pruneTimer);

            pruneTimer = setInterval(() => {
                pruneOldChunks();
            }, PRUNE_INTERVAL_MS);
        }

        function pruneOldChunks() {
            const now = Date.now();

            try {
                fs.readdirSync(TRENDS_DIR).forEach(file => {
                    if (file.startsWith('trend_') && file.endsWith('.json')) {
                        const timestamp = parseInt(file.split('_')[1]);
                        const ageMs = now - (timestamp * 1000);

                        if (ageMs > MAX_BUFFER_AGE_MS) {
                            const filePath = path.join(TRENDS_DIR, file);
                            fs.unlink(filePath, (err) => {
                                if (err) {
                                    node.warn(`Failed to delete old chunk ${file}: ${err.message}`);
                                } else {
                                    node.debug(`Pruned old chunk: ${file}`);
                                    cachedChunkCount = Math.max(0, cachedChunkCount - 1);  // Chunk deleted
                                }
                            });
                        }
                    }
                });
            } catch (err) {
                node.warn(`Prune error: ${err.message}`);
            }
        }

        // =====================================================================
        // Check for hour boundary and rotate files
        // =====================================================================
        function checkHourBoundary() {
            const now = new Date();
            const currentHour = now.getHours();
            const currentTimestamp = Math.floor(Date.now() / 1000 / 3600) * 3600;  // Truncate to hour

            // Store the hour we last rotated
            if (!node.lastRotationHour) {
                node.lastRotationHour = currentHour;
                return;
            }

            // If hour changed, rotate the file
            if (currentHour !== node.lastRotationHour) {
                rotateBuffer(currentTimestamp - 3600);  // Rotate previous hour's file
                node.lastRotationHour = currentHour;
            }
        }

        function rotateBuffer(pastTimestamp) {
            // Commit remaining live buffer before rotation
            if (liveBuffer.length > 0) {
                const lines = liveBuffer.map(p => JSON.stringify(p)).join('\n') + '\n';
                fs.appendFileSync(BUFFER_FILE, lines);  // Sync is okay here, happens once per hour
                liveBuffer = [];
            }

            // Rename current buffer to hourly chunk
            const newName = path.join(TRENDS_DIR, `trend_${pastTimestamp}.json`);
            fs.rename(BUFFER_FILE, newName, (err) => {
                if (err) {
                    node.warn(`Failed to rotate buffer file: ${err.message}`);
                } else {
                    node.debug(`Rotated buffer to ${path.basename(newName)}`);
                    cachedChunkCount++;  // New chunk file created
                    // Create new buffer file (will be created on first append)
                }
            });
        }

        // =====================================================================
        // Message handler
        // =====================================================================
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate message
            if (!msg) {
                utils.setStatusError(node, 'invalid message');
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty('topic') || !msg.hasOwnProperty('payload')) {
                utils.setStatusError(node, 'missing topic or payload');
                if (done) done();
                return;
            }

            // If still initializing, queue the message
            if (isInitializing) {
                queuedMessages.push({
                    topic: msg.topic,
                    payload: msg.payload,
                    ts: msg.ts || Date.now()  // milliseconds
                });
                if (done) done();
                return;
            }

            // Check hour boundary
            checkHourBoundary();

            // Add timestamp if not present (milliseconds, not seconds)
            const ts = msg.ts || Date.now();

            // Accumulate in live buffer
            liveBuffer.push({
                topic: msg.topic,
                payload: msg.payload,
                ts: ts
            });

            // Send immediately to chart with "append"
            const outMsg = {
                topic: msg.topic,
                payload: msg.payload,
                ts: ts,
                action: 'append'
            };
            send(outMsg);

            messageCount++;

            // Update status every 5 messages
            if (messageCount % 5 === 0) {
                utils.setStatusChanged(node, `${messageCount} messages, ${cachedChunkCount} chunks, buffer: ${liveBuffer.length}`);
            }

            if (done) done();
        });

        // =====================================================================
        // Shutdown
        // =====================================================================
        node.on('close', function(done) {
            // Clear timers
            if (commitTimer) clearInterval(commitTimer);
            if (pruneTimer) clearInterval(pruneTimer);

            // Commit remaining data before shutdown
            if (liveBuffer.length > 0) {
                const lines = liveBuffer.map(p => JSON.stringify(p)).join('\n') + '\n';
                try {
                    fs.appendFileSync(BUFFER_FILE, lines);
                } catch (err) {
                    node.warn(`Failed to commit on shutdown: ${err.message}`);
                }
            }

            utils.setStatusOK(node, 'closed');
            done();
        });

        // =====================================================================
        // Start initialization sequence
        // =====================================================================
        setTimeout(() => {
            initializeFromFiles();
        }, STARTUP_DELAY_MS);
    }

    RED.nodes.registerType("history-buffer", HistoryBufferNode);
};
