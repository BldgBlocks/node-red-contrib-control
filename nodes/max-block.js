module.exports = function(RED) {
    const utils = require('./utils')(RED);
    
    function MaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            max: parseFloat(config.max)
        };

        // Store last output value for status
        let lastOutput = null;

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.maxType) 
                        ? utils.evaluateNodeProperty(config.max, config.maxType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.max),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.runtime.max = results[0];       
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Validate values
            if (isNaN(node.runtime.max)) {
                utils.setStatusError(node, "invalid evaluated values");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload for max");
                    if (done) done();
                    return;
                }
                if (msg.context === "max" || msg.context === "setpoint") {
                    const maxValue = parseFloat(msg.payload);
                    if (!isNaN(maxValue) && maxValue >= 0) {
                        node.runtime.max = maxValue;
                        utils.setStatusOK(node, `max: ${maxValue}`);
                    } else {
                        utils.setStatusError(node, "invalid max");
                    }
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                utils.setStatusError(node, "invalid payload");
                if (done) done();
                return;
            }

            // Cap input at max
            const outputValue = Math.min(inputValue, node.runtime.max);

            // Update status and send output
            msg.payload = outputValue;
            const statusText = `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`;
            if (lastOutput === outputValue) {
                utils.setStatusUnchanged(node, statusText);
            } else {
                utils.setStatusChanged(node, statusText);
            }
            lastOutput = outputValue;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("max-block", MaxBlockNode);
};