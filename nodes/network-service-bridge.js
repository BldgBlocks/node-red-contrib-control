module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NetworkServiceBridgeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Initialize configuration
        // ====================================================================
        const parsedStartupDelay = parseInt(config.startupDelay, 10);
        node.startupDelay = isNaN(parsedStartupDelay) ? 30 : parsedStartupDelay;  // Delay in seconds
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

        const removePendingRequest = function(requestId) {
            const pending = node.pendingRequests[requestId];
            if (!pending) return null;
            if (pending.timeout) clearTimeout(pending.timeout);
            delete node.pendingRequests[requestId];
            return pending;
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
            node.pendingRequests[data.requestId].timeout = setTimeout(() => {
                const pending = removePendingRequest(data.requestId);
                if (pending) {
                    
                    if (pending.isStartupPhase) {
                        // During startup: still notify point-read to reset isPollPending,
                        // but suppress error logging (network may still be coming online)
                        RED.events.emit('pointReference:response', {
                            sourceNodeId: pending.sourceNodeId,
                            pointId: pending.pointId,
                            value: null,
                            error: true,
                            errorMessage: "Startup timeout",
                            requestId: pending.requestId,
                            isStartupPhase: true
                        });
                        return;
                    }
                    
                    const errorText = `Read timeout for point #${pending.pointId}`;
                    utils.setStatusWarn(node, errorText);
                    node.error(errorText);  // Show in debug panel
                    
                    // Notify point-reference of timeout
                    RED.events.emit('pointReference:response', {
                        sourceNodeId: pending.sourceNodeId,
                        pointId: pending.pointId,
                        value: null,
                        error: true,
                        errorMessage: "Read timeout",
                        requestId: pending.requestId
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
            node.pendingRequests[data.requestId].timeout = setTimeout(() => {
                const pending = removePendingRequest(data.requestId);
                if (pending) {
                    
                    if (pending.isStartupPhase) {
                        // During startup: still notify point-write to reset pending state,
                        // but suppress error logging
                        RED.events.emit('pointWrite:response', {
                            sourceNodeId: pending.sourceNodeId,
                            pointId: pending.pointId,
                            error: "Startup timeout",
                            requestId: pending.requestId,
                            isStartupPhase: true
                        });
                        return;
                    }
                    
                    const errorText = `Write timeout for point #${pending.pointId}`;
                    utils.setStatusWarn(node, errorText);
                    node.error(errorText);  // Show in debug panel
                    
                    // Notify point-write of timeout
                    RED.events.emit('pointWrite:response', {
                        sourceNodeId: pending.sourceNodeId,
                        pointId: pending.pointId,
                        error: "Write timeout",
                        requestId: pending.requestId
                    });
                }
            }, 10000);
        };
        
        RED.events.on('pointWrite:write', writeRequestHandler);

        // ====================================================================
        // Listen for manual point discovery requests.
        // Discovery results are correlated by requestId because they do not
        // contain an individual point ID.
        // ====================================================================
        const discoveryRequestHandler = function(data) {
            if (data.bridgeNodeId !== node.id) {
                return;
            }

            node.pendingRequests[data.requestId] = {
                requestId: data.requestId,
                timestamp: Date.now(),
                sourceNodeId: data.sourceNodeId,
                action: "discover"
            };

            node.send({
                action: "discover",
                requestId: data.requestId,
                timestamp: Date.now()
            });
            node.stats.sent++;
            updateStatus();

            node.pendingRequests[data.requestId].timeout = setTimeout(() => {
                const pending = removePendingRequest(data.requestId);
                if (!pending) {
                    return;
                }
                RED.events.emit('networkPointDiscover:response', {
                    sourceNodeId: pending.sourceNodeId,
                    error: true,
                    errorMessage: "Discovery timeout",
                    requestId: pending.requestId
                });
                utils.setStatusWarn(node, "Discovery timeout");
                updateStatus();
            }, 10000);
        };

        RED.events.on('networkPointDiscover:request', discoveryRequestHandler);

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

            // Discovery replies contain registry data rather than a pointId.
            // The remote endpoint must return the requestId it received.
            const discoveryRequestId = msg.requestId;
            const discoveryPending = discoveryRequestId && node.pendingRequests[discoveryRequestId];
            if (discoveryPending?.action === "discover" && msg.action === "discover" && msg.networkProperties && typeof msg.networkProperties === "object") {
                removePendingRequest(discoveryPending.requestId);
                const discoveryError = msg.status?.code === "error";
                if (!discoveryError) {
                    node.stats.received++;
                }
                RED.events.emit('networkPointDiscover:response', {
                    sourceNodeId: discoveryPending.sourceNodeId,
                    error: discoveryError,
                    errorMessage: msg.status?.message || "",
                    requestId: discoveryPending.requestId,
                    message: msg,
                    timestamp: Date.now()
                });
                updateStatus();
                if (done) done();
                return;
            }

            // ================================================================
            // Handle response from WebSocket (network-read returns data object)
            // Response has: network.pointId, value (or payload), status.code
            // Route back to point-reference via event
            // ================================================================
            
            // Check if this looks like a point response (has network.pointId or status.pointId)
            const rawPointId = msg.network?.pointId ?? msg.status?.pointId ?? msg.pointId;
            // Normalize to number - point-read stores pointId as int, but WebSocket responses may return strings
            const responsePointId = rawPointId !== undefined && rawPointId !== null ? parseInt(rawPointId, 10) : undefined;
            const responseValue = msg.value ?? msg.payload;
            const statusCode = msg.status?.code;
            const statusMessage = msg.status?.message || "";
            const isError = statusCode === "error";
            
            // Valid response if we have a valid numeric pointId
            const isValidResponse = responsePointId !== undefined && !isNaN(responsePointId);
            
            if (isValidResponse) {
                const responsePending = msg.requestId && node.pendingRequests[msg.requestId];
                if (!responsePending) {
                    node.trace(`Ignoring response with unknown request ID: ${msg.requestId || "missing"}`);
                    if (done) done();
                    return;
                }
                if (responsePending.pointId !== responsePointId || (responsePending.isWrite ? msg.action !== "write" : msg.action !== "read")) {
                    node.trace(`Ignoring mismatched response for request ${msg.requestId}`);
                    if (done) done();
                    return;
                }

                // A read result is valid for every outstanding read of the same point.
                // Write confirmations are always routed to the one originating request.
                const matchingRequests = responsePending.isWrite
                    ? [responsePending]
                    : Object.values(node.pendingRequests).filter(request => !request.isWrite && request.pointId === responsePointId);
                
                if (matchingRequests.length > 0) {
                    // Remove all matched requests from pending BEFORE notifying
                    // (prevents race conditions if notification triggers new requests)
                    for (const match of matchingRequests) {
                        removePendingRequest(match.requestId);
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
                    // Response without matching request - duplicate, stale, or already timed-out
                    // This is normal when remote has multiple WebSocket nodes or response arrives after timeout cleanup
                    // Don't change node status - just log at trace level
                    node.trace(`Ignoring duplicate/stale response for point #${responsePointId}`);
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
                for (const requestId of Object.keys(node.pendingRequests)) {
                    removePendingRequest(requestId);
                }
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
            // Clear startup timer
            if (node.startupTimer) {
                clearTimeout(node.startupTimer);
                node.startupTimer = null;
            }

            // Flush pending requests so callers do not remain stuck waiting.
            for (const pending of Object.values(node.pendingRequests)) {
                if (pending.isWrite) {
                    RED.events.emit('pointWrite:response', {
                        sourceNodeId: pending.sourceNodeId,
                        pointId: pending.pointId,
                        error: "Bridge closed",
                        requestId: pending.requestId,
                        isStartupPhase: false
                    });
                } else if (pending.action === "discover") {
                    RED.events.emit('networkPointDiscover:response', {
                        sourceNodeId: pending.sourceNodeId,
                        error: true,
                        errorMessage: "Bridge closed",
                        requestId: pending.requestId
                    });
                } else {
                    RED.events.emit('pointReference:response', {
                        sourceNodeId: pending.sourceNodeId,
                        pointId: pending.pointId,
                        value: null,
                        error: true,
                        errorMessage: "Bridge closed",
                        requestId: pending.requestId,
                        isStartupPhase: false
                    });
                }
            }

            // Clear pending requests on close
            for (const requestId of Object.keys(node.pendingRequests)) {
                removePendingRequest(requestId);
            }
            // Remove event listeners
            RED.events.off('pointReference:read', readRequestHandler);
            RED.events.off('pointWrite:write', writeRequestHandler);
            RED.events.off('networkPointDiscover:request', discoveryRequestHandler);
            done();
        });

        // ====================================================================
        // Initialize
        // ====================================================================
        // One-shot timer to guarantee startup delay completes even if no messages arrive
        node.startupTimer = setTimeout(() => {
            if (!node.startupComplete) {
                node.startupComplete = true;
                updateStatus();
            }
            node.startupTimer = null;
        }, node.startupDelay * 1000);

        updateStatus();
    }

    RED.nodes.registerType("network-service-bridge", NetworkServiceBridgeNode);
};
