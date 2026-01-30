module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function LatchBlockNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        // Initialize state from config
        node.state = config.state;

        // Set initial status
        utils.setStatusOK(node, `state: ${node.state}`);

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
                utils.setStatusError(node, "missing or invalid context");
                if (done) done();
                return;
            }

            // Handle context commands
            switch (msg.context) {
                case "set":
                    if (node.state) {
                        utils.setStatusUnchanged(node, `state: ${node.state}`);
                    } else {
                        if (msg.payload) {
                            node.state = true;
                            utils.setStatusChanged(node, `state: ${node.state}`);
                        } else {
                            utils.setStatusUnchanged(node, `state: ${node.state}`);
                        }
                    }
                    // Output latch value regardless
                    send({ payload: node.state });
                    break;
                case "reset":
                    if (node.state === false) {
                        utils.setStatusUnchanged(node, `state: ${node.state}`);
                    } else {
                        if (msg.payload) {
                            node.state = false;
                            utils.setStatusChanged(node, `state: ${node.state}`);
                        } else {
                            node.status({ fill: "blue", shape: "ring", text: `state: ${node.state}` });
                        }
                    }
                    send({ payload: node.state });
                    break;
                default:
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
            }
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("latch-block", LatchBlockNode);
};