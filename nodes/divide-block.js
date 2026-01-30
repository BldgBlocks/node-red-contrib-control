module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function DivideBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.slots = parseInt(config.slots);
        node.inputs = Array(config.slots).fill(1).map(x => parseFloat(x));
        node.lastResult = null;

        utils.setStatusOK(node, `name: ${node.name}, slots: ${node.slots}`);

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
                    node.inputs = Array(node.slots).fill(1);
                    node.lastResult = null;
                    utils.setStatusOK(node, "state reset");
                    if (done) done();
                    return;
                }
            } else if (msg.context === "slots") {
                const slotsVal = utils.validateIntRange(msg.payload, { min: 1 });
                if (!slotsVal.valid) {
                    utils.setStatusError(node, slotsVal.error);
                    if (done) done();
                    return;
                }
                node.slots = slotsVal.value;
                node.inputs = Array(newSlots).fill(1);
                node.lastResult = null;
                utils.setStatusOK(node, `slots: ${node.slots}`);
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                const slotVal = utils.validateSlotIndex(msg.context, node.slots);
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
                if (slotIndex > 0 && newValue === 0) {
                    utils.setStatusError(node, "divide by zero");
                    if (done) done();
                    return;
                }
                // Handle division by very small numbers approaching zero
                if (slotIndex > 0 && Math.abs(newValue) < 1e-10) {  // Near-zero check
                    utils.setStatusError(node, "divide by near-zero");
                    if (done) done();
                    return;
                }
                node.inputs[slotIndex] = newValue;
                // Calculate division
                const result = node.inputs.reduce((acc, val, idx) => idx === 0 ? val : acc / val, 1);
                const isUnchanged = result === node.lastResult;
                const statusText = `in: ${msg.context}=${newValue.toFixed(2)}, out: ${result.toFixed(2)}`;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, statusText);
                } else {
                    utils.setStatusChanged(node, statusText);
                }
                node.lastResult = result;
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

    RED.nodes.registerType("divide-block", DivideBlockNode);
};