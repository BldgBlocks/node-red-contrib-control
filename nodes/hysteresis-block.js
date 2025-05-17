module.exports = function(RED) {
    function HysteresisBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            upperLimit: parseFloat(config.upperLimit) || 50,
            lowerLimit: parseFloat(config.lowerLimit) || 30,
            state: "within"
        };

        // Validate initial config
        if (isNaN(node.runtime.upperLimit) || isNaN(node.runtime.lowerLimit) || node.runtime.upperLimit <= node.runtime.lowerLimit || node.runtime.upperLimit < 0 || node.runtime.lowerLimit < 0) {
            node.runtime.upperLimit = 50;
            node.runtime.lowerLimit = 30;
            node.status({ fill: "red", shape: "ring", text: "invalid limits" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
                    if (done) done();
                    return;
                }
                const value = parseFloat(msg.payload);
                if (isNaN(value) || value < 0) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }
                if (msg.context === "upperLimit") {
                    if (value <= node.runtime.lowerLimit) {
                        node.status({ fill: "red", shape: "ring", text: "invalid upperLimit" });
                        if (done) done();
                        return;
                    }
                    node.runtime.upperLimit = value;
                    node.status({ fill: "green", shape: "dot", text: `upperLimit: ${value}` });
                } else if (msg.context === "lowerLimit") {
                    if (value >= node.runtime.upperLimit) {
                        node.status({ fill: "red", shape: "ring", text: "invalid lowerLimit" });
                        if (done) done();
                        return;
                    }
                    node.runtime.lowerLimit = value;
                    node.status({ fill: "green", shape: "dot", text: `lowerLimit: ${value}` });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
                if (done) done();
                return;
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            // Apply hysteresis logic
            let newState = node.runtime.state;
            if (node.runtime.state === "above" && inputValue < node.runtime.lowerLimit) {
                newState = "below";
            } else if (node.runtime.state === "below" && inputValue > node.runtime.upperLimit) {
                newState = "above";
            } else if (node.runtime.state === "within") {
                if (inputValue > node.runtime.upperLimit) {
                    newState = "above";
                } else if (inputValue < node.runtime.lowerLimit) {
                    newState = "below";
                }
            } else if (inputValue >= node.runtime.lowerLimit && inputValue <= node.runtime.upperLimit) {
                newState = "within";
            }

            // Generate output
            const output = [
                { payload: newState === "above" },
                { payload: newState === "within" },
                { payload: newState === "below" }
            ];
            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inputValue.toFixed(2)}, out: ${newState}`
            });
            node.runtime.state = newState;
            send(output);

            if (done) done();
        });

        node.on("close", function(done) {
            node.runtime.upperLimit = parseFloat(config.upperLimit) || 50;
            node.runtime.lowerLimit = parseFloat(config.lowerLimit) || 30;
            if (isNaN(node.runtime.upperLimit) || isNaN(node.runtime.lowerLimit) || node.runtime.upperLimit <= node.runtime.lowerLimit || node.runtime.upperLimit < 0 || node.runtime.lowerLimit < 0) {
                node.runtime.upperLimit = 50;
                node.runtime.lowerLimit = 30;
            }
            node.runtime.state = "within";
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("hysteresis-block", HysteresisBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/hysteresis-block-runtime/:id", RED.auth.needsPermission("hysteresis-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "hysteresis-block") {
            res.json({
                name: node.runtime.name,
                upperLimit: node.runtime.upperLimit,
                lowerLimit: node.runtime.lowerLimit
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};