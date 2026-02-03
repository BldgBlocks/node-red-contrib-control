module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AndBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.inputs = Array(parseInt(config.slots) || 2).fill(false);
        node.slots = parseInt(config.slots);

        utils.setStatusOK(node, `slots: ${node.slots}`);

        // Initialize fields
        let lastResult = null;
        let lastInputs = node.inputs.slice();
        let lastOutputTime = 0;           // Track last output timestamp for debounce
        let lastOutputValue = undefined;  // Track last output value for duplicate suppression
        const DEBOUNCE_MS = 500;          // Debounce period in milliseconds

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
                    const result = node.inputs.every(v => v === true);
                    const isUnchanged = result === lastResult && node.inputs.every((v, i) => v === lastInputs[i]);
                    const statusText = `in: [${node.inputs.join(", ")}], out: ${result}`;
                    
                    // ================================================================
                    // Debounce: Suppress consecutive same outputs within 500ms
                    // But always output if value is different or debounce time expired
                    // ================================================================
                    const now = Date.now();
                    const timeSinceLastOutput = now - lastOutputTime;
                    const isSameOutput = result === lastOutputValue;
                    const shouldSuppress = isSameOutput && timeSinceLastOutput < DEBOUNCE_MS;
                    
                    if (shouldSuppress) {
                        // Same output within debounce window - don't send, just update status
                        utils.setStatusUnchanged(node, statusText);
                    } else {
                        // Different output or debounce period expired - send it
                        if (isUnchanged) {
                            utils.setStatusUnchanged(node, statusText);
                        } else {
                            utils.setStatusChanged(node, statusText);
                        }
                        
                        // Record output for next debounce comparison
                        lastOutputTime = now;
                        lastOutputValue = result;
                        
                        // Send output to allow all downstream branches to update
                        send({ payload: result });
                    }
                    
                    lastResult = result;
                    lastInputs = node.inputs.slice();
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

    RED.nodes.registerType("and-block", AndBlockNode);
};