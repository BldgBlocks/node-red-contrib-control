module.exports = function(RED) {
    function AverageBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "average",
            maxValues: parseInt(config.sampleSize) || 10,
            values: [], // Queue for rolling window
            lastAvg: null
        };

        // Validate initial config
        if (isNaN(node.runtime.maxValues) || node.runtime.maxValues < 1) {
            node.runtime.maxValues = 10;
            node.status({ fill: "red", shape: "ring", text: "invalid window size, using 10" });
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `name: ${node.runtime.name}, window: ${node.runtime.maxValues}`
            });
        }

        // Valid range
        const minValid = 1;
        const maxValid = 150;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
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
                if (msg.context === "reset") {
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
                    if (done) done();
                    return;
                } else if (msg.context === "sampleSize") {
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
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process input
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue) || inputValue < minValid || inputValue > maxValid) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
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
            node.status({
                fill: "blue",
                shape: isUnchanged ? "ring" : "dot",
                text: `out: ${avg !== null ? avg.toFixed(3) : "null"}`
            });
            node.runtime.lastAvg = avg;
            send({ payload: avg });

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            node.runtime.maxValues = parseInt(config.sampleSize) || 10;
            if (isNaN(node.runtime.maxValues) || node.runtime.maxValues < 1) {
                node.runtime.maxValues = 10;
            }
            node.runtime.values = [];
            node.runtime.lastAvg = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("average-block", AverageBlockNode);
};