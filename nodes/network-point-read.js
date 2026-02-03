module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NetworkPointReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Initialize configuration
        // ====================================================================
        node.pointId = parseInt(config.pointId);
        node.bridgeNodeId = config.bridgeNodeId;
        node.outputProperty = config.outputProperty || "payload";
        node.startupDelay = parseInt(config.startupDelay) || 30;  // Delay in seconds
        node.startupTime = Date.now();  // Track when node was deployed
        node.startupComplete = false;
        
        // Validate pointId
        if (isNaN(node.pointId) || node.pointId < 0) {
            utils.setStatusError(node, "invalid pointId");
            return;
        }

        // ====================================================================
        // Initialize state
        // ====================================================================
        node.cache = {
            value: null,
            name: null,
            timestamp: null  // When value was last updated
        };
        
        node.isPollPending = false;

        // ====================================================================
        // Helper: Format status text
        // ====================================================================
        const getStatusText = function() {
            // Try to look up metadata (name/path) for this point
            const meta = utils.lookupPointMetadata(node.pointId);
            let label = meta && meta.name ? meta.name : (meta && meta.path ? meta.path : null);
            
            // Use cached name from remote response if local lookup failed
            if (!label && node.cache.name) {
                label = node.cache.name;
            }
            
            if (!label) label = `Point #${node.pointId}`;
            
            if (node.cache.value === null) {
                return `${label}: waiting...`;
            }
            // Show value (truncate if too long)
            let valDisplay = node.cache.value;
            if (typeof valDisplay === 'object') {
                valDisplay = JSON.stringify(valDisplay).substring(0, 20);
            }
            return `${label}: ${valDisplay}`;
        };

        // ====================================================================
        // Send read request to bridge via event
        // ====================================================================
        const triggerRead = function() {
            // ================================================================
            // Check startup delay - suppress error messages during startup
            // but allow requests to proceed (network may come online early)
            // ================================================================
            let isStartupPhase = false;
            if (!node.startupComplete) {
                const elapsedSeconds = (Date.now() - node.startupTime) / 1000;
                if (elapsedSeconds < node.startupDelay) {
                    isStartupPhase = true;
                    const remainingSeconds = Math.ceil(node.startupDelay - elapsedSeconds);
                    utils.setStatusWarn(node, `Startup delay: ${remainingSeconds}s (silently retrying)...`);
                } else {
                    node.startupComplete = true;
                }
            }

            if (node.isPollPending) {
                return;  // Already waiting for response
            }
            
            node.isPollPending = true;
            if (!isStartupPhase) {
                utils.setStatusUnchanged(node, `Fetching... ${getStatusText()}`);
            }
            
            // Send read request to bridge node via event (cross-flow communication)
            const requestId = `${node.id}_${node.pointId}_${Date.now()}`;
            RED.events.emit('pointReference:read', {
                sourceNodeId: node.id,
                bridgeNodeId: node.bridgeNodeId,
                pointId: node.pointId,
                requestId: requestId,
                isStartupPhase: isStartupPhase  // Flag for error suppression
            });
        };

        // ====================================================================
        // Main message handler - triggered by external inject/timer
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
            // Handle trigger: any input message triggers a read request
            // This is called by external inject node (user controls polling)
            // ================================================================
            if (msg.action === undefined || msg.action === "poll" || msg.action === "read") {
                triggerRead();
                if (done) done();
                return;
            }

            // ================================================================
            // Handle getPoint requests (from logic flows wanting cached value)
            // ================================================================
            if (msg.action === "getPoint") {
                // Return cached value immediately (non-blocking)
                const cacheAge = node.cache.timestamp ? Date.now() - node.cache.timestamp : null;
                const responseMsg = RED.util.cloneMessage(msg);
                responseMsg.action = "getPointResponse";
                responseMsg.pointId = node.pointId;
                responseMsg.value = node.cache.value;
                responseMsg.cached = true;
                responseMsg.age = cacheAge;
                
                send(responseMsg);
                utils.setStatusUnchanged(node, `Served: ${getStatusText()}`);
                if (done) done();
                return;
            }

            // ================================================================
            // Handle configuration commands
            // ================================================================
            if (msg.action === "resetCache") {
                node.cache = { value: null, timestamp: null };
                node.isPollPending = false;
                utils.setStatusOK(node, "Cache reset");
                if (done) done();
                return;
            }

            // Unknown action - pass through (stack properties pattern)
            send(msg);
            if (done) done();
        });

        // ====================================================================
        // Listen for responses from bridge via event
        // ====================================================================
        const responseHandler = function(data) {
            // Only process responses meant for this node
            if (data.sourceNodeId !== node.id) {
                return;
            }
            
            node.isPollPending = false;
            
            // Check for error response
            if (data.error) {
                // Suppress error messages during startup phase
                // (allows network to come online without nuisance errors)
                if (data.isStartupPhase) {
                    // Silently retry later, don't show error
                    return;
                }
                
                const errorText = `Read failed for point #${node.pointId}: ${data.errorMessage || "Unknown error"}`;
                utils.setStatusError(node, `Error: ${data.errorMessage || "Unknown error"}`);
                node.error(errorText);  // Show in debug panel
                // Don't update cache on error, keep stale value
                return;
            }
            
            let newValue = data.value;
            
            // Extract metadata if available
            if (data.message) {
                if (data.message.metadata) {
                    node.cache.name = data.message.metadata.path || data.message.metadata.name;
                }
                
                // If message available, try to robustly extract scalar value
                if (data.message.value !== undefined) {
                    newValue = data.message.value;
                } else if (data.message.payload !== undefined && typeof data.message.payload !== 'object') {
                    newValue = data.message.payload;
                }
            }

            const valueChanged = node.cache.value !== newValue;

            // Update cache with new value
            node.cache.value = newValue;
            node.cache.timestamp = Date.now();
            
            // Update status
            if (valueChanged) {
                utils.setStatusChanged(node, getStatusText());
            } else {
                utils.setStatusUnchanged(node, getStatusText());
            }
            
            // Emit downstream (for wired alarm/history/logic)
            // Uses node.send directly since this is event-triggered, not input-triggered
            
            const outMsg = {
                pointId: node.pointId,
                timestamp: node.cache.timestamp,
                action: "pointUpdate"
            };
            
            // Set output property (default: payload)
            RED.util.setMessageProperty(outMsg, node.outputProperty, newValue);
            
            node.send(outMsg);
        };
        
        RED.events.on('pointReference:response', responseHandler);

        // ====================================================================
        // Node lifecycle
        // ====================================================================
        node.on("close", function(done) {
            // Remove event listener
            RED.events.off('pointReference:response', responseHandler);
            done();
        });

        // Set initial status
        utils.setStatusOK(node, getStatusText());

        // Update status again after a short delay to allow registry nodes to initialize
        // This solves the race condition where this node loads before point-register nodes
        setTimeout(() => {
            const text = getStatusText();
            // Only update if we are still in "waiting" or "initial" state (no value yet)
            if (node.cache.value === null) {
                utils.setStatusOK(node, text); 
            } else {
                // If we have a value, just update the label part
                utils.setStatusChanged(node, text);
            }
        }, 2000);

        // ====================================================================
        // Monitor startup delay and update status periodically during it
        // ====================================================================
        if (node.startupDelay > 0) {
            const startupStatusInterval = setInterval(() => {
                if (node.startupComplete) {
                    clearInterval(startupStatusInterval);
                    return;
                }

                const elapsedSeconds = (Date.now() - node.startupTime) / 1000;
                if (elapsedSeconds >= node.startupDelay) {
                    node.startupComplete = true;
                    clearInterval(startupStatusInterval);
                    utils.setStatusOK(node, getStatusText());
                } else {
                    const remainingSeconds = Math.ceil(node.startupDelay - elapsedSeconds);
                    utils.setStatusWarn(node, `Startup delay: ${remainingSeconds}s remaining...`);
                }
            }, 1000);  // Update status every second during startup
        }
    }

    RED.nodes.registerType("network-point-read", NetworkPointReadNode);
};
