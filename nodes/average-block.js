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
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }    

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
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
                node.status({ fill: "red", shape: "ring", text: `invalid evaluated values ${node.runtime.minValid}, ${node.runtime.maxValid}` });
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                
                switch (msg.context) {
                    case "reset":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                            if (done) done();
                            return;
                        }
                        if (msg.payload === true) {
                            node.runtime.values = [];
                            node.runtime.lastAvg = null;
                            node.status({ fill: "green", shape: "dot", text: "state reset" });
                        }
                        break;
                        
                    case "sampleSize":
                        let newMaxValues = parseInt(msg.payload);
                        if (isNaN(newMaxValues) || newMaxValues < 1) {
                            node.status({ fill: "red", shape: "ring", text: "invalid window size" });
                            if (done) done();
                            return;
                        }
                        node.runtime.maxValues = newMaxValues;
                        // Trim values if new window is smaller
                        if (node.runtime.values.length > newMaxValues) {
                            node.runtime.values = node.runtime.values.slice(-newMaxValues);
                        }
                        node.status({ fill: "green", shape: "dot", text: `window: ${newMaxValues}` });
                        break;
                        
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        break;
                }                
                if (done) done();
                return;
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process input
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue) || inputValue < node.runtime.minValid || inputValue > node.runtime.maxValid) {
                node.status({ fill: "yellow", shape: "ring", text: "out of range" });
                if (done) done();
                return;
            }

            // Update rolling window
            node.runtime.values.push(inputValue);
            if (node.runtime.values.length > node.runtime.maxValues) {
                node.runtime.values.shift();
            }

            // Calculate average
            const avg = node.runtime.values.length ? node.runtime.values.reduce((a, b) => a + b, 0) / node.runtime.values.length : null;
            const isUnchanged = avg === node.runtime.lastAvg;

            // Send new message
            node.status({ fill: "blue", shape: isUnchanged ? "ring" : "dot", text: `out: ${avg !== null ? avg.toFixed(3) : "null"}` });
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