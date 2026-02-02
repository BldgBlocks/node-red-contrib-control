// ============================================================================
// Point Write - Write values to remote points via network bridge
// ============================================================================
// Sends write requests to a remote point through the selected network bridge.
// Supports priority levels (1-16) for BACnet-style priority arrays.
// Configurable input property to read value from msg.
// ============================================================================

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NetworkPointWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Configuration
        // ====================================================================
        node.pointId = parseInt(config.pointId) || 0;
        node.priority = parseInt(config.priority) || 16;  // Default to lowest priority
        node.inputProperty = config.inputProperty || "payload";
        node.bridgeNodeId = config.bridgeNodeId || "";

        // ====================================================================
        // State tracking
        // ====================================================================
        let pendingWrite = null;
        let lastWriteTime = null;
        let lastWriteValue = null;

        // ====================================================================
        // Helper: Get status text
        // ====================================================================
        function getStatusText() {
            if (lastWriteValue !== null) {
                return `#${node.pointId} @${node.priority}: ${lastWriteValue}`;
            }
            return `#${node.pointId} @${node.priority}: (no writes)`;
        }

        // ====================================================================
        // Response handler - receives write confirmations from bridge
        // ====================================================================
        function responseHandler(response) {
            // Only process responses for this node
            if (response.sourceNodeId !== node.id) return;
            if (response.pointId !== node.pointId) return;

            pendingWrite = null;

            if (response.error) {
                const errorText = `Write failed for point #${node.pointId}: ${response.error}`;
                utils.setStatusError(node, `#${node.pointId}: ${response.error}`);
                node.error(errorText);  // Show in debug panel
                node.send({
                    payload: lastWriteValue,
                    pointId: node.pointId,
                    priority: node.priority,
                    action: "writeError",
                    error: response.error,
                    timestamp: Date.now()
                });
            } else {
                lastWriteTime = Date.now();
                utils.setStatusChanged(node, getStatusText());
                node.send({
                    payload: lastWriteValue,
                    pointId: node.pointId,
                    priority: node.priority,
                    action: "writeConfirmed",
                    timestamp: lastWriteTime
                });
            }
        }

        // Register response listener
        RED.events.on("pointWrite:response", responseHandler);

        // Initial status
        utils.setStatusOK(node, getStatusText());

        // ====================================================================
        // Input handler
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
            // Handle configuration commands via msg.context
            // ================================================================
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }

                if (msg.context === "pointId") {
                    const newPointId = parseInt(msg.payload);
                    if (isNaN(newPointId) || newPointId < 0) {
                        utils.setStatusError(node, "invalid pointId");
                        if (done) done();
                        return;
                    }
                    node.pointId = newPointId;
                    utils.setStatusOK(node, getStatusText());
                    if (done) done();
                    return;
                }

                if (msg.context === "priority") {
                    const newPriority = parseInt(msg.payload);
                    if (isNaN(newPriority) || newPriority < 1 || newPriority > 16) {
                        utils.setStatusError(node, "priority must be 1-16");
                        if (done) done();
                        return;
                    }
                    node.priority = newPriority;
                    utils.setStatusOK(node, getStatusText());
                    if (done) done();
                    return;
                }

                if (msg.context === "release") {
                    // Release priority (write null to clear priority slot)
                    if (!node.bridgeNodeId) {
                        utils.setStatusError(node, "no bridge configured");
                        if (done) done();
                        return;
                    }

                    const requestId = `${node.id}-${Date.now()}`;
                    pendingWrite = requestId;
                    lastWriteValue = null;

                    utils.setStatusWarn(node, `#${node.pointId} @${node.priority}: releasing...`);

                    RED.events.emit("pointWrite:write", {
                        sourceNodeId: node.id,
                        bridgeNodeId: node.bridgeNodeId,
                        pointId: node.pointId,
                        priority: node.priority,
                        value: null,  // null = release
                        requestId: requestId
                    });

                    if (done) done();
                    return;
                }

                utils.setStatusWarn(node, "unknown context");
                if (done) done();
                return;
            }

            // ================================================================
            // Normal write - read value from configured input property
            // ================================================================
            if (!node.bridgeNodeId) {
                utils.setStatusError(node, "no bridge configured");
                if (done) done();
                return;
            }

            // Read value from input property
            let writeValue;
            try {
                writeValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                utils.setStatusError(node, `invalid input property: ${node.inputProperty}`);
                if (done) done();
                return;
            }

            if (writeValue === undefined) {
                utils.setStatusError(node, `missing ${node.inputProperty}`);
                if (done) done();
                return;
            }

            // Track the value we're writing
            lastWriteValue = writeValue;

            // Generate unique request ID
            const requestId = `${node.id}-${Date.now()}`;
            pendingWrite = requestId;

            // Show pending status
            utils.setStatusWarn(node, `#${node.pointId} @${node.priority}: writing ${writeValue}...`);

            // Emit write request to bridge
            RED.events.emit("pointWrite:write", {
                sourceNodeId: node.id,
                bridgeNodeId: node.bridgeNodeId,
                pointId: node.pointId,
                priority: node.priority,
                value: writeValue,
                requestId: requestId
            });

            if (done) done();
        });

        // ====================================================================
        // Cleanup on close
        // ====================================================================
        node.on("close", function(done) {
            RED.events.removeListener("pointWrite:response", responseHandler);
            pendingWrite = null;
            done();
        });
    }

    RED.nodes.registerType("network-point-write", NetworkPointWriteNode);
};
