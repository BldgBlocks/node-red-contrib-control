module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function BooleanSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize state from config (coerce to boolean)
        node.state = !!config.state;
        node.operationMode = config.operationMode === "map" ? "map" : "context";
        node.switchProperty = typeof config.switchProperty === "string" && config.switchProperty.trim() ?
            config.switchProperty.trim() : "switch";
        node.trueProperty = typeof config.trueProperty === "string" && config.trueProperty.trim() ?
            config.trueProperty.trim() : "payload";
        node.falseProperty = typeof config.falseProperty === "string" ? config.falseProperty.trim() : "";

        // Set initial status
        utils.setStatusOK(node, `mode: ${node.operationMode}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            if (node.operationMode === "map") {
                const switchValue = RED.util.getMessageProperty(msg, node.switchProperty);
                if (switchValue !== undefined) {
                    const newState = Boolean(switchValue);
                    if (newState === node.state) {
                        utils.setStatusUnchanged(node, `switch: ${node.state}`);
                    } else {
                        node.state = newState;
                        utils.setStatusChanged(node, `switch: ${node.state}`);
                    }
                    if (done) done();
                    return;
                }

                const activeProperty = node.state ? node.trueProperty : node.falseProperty;
                if (activeProperty && RED.util.getMessageProperty(msg, activeProperty) !== undefined) {
                    utils.setStatusOK(node, `switch: ${node.state}, ${activeProperty}`);
                    send(node.state ? [msg, null, null] : [null, msg, null]);
                } else {
                    utils.setStatusUnchanged(node, `switch: ${node.state}, gated`);
                }
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
                case "toggle": {
                    node.state = !node.state;
                    utils.setStatusChanged(node, `state: ${node.state}`);
                    send([null, null, { payload: node.state }]);
                    break;
                }

                case "switch": {
                    const newState = !!msg.payload;
                    if (newState === node.state) {
                        utils.setStatusUnchanged(node, `state: ${node.state}`);
                    } else {
                        node.state = newState;
                        utils.setStatusChanged(node, `state: ${node.state}`);
                    }
                    send([null, null, { payload: node.state }]);
                    break;
                }
                case "inTrue":
                    if (node.state) {
                        utils.setStatusOK(node, `outTrue: ${msg.payload}`);
                        send([msg, null, null]);
                    }
                    break;

                case "inFalse":
                    if (!node.state) {
                        utils.setStatusOK(node, `outFalse: ${msg.payload}`);
                        send([null, msg, null]);
                    }
                    break;

                default:
                    utils.setStatusWarn(node, `unknown context: ${msg.context}`);
                    if (done) done("Unknown context: " + msg.context);
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