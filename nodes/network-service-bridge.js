module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NetworkServiceBridgeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Initialize configuration
        // ====================================================================
        node.startupDelay = parseInt(config.startupDelay) || 30;  // Delay in seconds
        node.startupTime = Date.now();  // Track when node was deployed
        node.startupComplete = false;

        // ====================================================================
        // Initialize state
        // ====================================================================
        node.pendingRequests = {};  // Track outstanding requests: { "pointId_timestamp": { pointId, timestamp, ... } }
        node.stats = {
            sent: 0,
            received: 0
        };

        // ====================================================================
        // Helper: Generate request ID
        // ====================================================================
        const generateRequestId = function(pointId) {
            return `${pointId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        };

        // ====================================================================
        // Helper: Update status
        // ====================================================================
        const updateStatus = function() {
            // Check startup delay
            if (!node.startupComplete) {
                const elapsedSeconds = (Date.now() - node.startupTime) / 1000;
                if (elapsedSeconds < node.startupDelay) {
                    const remainingSeconds = Math.ceil(node.startupDelay - elapsedSeconds);
                    utils.setStatusWarn(node, `Startup delay: ${remainingSeconds}s remaining...`);
                    return;
                } else {
                    node.startupComplete = true;
                }
            }
            
            const pending = Object.keys(node.pendingRequests).length;
            const successRate = node.stats.sent > 0 
                ? Math.round((node.stats.received / node.stats.sent) * 100)
                : 0;
            
            const statusText = `Listening (pending: ${pending}, success: ${successRate}%)`;
            
            if (pending === 0) {
                utils.setStatusOK(node, statusText);
            } else {
                utils.setStatusUnchanged(node, statusText);
            }
        };

        // ====================================================================
        // Listen for read requests from point-reference nodes via event
        // ====================================================================
        const readRequestHandler = function(data) {
            // Only process requests meant for this bridge
            if (data.bridgeNodeId !== node.id) {
                return;
            }

            // ================================================================
            // Track if request is during startup phase (for error suppression)
            // ================================================================
            let isStartupPhase = false;
            if (!node.startupComplete) {
                const elapsedSeconds = (Date.now() - node.startupTime) / 1000;
                if (elapsedSeconds < node.startupDelay) {
                    isStartupPhase = true;
                    const remainingSeconds = Math.ceil(node.startupDelay - elapsedSeconds);
                    utils.setStatusWarn(node, `Startup delay: ${remainingSeconds}s - allowing retries...`);
                } else {
                    node.startupComplete = true;
                    updateStatus();
                }
            }
            
            // Track this cross-flow request
            node.pendingRequests[data.requestId] = {
                requestId: data.requestId,
                pointId: data.pointId,
                timestamp: Date.now(),
                sourceNodeId: data.sourceNodeId,  // Where to send response
                isStartupPhase: isStartupPhase     // Mark if during startup (errors suppressed)
            };

            // Create outbound message for WebSocket
            const outMsg = {
                action: "read",
                pointId: data.pointId,
                requestId: data.requestId,
                timestamp: Date.now()
            };

            // Send through WebSocket
            node.send(outMsg);
            
            node.stats.sent++;
            updateStatus();
            
            // Timeout: if no response after 10 seconds, clean up
            setTimeout(() => {
                if (node.pendingRequests[data.requestId]) {
                    const pending = node.pendingRequests[data.requestId];
                    delete node.pendingRequests[data.requestId];
                    
                    // Suppress error notification during startup phase
                    // (allows network to come online without nuisance errors)
                    if (pending.isStartupPhase) {
                        // Silently drop timeout during startup
                        return;
                    }
                    
                    const errorText = `Read timeout for point #${data.pointId}`;
                    utils.setStatusWarn(node, errorText);
                    node.error(errorText);  // Show in debug panel
                    
                    // Notify point-reference of timeout
                    RED.events.emit('pointReference:response', {
                        sourceNodeId: data.sourceNodeId,
                        pointId: data.pointId,
                        value: null,
                        error: true,
                        errorMessage: "Read timeout",
                        requestId: data.requestId
                    });
                }
            }, 10000);
        };
        
        RED.events.on('pointReference:read', readRequestHandler);

        // ====================================================================
        // Listen for write requests from point-write nodes via event
        // ====================================================================
        const writeRequestHandler = function(data) {
            // Only process requests meant for this bridge
            if (data.bridgeNodeId !== node.id) {
                return;
            }

            // ================================================================
            // Track if request is during startup phase (for error suppression)
            // ================================================================
            let isStartupPhase = false;
            if (!node.startupComplete) {
                const elapsedSeconds = (Date.now() - node.startupTime) / 1000;
                if (elapsedSeconds < node.startupDelay) {
                    isStartupPhase = true;
                    const remainingSeconds = Math.ceil(node.startupDelay - elapsedSeconds);
                    utils.setStatusWarn(node, `Startup delay: ${remainingSeconds}s - allowing retries...`);
                } else {
                    node.startupComplete = true;
                    updateStatus();
                }
            }
            
            // Track this cross-flow request
            node.pendingRequests[data.requestId] = {
                requestId: data.requestId,
                pointId: data.pointId,
                timestamp: Date.now(),
                sourceNodeId: data.sourceNodeId,
                isWrite: true,
                isStartupPhase: isStartupPhase  // Mark if during startup (errors suppressed)
            };

            // Create outbound message for WebSocket
            const outMsg = {
                action: "write",
                pointId: data.pointId,
                priority: data.priority,
                value: data.value,
                requestId: data.requestId,
                timestamp: Date.now()
            };

            // Send through WebSocket
            node.send(outMsg);
            
            node.stats.sent++;
            updateStatus();
            
            // Timeout: if no response after 10 seconds, clean up
            setTimeout(() => {
                if (node.pendingRequests[data.requestId]) {
                    const pending = node.pendingRequests[data.requestId];
                    delete node.pendingRequests[data.requestId];
                    
                    // Suppress error notification during startup phase
                    // (allows network to come online without nuisance errors)
                    if (pending.isStartupPhase) {
                        // Silently drop timeout during startup
                        return;
                    }
                    
                    const errorText = `Write timeout for point #${data.pointId}`;
                    utils.setStatusWarn(node, errorText);
                    node.error(errorText);  // Show in debug panel
                    
                    // Notify point-write of timeout
                    RED.events.emit('pointWrite:response', {
                        sourceNodeId: pending.sourceNodeId,
                        pointId: data.pointId,
                        error: "Write timeout",
                        requestId: data.requestId
                    });
                }
            }, 10000);
        };
        
        RED.events.on('pointWrite:write', writeRequestHandler);

        // ====================================================================
        // Main message handler - ONLY processes WebSocket responses
        // Read/write requests come via events, not wired input
        // ====================================================================
        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // ================================================================
            // Handle response from WebSocket (network-read returns data object)
            // Response has: network.pointId, value (or payload), status.code
            // Route back to point-reference via event
            // ================================================================
            
            // Check if this looks like a point response (has network.pointId or status.pointId)
            const responsePointId = msg.network?.pointId ?? msg.status?.pointId ?? msg.pointId;
            const responseValue = msg.value ?? msg.payload;
            const statusCode = msg.status?.code;
            const statusMessage = msg.status?.message || "";
            const isError = statusCode === "error";
            
            // Valid response if we have a pointId (value can be null/undefined on error)
            const isValidResponse = responsePointId !== undefined;
            
            if (isValidResponse) {
                // Find ALL matching pending requests by pointId
                // Multiple nodes might be waiting for the same point
                const matchingRequests = [];
                
                for (const [reqId, reqData] of Object.entries(node.pendingRequests)) {
                    if (reqData.pointId === responsePointId) {
                        matchingRequests.push({
                            requestId: reqId,
                            sourceNodeId: reqData.sourceNodeId,
                            isWrite: reqData.isWrite,
                            isStartupPhase: reqData.isStartupPhase  // Preserve startup phase flag
                        });
                    }
                }
                
                if (matchingRequests.length > 0) {
                    // Remove all matched requests from pending BEFORE notifying
                    // (prevents race conditions if notification triggers new requests)
                    for (const match of matchingRequests) {
                        delete node.pendingRequests[match.requestId];
                    }
                    
                    // Now notify all waiting nodes
                    for (const match of matchingRequests) {
                        const eventName = match.isWrite ? 'pointWrite:response' : 'pointReference:response';
                        
                        if (isError) {
                            RED.events.emit(eventName, {
                                sourceNodeId: match.sourceNodeId,
                                pointId: responsePointId,
                                value: null,
                                error: match.isWrite ? statusMessage : true,
                                errorMessage: statusMessage,
                                requestId: match.requestId,
                                timestamp: Date.now(),
                                isStartupPhase: match.isStartupPhase  // Pass startup phase flag
                            });
                        } else {
                            // Success response
                            node.stats.received++;
                            
                            RED.events.emit(eventName, {
                                sourceNodeId: match.sourceNodeId,
                                pointId: responsePointId,
                                value: responseValue,
                                message: msg,
                                error: match.isWrite ? null : false,
                                requestId: match.requestId,
                                timestamp: msg.timestamp || Date.now(),
                                isStartupPhase: match.isStartupPhase  // Pass startup phase flag
                            });
                        }
                    }
                    
                    // Update status once after all notifications
                    if (isError) {
                        const errorText = `Error for #${responsePointId}: ${statusMessage}`;
                        utils.setStatusWarn(node, errorText);
                        node.error(errorText);  // Show in debug panel
                    } else {
                        updateStatus();
                    }
                } else {
                    // Response without matching request - could be stale or unsolicited
                    utils.setStatusWarn(node, `Unmatched response for point #${responsePointId}`);
                }

                if (done) done();
                return;
            }

            // ================================================================
            // Handle statistics/status queries
            // ================================================================
            if (msg.action === "getBridgeStats") {
                const statsMsg = {
                    action: "bridgeStats",
                    stats: node.stats,
                    pendingCount: Object.keys(node.pendingRequests).length,
                    pending: Object.keys(node.pendingRequests)
                };
                send(statsMsg);
                if (done) done();
                return;
            }

            if (msg.action === "clearPending") {
                node.pendingRequests = {};
                utils.setStatusOK(node, "Pending requests cleared");
                if (done) done();
                return;
            }

            if (msg.action === "resetStats") {
                node.stats = { sent: 0, received: 0 };
                utils.setStatusOK(node, "Stats reset");
                if (done) done();
                return;
            }

            // Unknown action - pass through anyway (could be for other nodes)
            if (done) done();
        });

        // ====================================================================
        // Node lifecycle
        // ====================================================================
        node.on("close", function(done) {
            // Clear pending requests on close
            node.pendingRequests = {};
            // Remove event listeners
            RED.events.off('pointReference:read', readRequestHandler);
            RED.events.off('pointWrite:write', writeRequestHandler);
            done();
        });

        // ====================================================================
        // Initialize
        // ====================================================================
        updateStatus();
    }

    RED.nodes.registerType("network-service-bridge", NetworkServiceBridgeNode);
};
