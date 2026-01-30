module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function BooleanSwitchBlockNode(config) {
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
                case "toggle":
                    node.state = !node.state;
                    utils.setStatusChanged(node, `state: ${node.state}`);
                    send([null, null, { payload: node.state }]);
                    break;
                case "switch":
                    node.state = !!msg.payload;
                    utils.setStatusChanged(node, `state: ${node.state}`);
                    send([null, null, { payload: node.state }]);
                    break;
                case "inTrue":
                    if (node.state) {
                        utils.setStatusOK(node, `out: ${msg.payload}`);
                        send([msg, null, { payload: node.state }]);
                    }
                    break;
                case "inFalse":
                    if (!node.state) {
                        utils.setStatusOK(node, `out: ${msg.payload}`);
                        send([null, msg, { payload: node.state }]);
                    }
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

    RED.nodes.registerType("boolean-switch-block", BooleanSwitchBlockNode);
};