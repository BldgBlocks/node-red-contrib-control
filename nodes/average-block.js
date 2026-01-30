module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AverageBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        // Initialize state
        node.maxValues = parseInt(config.sampleSize);
        node.values = [], // Queue for rolling window;
        node.lastAvg = null;
        node.minValid = parseFloat(config.minValid);
        node.maxValid = parseFloat(config.maxValid);

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
                        : Promise.resolve(node.minValid),
                );
                
                evaluations.push(
                    utils.requiresEvaluation(config.maxValidType) 
                        ? utils.evaluateNodeProperty(config.maxValid, config.maxValidType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.maxValid),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.minValid = results[0];
                if (!isNaN(results[1])) node.maxValid = results[1];         
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Validate values
            if (isNaN(node.maxValid) || isNaN(node.minValid) || node.maxValid <= node.minValid ) {
                utils.setStatusError(node, `invalid evaluated values ${node.minValid}, ${node.maxValid}`);
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
                            node.values = [];
                            node.lastAvg = null;
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
                        node.maxValues = sizeVal.value;
                        // Trim values if new window is smaller
                        if (node.values.length > sizeVal.value) {
                            node.values = node.values.slice(-sizeVal.value);
                        }
                        utils.setStatusOK(node, `window: ${sizeVal.value}`);
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
            const numVal = utils.validateNumericPayload(msg.payload, { min: node.minValid, max: node.maxValid });
            if (!numVal.valid) {
                utils.setStatusWarn(node, "out of range");
                if (done) done();
                return;
            }
            const inputValue = numVal.value;

            // Update rolling window
            node.values.push(inputValue);
            if (node.values.length > node.maxValues) {
                node.values.shift();
            }

            // Calculate average
            const avg = node.values.length ? node.values.reduce((a, b) => a + b, 0) / node.values.length : null;
            const isUnchanged = avg === node.lastAvg;

            // Send new message
            if (isUnchanged) {
                utils.setStatusUnchanged(node, `out: ${avg !== null ? avg.toFixed(3) : "null"}`);
            } else {
                utils.setStatusChanged(node, `out: ${avg !== null ? avg.toFixed(3) : "null"}`);
            }
            node.lastAvg = avg;
            send({ payload: avg });

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("average-block", AverageBlockNode);
};