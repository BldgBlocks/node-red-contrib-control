module.exports = function(RED) {
    function AverageBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            maxValues: parseInt(config.sampleSize),
            values: [], // Queue for rolling window
            lastAvg: null
        };

        // Validate initial config
        if (isNaN(node.runtime.maxValues) || node.runtime.maxValues < 1) {
            node.runtime.maxValues = 10;
            node.status({ fill: "red", shape: "ring", text: "invalid window size, using 10" });
        } else {
            node.status({ shape: "dot", text: `name: ${config.name}, window: ${config.sampleSize}` });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate all properties
            try {
                node.runtime.minValid = RED.util.evaluateNodeProperty(
                    config.minValid, config.minValidType, node, msg
                );

                node.runtime.maxValid = RED.util.evaluateNodeProperty(
                    config.maxValid, config.maxValidType, node, msg
                );
                
                // Validate values
                if (isNaN(node.runtime.maxValid) || isNaN(node.runtime.minValid) || node.runtime.maxValid <= node.runtime.minValid ) {
                    node.status({ fill: "red", shape: "ring", text: `invalid evaluated values ${node.runtime.minValid}, ${node.runtime.maxValid}` });
                    if (done) done();
                    return;
                }
            } catch(err) {
                node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
                if (done) done(err);
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