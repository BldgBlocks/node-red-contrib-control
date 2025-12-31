module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function RateOfChangeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;
        
        // Initialize runtime state
        node.runtime = {
            maxSamples: parseInt(config.sampleSize),
            samples: [], // Array of {timestamp: Date, value: number}
            units: config.units || "minutes", // minutes, seconds, hours
            lastRate: null,
            minValid: parseFloat(config.minValid),
            maxValid: parseFloat(config.maxValid)
        };

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

            // Acceptable fallbacks
            if (isNaN(node.runtime.maxSamples) || node.runtime.maxSamples < 2) {
                node.runtime.maxSamples = 10;
                node.status({ fill: "red", shape: "ring", text: "invalid sample size, using 10" });
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
                            node.runtime.samples = [];
                            node.runtime.lastRate = null;
                            node.status({ fill: "green", shape: "dot", text: "state reset" });
                        }
                        break;
                        
                    case "sampleSize":
                        let newMaxSamples = parseInt(msg.payload);
                        if (isNaN(newMaxSamples) || newMaxSamples < 2) {
                            node.status({ fill: "red", shape: "ring", text: "sample size must be at least 2" });
                            if (done) done();
                            return;
                        }
                        node.runtime.maxSamples = newMaxSamples;
                        // Trim samples if new window is smaller
                        if (node.runtime.samples.length > newMaxSamples) {
                            node.runtime.samples = node.runtime.samples.slice(-newMaxSamples);
                        }
                        node.status({ fill: "green", shape: "dot", text: `samples: ${newMaxSamples}` });
                        break;
                        
                    case "units":
                        const validUnits = ["seconds", "minutes", "hours"];
                        if (typeof msg.payload === "string" && validUnits.includes(msg.payload.toLowerCase())) {
                            node.runtime.units = msg.payload.toLowerCase();
                            node.status({ fill: "green", shape: "dot", text: `units: ${msg.payload}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid units" });
                        }
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
            const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
            
            if (isNaN(inputValue) || inputValue < node.runtime.minValid || inputValue > node.runtime.maxValid) {
                node.status({ fill: "yellow", shape: "ring", text: "out of range" });
                if (done) done();
                return;
            }

            // Add new sample
            node.runtime.samples.push({ timestamp: timestamp, value: inputValue });
            
            // Maintain sample window
            if (node.runtime.samples.length > node.runtime.maxSamples + 1) {
                node.runtime.samples = node.runtime.samples.slice(-node.runtime.maxSamples);
            } else if (node.runtime.samples.length > node.runtime.maxSamples) {
                node.runtime.samples.shift();
            }

            // Calculate rate of change (temperature per time unit)
            let rate = null;
            // Require at least 20% of samples for calculation
            if (node.runtime.samples.length >= node.runtime.maxSamples * 0.20) { 
                // Use linear regression for more stable rate calculation
                const n = node.runtime.samples.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
                
                // Convert timestamps to relative time in the selected units
                const baseTime = node.runtime.samples[0].timestamp;
                let timeScale; // Conversion factor from ms to selected units
                
                switch (node.runtime.units) {
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
                node.runtime.samples.forEach((sample, i) => {
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
                    const firstSample = node.runtime.samples[0];
                    const lastSample = node.runtime.samples[node.runtime.samples.length - 1];
                    const timeDiff = (lastSample.timestamp - firstSample.timestamp) / timeScale;
                    rate = timeDiff > 0 ? (lastSample.value - firstSample.value) / timeDiff : 0;
                }
            }

            const isUnchanged = rate === node.runtime.lastRate;

            // Send new message
            const unitsDisplay = {
                seconds: "/sec",
                minutes: "/min",
                hours: "/hr"
            };

            node.status({ 
                fill: "blue", 
                shape: isUnchanged ? "ring" : "dot", 
                text: `rate: ${rate !== null ? rate.toFixed(2) : "not ready"} ${unitsDisplay[node.runtime.units] || "/min"}`
            });
            
            node.runtime.lastRate = rate;
            
            // Enhanced output with metadata
            const outputMsg = {
                payload: rate,
                samples: node.runtime.samples.length,
                units: `${unitsDisplay[node.runtime.units] || "/min"}`,
                currentValue: inputValue,
                timeSpan: node.runtime.samples.length >= 2 ? 
                    (node.runtime.samples[node.runtime.samples.length - 1].timestamp - node.runtime.samples[0].timestamp) / 1000 : 0
            };
            
            if (node.runtime.samples.length >= node.runtime.maxSamples) {
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
