module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AddBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.slots = parseInt(config.slots) || 2;
        node.inputs = Array(parseInt(config.slots) || 2).fill(0);
        node.operationMode = config.operationMode === "map" ? "map" : "context";
        node.outputProperty = typeof config.outputProperty === "string" && config.outputProperty.trim() ? config.outputProperty.trim() : "payload";
        node.mappings = Array.isArray(config.mappings) ? config.mappings.filter(mapping => {
            return mapping && typeof mapping.property === "string" && mapping.property.trim() &&
                utils.validateSlotIndex(`in${mapping.input}`, node.slots).valid;
        }) : [];

        let lastSum = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            if (node.operationMode === "map") {
                const updates = [];
                for (const mapping of node.mappings) {
                    const value = RED.util.getMessageProperty(msg, mapping.property);
                    if (value === undefined) continue;
                    const numericValue = utils.validateNumericPayload(value);
                    if (!numericValue.valid) {
                        utils.setStatusError(node, `invalid ${mapping.property}`);
                        if (done) done();
                        return;
                    }
                    updates.push({ index: mapping.input - 1, value: numericValue.value });
                }
                if (updates.length === 0) {
                    utils.setStatusWarn(node, "no mapped properties found");
                    if (done) done();
                    return;
                }
                updates.forEach(update => { node.inputs[update.index] = update.value; });
                const sum = node.inputs.reduce((acc, value) => acc + value, 0);
                const statusText = `in: [${node.inputs.join(", ")}], sum: ${sum.toFixed(2)}`;
                sum === lastSum ? utils.setStatusUnchanged(node, statusText) : utils.setStatusChanged(node, statusText);
                lastSum = sum;
                const output = {};
                RED.util.setMessageProperty(output, node.outputProperty, sum, true);
                send(output);
                if (done) done();
                return;
            }

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
                const numericValue = utils.validateNumericPayload(msg.payload);
                if (!numericValue.valid) {
                    utils.setStatusError(node, "invalid input");
                    if (done) done();
                    return;
                }
                const newValue = numericValue.value;
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
                const output = {};
                RED.util.setMessageProperty(output, node.outputProperty, sum, true);
                send(output);
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