module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CacheBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            operationMode: config.operationMode,
            cachedMessage: null
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Validate context
            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                utils.setStatusError(node, "missing context");
                if (done) done();
                return;
            }

            switch (msg.context) {
                case "update":
                    // Validate payload
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload");
                        if (done) done();
                        return;
                    }

                    node.runtime.cachedMessage = RED.util.cloneMessage(msg);
                    const updateText = `update: ${typeof msg.payload === "number" ? msg.payload.toFixed(2) : JSON.stringify(msg.payload).slice(0, 20)}`;
                    utils.setStatusOK(node, updateText);
                    if (done) done();
                    return;
                case "execute":
                    if (node.runtime.cachedMessage === null) {
                        utils.setStatusChanged(node, "execute: null");
                        send({ payload: null });
                    } else {
                        let outputMsg;
                        if (node.runtime.operationMode === "clone") {
                            outputMsg = RED.util.cloneMessage(node.runtime.cachedMessage);
                        } else {
                            outputMsg = { payload: node.runtime.cachedMessage.payload };
                        }
                        const executeText = `execute: ${typeof outputMsg.payload === "number" ? outputMsg.payload.toFixed(2) : JSON.stringify(outputMsg.payload).slice(0, 20)}`;
                        utils.setStatusChanged(node, executeText);
                        send(outputMsg);
                    }
                    if (done) done();
                    return;
                case "reset":
                    // Validate payload
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload");
                        if (done) done();
                        return;
                    }

                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        utils.setStatusError(node, "invalid reset");
                        if (done) done();
                        return;
                    }
                    
                    node.runtime.cachedMessage = null;
                    utils.setStatusOK(node, "reset");
                    if (done) done();
                    return;
                default:
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("cache-block", CacheBlockNode);
};