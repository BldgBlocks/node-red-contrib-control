module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ExtremaBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.slots = parseInt(config.slots, 10) || 2;
        node.inputs = Array(node.slots).fill(0);
        node.mode = config.mode === "maximum" ? "maximum" : "minimum";
        node.operationMode = config.operationMode === "context" ? "context" : "map";
        node.outputProperty = typeof config.outputProperty === "string" && config.outputProperty.trim() ? config.outputProperty.trim() : "payload";
        node.mappings = Array.isArray(config.mappings) ? config.mappings.filter(mapping => {
            return mapping && typeof mapping.property === "string" && mapping.property.trim() &&
                utils.validateSlotIndex(`in${mapping.input}`, node.slots).valid;
        }) : [];

        let lastResult = null;
        let lastInputs = node.inputs.slice();

        utils.setStatusOK(node, `slots: ${node.slots}, mode: ${node.mode}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            let updated = false;
            if (node.operationMode === "map") {
                for (const mapping of node.mappings) {
                    const value = RED.util.getMessageProperty(msg, mapping.property);
                    if (value === undefined) continue;
                    const numericValue = utils.validateNumericPayload(value);
                    if (!numericValue.valid) {
                        utils.setStatusError(node, `invalid ${mapping.property}`);
                        if (done) done();
                        return;
                    }
                    node.inputs[mapping.input - 1] = numericValue.value;
                    updated = true;
                }
                if (!updated) {
                    utils.setStatusWarn(node, "no mapped properties found");
                    if (done) done();
                    return;
                }
            } else {
                if (!msg.hasOwnProperty("context") || !msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, !msg.hasOwnProperty("context") ? "missing context" : "missing payload");
                    if (done) done();
                    return;
                }
                const slot = utils.validateSlotIndex(msg.context, node.slots);
                if (!slot.valid) {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                const numericValue = utils.validateNumericPayload(msg.payload);
                if (!numericValue.valid) {
                    utils.setStatusError(node, numericValue.error);
                    if (done) done();
                    return;
                }
                node.inputs[slot.index - 1] = numericValue.value;
            }

            const result = node.mode === "maximum" ? Math.max(...node.inputs) : Math.min(...node.inputs);
            const isUnchanged = result === lastResult && node.inputs.every((value, index) => value === lastInputs[index]);
            const statusText = `in: [${node.inputs.join(", ")}], ${node.mode}: ${result}`;
            if (isUnchanged) utils.setStatusUnchanged(node, statusText);
            else utils.setStatusChanged(node, statusText);

            const output = {};
            RED.util.setMessageProperty(output, node.outputProperty, result, true);
            send(output);
            lastResult = result;
            lastInputs = node.inputs.slice();
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("extrema-block", ExtremaBlockNode);
};