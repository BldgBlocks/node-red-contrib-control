module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function SubtractBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            slots: parseInt(config.slots),
            inputs: Array(parseInt(config.slots)).fill(0),
            lastResult: null
        };

        // Validate initial config
        if (isNaN(node.runtime.slots) || node.runtime.slots < 1) {
            node.runtime.slots = 2;
            node.runtime.inputs = Array(2).fill(0);
            utils.setStatusError(node, "invalid slots, using 2");
        } else {
            utils.setStatusOK(node, `name: ${node.runtime.name}, slots: ${node.runtime.slots}`);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Check for missing context or payload
            if (!msg.hasOwnProperty("context")) {
                utils.setStatusError(node, "missing context");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.context === "reset") {
                const boolVal = utils.validateBoolean(msg.payload);
                if (!boolVal.valid) {
                    utils.setStatusError(node, boolVal.error);
                    if (done) done();
                    return;
                }
                if (boolVal.value === true) {
                    node.runtime.inputs = Array(node.runtime.slots).fill(0);
                    node.runtime.lastResult = null;
                    utils.setStatusOK(node, "state reset");
                    if (done) done();
                    return;
                }
            } else if (msg.context.startsWith("in")) {
                const slotVal = utils.validateSlotIndex(msg.context, node.runtime.slots);
                if (!slotVal.valid) {
                    utils.setStatusError(node, slotVal.error);
                    if (done) done();
                    return;
                }
                const slotIndex = slotVal.index - 1;
                let newValue = parseFloat(msg.payload);
                if (isNaN(newValue)) {
                    utils.setStatusError(node, "invalid input");
                    if (done) done();
                    return;
                }
                node.runtime.inputs[slotIndex] = newValue;
                
                // Calculate subtraction
                const result = node.runtime.inputs.reduce((acc, val, idx) => idx === 0 ? val : acc - val, 0);
                const isUnchanged = result === node.runtime.lastResult;
                const statusText = `${msg.context}: ${newValue.toFixed(2)}, diff: ${result.toFixed(2)}`;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, statusText);
                } else {
                    utils.setStatusChanged(node, statusText);
                }

                node.runtime.lastResult = result;
                send({ payload: result });

                if (done) done();
                return;
            } else {
                utils.setStatusWarn(node, "unknown context");
                if (done) done();
                return;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("subtract-block", SubtractBlockNode);
};