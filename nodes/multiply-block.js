module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function MultiplyBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.slots = parseInt(config.slots);
        node.inputs = Array(parseInt(config.slots) || 2).fill(1);
        node.lastResult = null;
        node.operationMode = config.operationMode === "map" ? "map" : "context";
        node.outputProperty = typeof config.outputProperty === "string" && config.outputProperty.trim() ? config.outputProperty.trim() : "payload";
        node.mappings = Array.isArray(config.mappings) ? config.mappings.filter(mapping => {
            return mapping && typeof mapping.property === "string" && mapping.property.trim() &&
                utils.validateSlotIndex(`in${mapping.input}`, node.slots).valid;
        }) : [];

        // Validate initial config
        if (isNaN(node.slots) || node.slots < 1) {
            node.slots = 2;
            node.inputs = Array(2).fill(1);
            utils.setStatusError(node, "invalid slots, using 2");
        } else {
            utils.setStatusOK(node, `name: ${node.name}, slots: ${node.slots}`);
        }

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
                const product = node.inputs.reduce((acc, value) => acc * value, 1);
                const statusText = `in: [${node.inputs.join(", ")}], product: ${product.toFixed(2)}`;
                product === node.lastResult ? utils.setStatusUnchanged(node, statusText) : utils.setStatusChanged(node, statusText);
                node.lastResult = product;
                const output = {};
                RED.util.setMessageProperty(output, node.outputProperty, product, true);
                send(output);
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
                let newSlots = parseInt(msg.payload);
                if (isNaN(newSlots) || newSlots < 1) {
                    utils.setStatusError(node, "invalid slots");
                    if (done) done();
                    return;
                }
                node.slots = newSlots;
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
                const numericValue = utils.validateNumericPayload(msg.payload);
                if (!numericValue.valid) {
                    utils.setStatusError(node, "invalid input");
                    if (done) done();
                    return;
                }
                const newValue = numericValue.value;
                node.inputs[slotIndex] = newValue;
                // Calculate product
                const product = node.inputs.reduce((acc, val) => acc * val, 1);
                const isUnchanged = product === node.lastResult;
                const statusText = `in: ${msg.context}=${newValue.toFixed(2)}, out: ${product.toFixed(2)}`;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, statusText);
                } else {
                    utils.setStatusChanged(node, statusText);
                }
                node.lastResult = product;
                const output = {};
                RED.util.setMessageProperty(output, node.outputProperty, product, true);
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

    RED.nodes.registerType("multiply-block", MultiplyBlockNode);
};