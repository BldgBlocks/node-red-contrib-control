module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function MultiplyBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            slots: parseInt(config.slots),
            inputs: Array(parseInt(config.slots) || 2).fill(1),
            lastResult: null
        };

        // Validate initial config
        if (isNaN(node.runtime.slots) || node.runtime.slots < 1) {
            node.runtime.slots = 2;
            node.runtime.inputs = Array(2).fill(1);
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
                if (typeof msg.payload !== "boolean") {
                    utils.setStatusError(node, "invalid reset");
                    if (done) done();
                    return;
                }
                if (msg.payload === true) {
                    node.runtime.inputs = Array(node.runtime.slots).fill(1);
                    node.runtime.lastResult = null;
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
                node.runtime.slots = newSlots;
                node.runtime.inputs = Array(newSlots).fill(1);
                node.runtime.lastResult = null;
                utils.setStatusOK(node, `slots: ${node.runtime.slots}`);
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                let slotIndex = parseInt(msg.context.slice(2)) - 1;
                if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= node.runtime.slots) {
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
                node.runtime.inputs[slotIndex] = newValue;
                // Calculate product
                const product = node.runtime.inputs.reduce((acc, val) => acc * val, 1);
                const isUnchanged = product === node.runtime.lastResult;
                const statusText = `in: ${msg.context}=${newValue.toFixed(2)}, out: ${product.toFixed(2)}`;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, statusText);
                } else {
                    utils.setStatusChanged(node, statusText);
                }
                node.runtime.lastResult = product;
                send({ payload: product });
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

    RED.nodes.registerType("multiply-block", MultiplyBlockNode);
};