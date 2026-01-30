module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AnalogSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.slots = parseInt(config.slots, 10);
        node.inputs = Array(parseInt(config.slots, 10) || 2).fill(0);
        node.switch = 1;

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

            // Validate payload
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            let shouldOutput = false;
            const prevSwitch = node.switch;

            switch (msg.context) {
                case "switch":
                    const switchValue = parseInt(msg.payload, 10);
                    if (isNaN(switchValue) || switchValue < 1 || switchValue > node.slots) {
                        utils.setStatusError(node, "invalid switch");
                        if (done) done();
                        return;
                    }
                    node.switch = switchValue;
                    shouldOutput = prevSwitch !== node.switch;
                    utils.setStatusOK(node, `switch: ${node.switch}`);
                    break;
                default:
                    if (msg.context.startsWith("in")) {
                        const index = parseInt(msg.context.slice(2), 10);
                        if (isNaN(index) || index < 1 || index > node.slots) {
                            utils.setStatusError(node, `invalid input index ${index}`);
                            if (done) done();
                            return;
                        }
                        const value = parseFloat(msg.payload);
                        if (isNaN(value)) {
                            utils.setStatusError(node, `invalid in${index}`);
                            if (done) done();
                            return;
                        }
                        node.inputs[index - 1] = value;
                        shouldOutput = index === node.switch;
                        utils.setStatusOK(node, `in${index}: ${value.toFixed(2)}`);
                    } else {
                        utils.setStatusWarn(node, "unknown context");
                        if (done) done("Unknown context");
                        return;
                    }
                    break;
            }

            // Output new message if the active slot is updated or switch/slots change affects output
            if (shouldOutput) {
                const out = node.inputs[node.switch - 1] ?? node.inputs[0];
                utils.setStatusChanged(node, `slots: ${node.slots}, switch: ${node.switch}, out: ${out.toFixed(2)}`);
                send({ payload: out });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }
    
    RED.nodes.registerType("analog-switch-block", AnalogSwitchBlockNode);
};