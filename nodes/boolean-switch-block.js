module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function BooleanSwitchBlockNode(config) {
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
                case "toggle":
                    node.state = !node.state;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `state: ${node.state}`
                    });
                    send([null, null, { payload: node.state }]);
                    break;
                case "switch":
                    node.state = !!msg.payload;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `state: ${node.state}`
                    });
                    send([null, null, { payload: node.state }]);
                    break;
                case "inTrue":
                    if (node.state) {
                        node.status({
                            fill: "blue",
                            shape: "dot",
                            text: `out: ${msg.payload}`
                        });
                        send([msg, null, { payload: node.state }]);
                    }
                    break;
                case "inFalse":
                    if (!node.state) {
                        node.status({
                            fill: "blue",
                            shape: "dot",
                            text: `out: ${msg.payload}`
                        });
                        send([null, msg, { payload: node.state }]);
                    }
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

    RED.nodes.registerType("boolean-switch-block", BooleanSwitchBlockNode);
};