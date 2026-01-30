module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function RateOfChangeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;
        
        // Initialize state
        node.maxSamples = parseInt(config.sampleSize);
        node.inputProperty = config.inputProperty || "payload";
        node.samples = []; // Array of {timestamp: Date, value: number}
        node.units = config.units || "minutes"; // minutes, seconds, hours
        node.lastRate = null;
        node.minValid = parseFloat(config.minValid);
        node.maxValid = parseFloat(config.maxValid);

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

            // Acceptable fallbacks
            if (isNaN(node.maxSamples) || node.maxSamples < 2) {
                node.maxSamples = 10;
                utils.setStatusError(node, "invalid sample size, using 10");
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
                        if (typeof msg.payload !== "boolean") {
                            utils.setStatusError(node, "invalid reset");
                            if (done) done();
                            return;
                        }
                        if (msg.payload === true) {
                            node.samples = [];
                            node.lastRate = null;
                            utils.setStatusOK(node, "state reset");
                        }
                        break;
                        
                    case "sampleSize":
                        let newMaxSamples = parseInt(msg.payload);
                        if (isNaN(newMaxSamples) || newMaxSamples < 2) {
                            utils.setStatusError(node, "sample size must be at least 2");
                            if (done) done();
                            return;
                        }
                        node.maxSamples = newMaxSamples;
                        // Trim samples if new window is smaller
                        if (node.samples.length > newMaxSamples) {
                            node.samples = node.samples.slice(-newMaxSamples);
                        }
                        utils.setStatusOK(node, `samples: ${newMaxSamples}`);
                        break;
                        
                    case "units":
                        const validUnits = ["seconds", "minutes", "hours"];
                        if (typeof msg.payload === "string" && validUnits.includes(msg.payload.toLowerCase())) {
                            node.units = msg.payload.toLowerCase();
                            utils.setStatusOK(node, `units: ${msg.payload}`);
                        } else {
                            utils.setStatusError(node, "invalid units");
                        }
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

            // Get input from configured property
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            // Process input
            const inputValue = parseFloat(input);
            const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
            
            if (isNaN(inputValue) || inputValue < node.minValid || inputValue > node.maxValid) {
                utils.setStatusWarn(node, "out of range");
                if (done) done();
                return;
            }

            // Add new sample
            node.samples.push({ timestamp: timestamp, value: inputValue });
            
            // Maintain sample window
            if (node.samples.length > node.maxSamples + 1) {
                node.samples = node.samples.slice(-node.maxSamples);
            } else if (node.samples.length > node.maxSamples) {
                node.samples.shift();
            }

            // Calculate rate of change (temperature per time unit)
            let rate = null;
            // Require at least 20% of samples for calculation
            if (node.samples.length >= node.maxSamples * 0.20) { 
                // Use linear regression for more stable rate calculation
                const n = node.samples.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
                
                // Convert timestamps to relative time in the selected units
                const baseTime = node.samples[0].timestamp;
                let timeScale; // Conversion factor from ms to selected units
                
                switch (node.units) {
                    case "seconds":
                        timeScale = 1000; // ms to seconds
                        break;
                    case "minutes":
                        timeScale = 1000 * 60; // ms to minutes
                        break;
                    case "hours":
                        timeScale = 1000 * 60 * 60; // ms to hours
                        break;
                    default:
                        timeScale = 1000 * 60; // default to minutes
                }
                
                // Calculate regression sums
                node.samples.forEach((sample, i) => {
                    // Time in selected units
                    const x = (sample.timestamp - baseTime) / timeScale;
                    const y = sample.value;
                    
                    sumX += x;
                    sumY += y;
                    sumXY += x * y;
                    sumXX += x * x;
                });
                
                // Calculate slope (rate of change) using linear regression formula
                const denominator = n * sumXX - sumX * sumX;
                
                // Avoid division by zero - use original endpoint method if regression fails
                if (Math.abs(denominator) > 1e-10) { // Small tolerance for floating point
                    rate = (n * sumXY - sumX * sumY) / denominator;
                } else {
                    // Fallback to original endpoint method if regression is unstable
                    const firstSample = node.samples[0];
                    const lastSample = node.samples[node.samples.length - 1];
                    const timeDiff = (lastSample.timestamp - firstSample.timestamp) / timeScale;
                    rate = timeDiff > 0 ? (lastSample.value - firstSample.value) / timeDiff : 0;
                }
            }

            const isUnchanged = rate === node.lastRate;

            // Send new message
            const unitsDisplay = {
                seconds: "/sec",
                minutes: "/min",
                hours: "/hr"
            };

            if (isUnchanged) {
                utils.setStatusUnchanged(node, `rate: ${rate !== null ? rate.toFixed(2) : "not ready"} ${unitsDisplay[node.units] || "/min"}`);
            } else {
                utils.setStatusChanged(node, `rate: ${rate !== null ? rate.toFixed(2) : "not ready"} ${unitsDisplay[node.units] || "/min"}`);
            }
            
            node.lastRate = rate;
            
            // Enhanced output with metadata
            const outputMsg = {
                payload: rate,
                samples: node.samples.length,
                units: `${unitsDisplay[node.units] || "/min"}`,
                currentValue: inputValue,
                timeSpan: node.samples.length >= 2 ? 
                    (node.samples[node.samples.length - 1].timestamp - node.samples[0].timestamp) / 1000 : 0
            };
            
            if (node.samples.length >= node.maxSamples) {
                send(outputMsg);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("rate-of-change-block", RateOfChangeNode);
};
