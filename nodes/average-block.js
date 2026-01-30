module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AverageBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            maxValues: parseInt(config.sampleSize),
            values: [], // Queue for rolling window
            lastAvg: null,
            minValid: parseFloat(config.minValid),
            maxValid: parseFloat(config.maxValid)
        };

        node.isBusy = false;

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
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
                    utils.requiresEvaluation(config.minValidType) 
                        ? utils.evaluateNodeProperty(config.minValid, config.minValidType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.minValid),
                );
                
                evaluations.push(
                    utils.requiresEvaluation(config.maxValidType) 
                        ? utils.evaluateNodeProperty(config.maxValid, config.maxValidType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.maxValid),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.runtime.minValid = results[0];
                if (!isNaN(results[1])) node.runtime.maxValid = results[1];         
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Validate values
            if (isNaN(node.runtime.maxValid) || isNaN(node.runtime.minValid) || node.runtime.maxValid <= node.runtime.minValid ) {
                utils.setStatusError(node, `invalid evaluated values ${node.runtime.minValid}, ${node.runtime.maxValid}`);
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }
                
                switch (msg.context) {
                    case "reset":
                        const boolVal = utils.validateBoolean(msg.payload);
                        if (!boolVal.valid) {
                            utils.setStatusError(node, boolVal.error);
                            if (done) done();
                            return;
                        }
                        if (boolVal.value === true) {
                            node.runtime.values = [];
                            node.runtime.lastAvg = null;
                            utils.setStatusOK(node, "state reset");
                        }
                        break;
                        
                    case "sampleSize":
                        const sizeVal = utils.validateIntRange(msg.payload, { min: 1 });
                        if (!sizeVal.valid) {
                            utils.setStatusError(node, sizeVal.error);
                            if (done) done();
                            return;
                        }
                        node.runtime.maxValues = sizeVal.value;
                        // Trim values if new window is smaller
                        if (node.runtime.values.length > newMaxValues) {
                            node.runtime.values = node.runtime.values.slice(-newMaxValues);
                        }
                        utils.setStatusOK(node, `window: ${newMaxValues}`);
                        break;
                        
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        break;
                }                
                if (done) done();
                return;
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            // Process input
            const numVal = utils.validateNumericPayload(msg.payload, { min: node.runtime.minValid, max: node.runtime.maxValid });
            if (!numVal.valid) {
                utils.setStatusWarn(node, "out of range");
                if (done) done();
                return;
            }
            const inputValue = numVal.value;

            // Update rolling window
            node.runtime.values.push(inputValue);
            if (node.runtime.values.length > node.runtime.maxValues) {
                node.runtime.values.shift();
            }

            // Calculate average
            const avg = node.runtime.values.length ? node.runtime.values.reduce((a, b) => a + b, 0) / node.runtime.values.length : null;
            const isUnchanged = avg === node.runtime.lastAvg;

            // Send new message
            if (isUnchanged) {
                utils.setStatusUnchanged(node, `out: ${avg !== null ? avg.toFixed(3) : "null"}`);
            } else {
                utils.setStatusChanged(node, `out: ${avg !== null ? avg.toFixed(3) : "null"}`);
            }
            node.runtime.lastAvg = avg;
            send({ payload: avg });

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("average-block", AverageBlockNode);
};