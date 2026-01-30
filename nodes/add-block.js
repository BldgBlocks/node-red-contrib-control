module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AddBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.slots = parseInt(config.slots) || 2;
        node.inputs = Array(parseInt(config.slots) || 2).fill(0);

        let lastSum = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Check for required properties
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
                if (typeof msg.payload !== "boolean") {
                    utils.setStatusError(node, "invalid reset");
                    if (done) done();
                    return;
                }
                if (msg.payload === true) {
                    node.inputs = Array(node.slots).fill(0);
                    lastSum = null;
                    utils.setStatusOK(node, "state reset");
                    if (done) done();
                    return;
                }
            } else if (msg.context === "slots") {
                let newSlots = parseInt(msg.payload);
                if (isNaN(newSlots) || newSlots < 1) {
                    utils.setStatusError(node, "invalid slots");
                    if (done) done();
                    return;
                }
                node.slots = newSlots;
                node.inputs = Array(newSlots).fill(0);
                lastSum = null;
                utils.setStatusOK(node, `slots: ${node.slots}`);
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                let slotIndex = parseInt(msg.context.slice(2)) - 1;
                if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= node.slots) {
                    utils.setStatusError(node, `invalid input slot ${msg.context}`);
                    if (done) done();
                    return;
                }
                let newValue = parseFloat(msg.payload);
                if (isNaN(newValue)) {
                    utils.setStatusError(node, "invalid input");
                    if (done) done();
                    return;
                }
                node.inputs[slotIndex] = newValue;
                // Calculate sum
                const sum = node.inputs.reduce((acc, val) => acc + val, 0);
                const isUnchanged = sum === lastSum;
                const statusText = `${msg.context}: ${newValue.toFixed(2)}, sum: ${sum.toFixed(2)}`;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, statusText);
                } else {
                    utils.setStatusChanged(node, statusText);
                }
                lastSum = sum;
                send({ payload: sum });
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

    RED.nodes.registerType("add-block", AddBlockNode);
};