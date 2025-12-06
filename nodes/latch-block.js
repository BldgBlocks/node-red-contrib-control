module.exports = function(RED) {
    function LatchBlockNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        // Initialize state from config
        node.state = config.state;

        // Set initial status
        node.status({
            fill: "green",
            shape: "dot",
            text: `state: ${node.state}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Validate context
            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid context" });
                if (done) done();
                return;
            }

            // Handle context commands
            switch (msg.context) {
                case "set":
                    if (node.state) {
                        node.status({ fill: "blue", shape: "ring", text: `state: ${node.state}` });
                    } else {
                        if (msg.payload) {
                            node.state = true;
                            node.status({ fill: "blue", shape: "dot", text: `state: ${node.state}` });
                        } else {
                            node.status({ fill: "blue", shape: "ring", text: `state: ${node.state}` });
                        }
                    }
                    // Output latch value regardless
                    send({ payload: node.state });
                    break;
                case "reset":
                    if (node.state === false) {
                        node.status({ fill: "blue", shape: "ring", text: `state: ${node.state}` });
                    } else {
                        if (msg.payload) {
                            node.state = false;
                            node.status({ fill: "blue", shape: "dot", text: `state: ${node.state}` });
                        } else {
                            node.status({ fill: "blue", shape: "ring", text: `state: ${node.state}` });
                        }
                    }
                    send({ payload: node.state });
                    break;
                default:
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
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