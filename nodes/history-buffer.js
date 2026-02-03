module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function HistoryBufferNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = node.context();

        // Configuration
        const bufferHours = parseInt(config.bufferHours) || 3;
        const commitIntervalMin = parseInt(config.commitIntervalMin) || 10;
        const bufferMaxAge = bufferHours * 60 * 60 * 1000;
        const pruneIntervalMs = 60 * 1000; // Prune in-memory every 60 seconds
        const commitIntervalMs = commitIntervalMin * 60 * 1000; // Persist to disk every N minutes

        // In-memory buffer
        let dataBuffer = [];
        const persistenceKey = `history_buffer_${node.id}`;
        let commitTimer = null;
        let lastCommitTime = Date.now();
        let messageCount = 0;

        // Initialize on startup: load persisted data (async)
        function initializeBuffer() {
            context.get(persistenceKey, 'persistent', (err, stored) => {
                try {
                    if (!err && stored && Array.isArray(stored)) {
                        dataBuffer = stored;
                        utils.setStatusOK(node, `restored ${dataBuffer.length} points`);

                        // Delay replay 1 second to allow downstream nodes to connect
                        setTimeout(() => {
                            if (dataBuffer.length > 0) {
                                dataBuffer.forEach((item, index) => {
                                    const outMsg = {
                                        topic: item.topic,
                                        payload: item.payload,
                                        ts: item.ts,
                                        action: index === 0 ? "replace" : "append"
                                    };
                                    node.send(outMsg);
                                });
                            }
                        }, 1000);
                    } else {
                        dataBuffer = [];
                        utils.setStatusOK(node, "no stored history");
                    }
                } catch (e) {
                    utils.setStatusError(node, `load error: ${e.message}`);
                    dataBuffer = [];
                }

                startPruneTimer();
                startCommitTimer();
            });
        }

        // Prune old data in-memory every 60 seconds (no disk writes)
        function startPruneTimer() {
            setInterval(() => {
                const now = Date.now();
                const cutoff = now - bufferMaxAge;
                const beforeLen = dataBuffer.length;
                const prunedBuffer = dataBuffer.filter(item => {
                    const timestamp = item.ts || item.timestamp || now;
                    return timestamp > cutoff;
                });

                const removedCount = beforeLen - prunedBuffer.length;
                if (removedCount > 0) {
                    dataBuffer = prunedBuffer;
                }
            }, pruneIntervalMs);
        }

        // Persist to disk every commitIntervalMin (async, non-blocking)
        function startCommitTimer() {
            commitTimer = setInterval(() => {
                // Use async context.set to avoid blocking the event loop
                context.set(persistenceKey, dataBuffer, 'persistent', (err) => {
                    if (err) {
                        node.warn(`commit error: ${err.message}`);
                    } else {
                        lastCommitTime = Date.now();
                    }
                });
            }, commitIntervalMs);
        }

        // Message handler: buffer and forward data
        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("topic") || !msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing topic or payload");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("ts")) {
                msg.ts = Date.now();
            }

            const outMsg = RED.util.cloneMessage(msg);
            outMsg.action = "append";

            try {
                dataBuffer.push({
                    topic: msg.topic,
                    payload: msg.payload,
                    ts: msg.ts
                });

                messageCount++;

                // Update status every 5 messages to avoid flickering
                if (messageCount % 5 === 0) {
                    const uniqueSeries = new Set(dataBuffer.map(item => item.topic)).size;
                    const secondsUntilCommit = Math.round((commitIntervalMs - (Date.now() - lastCommitTime)) / 1000);
                    const statusText = `buffer: ${dataBuffer.length} points (${uniqueSeries} series), next commit: ${Math.max(0, secondsUntilCommit)}s`;
                    utils.setStatusChanged(node, statusText);
                }

                send(outMsg);
            } catch (err) {
                utils.setStatusError(node, `buffer error: ${err.message}`);
                if (done) done();
                return;
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Stop commit timer
            if (commitTimer) clearInterval(commitTimer);
            // Don't write on shutdown - risk of corruption outweighs small data loss
            done();
        });

        initializeBuffer();
    }

    RED.nodes.registerType("history-buffer", HistoryBufferNode);
};
