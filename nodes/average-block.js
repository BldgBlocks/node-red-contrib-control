module.exports = function(RED) {
    function AverageBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "average";
        node.maxValues = parseInt(config.sampleSize) || 10;
        
        // Validate initial config
        if (isNaN(node.maxValues) || node.maxValues < 1) {
            node.status({ fill: "red", shape: "ring", text: "invalid window size" });
            node.maxValues = 10;
        }

        // Initialize state
        let sum = 0;
        let count = 0;

        // Valid range
        const minValid = 1;
        const maxValid = 150;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

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
                        sum = 0;
                        count = 0;
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
                    node.maxValues = newMaxValues;
                    node.status({ fill: "green", shape: "dot", text: `window: ${newMaxValues}` });
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "red", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue) || inputValue < minValid || inputValue > maxValid) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Update sum and count
            sum += inputValue;
            count++;

            // Adjust for rolling window
            if (count > node.maxValues) {
                let avg = sum / count;
                sum -= avg;
                count--;
            }

            // Calculate average
            const avg = count ? sum / count : null;

            // Send new message
            node.status({
                fill: "blue",
                shape: "dot",
                text: `window: ${node.maxValues}, out: ${avg !== null ? avg : "null"}`
            });
            send({ payload: avg });

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            sum = 0;
            count = 0;
            node.maxValues = parseInt(config.sampleSize) || 10;
            if (isNaN(node.maxValues) || node.maxValues < 1) {
                node.maxValues = 10;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("average-block", AverageBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/average-block/:id", RED.auth.needsPermission("average-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "average-block") {
            res.json({
                name: node.name || "average",
                sampleSize: node.maxValues || 10
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};