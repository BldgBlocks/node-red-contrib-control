module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function OrBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.inputs = Array(parseInt(config.slots) || 2).fill(false)
        node.slots = parseInt(config.slots);

        utils.setStatusOK(node, `slots: ${node.slots}`);

        // Initialize logic fields
        let lastResult = null;
        let lastInputs = node.inputs.slice();

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Check required properties
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

            // Process input slot
            if (msg.context.startsWith("in")) {
                const slotVal = utils.validateSlotIndex(msg.context, node.slots);
                if (slotVal.valid) {
                    node.inputs[slotVal.index - 1] = Boolean(msg.payload);
                    const result = node.inputs.some(v => v === true);
                    const isUnchanged = result === lastResult && node.inputs.every((v, i) => v === lastInputs[i]);
                    if (isUnchanged) {
                        utils.setStatusUnchanged(node, `in: [${node.inputs.join(", ")}], out: ${result}`);
                    } else {
                        utils.setStatusChanged(node, `in: [${node.inputs.join(", ")}], out: ${result}`);
                    }
                    lastResult = result;
                    lastInputs = node.inputs.slice();
                    send({ payload: result });
                    if (done) done();
                    return;
                } else {
                    utils.setStatusError(node, slotVal.error);
                    if (done) done();
                    return;
                }
            }

            utils.setStatusWarn(node, "unknown context");
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("or-block", OrBlockNode);
};