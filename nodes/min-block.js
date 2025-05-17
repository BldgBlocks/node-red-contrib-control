module.exports = function(RED) {
    function MinBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            min: parseFloat(config.min) || 50
        };

        // Validate min at startup
        if (isNaN(node.runtime.min) || node.runtime.min < 0) {
            node.runtime.min = 50;
            node.status({ fill: "red", shape: "ring", text: "invalid min" });
        }

        // Store last output value for status
        let lastOutput = null;

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
                    node.status({ fill: "red", shape: "ring", text: "missing payload for min" });
                    if (done) done();
                    return;
                }
                if (msg.context === "min" || msg.context === "setpoint") {
                    const minValue = parseFloat(msg.payload);
                    if (!isNaN(minValue) && minValue >= 0) {
                        node.runtime.min = minValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `min: ${minValue}`
                        });
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid min" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
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

            // Cap input at min
            const outputValue = Math.max(inputValue, node.runtime.min);

            // Update status and send output
            msg.payload = outputValue;
            node.status({
                fill: "blue",
                shape: lastOutput === outputValue ? "ring" : "dot",
                text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
            });
            lastOutput = outputValue;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            node.runtime.min = parseFloat(config.min) || 50;
            if (isNaN(node.runtime.min) || node.runtime.min < 0) {
                node.runtime.min = 50;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("min-block", MinBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/min-block-runtime/:id", RED.auth.needsPermission("min-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "min-block") {
            res.json({
                name: node.runtime.name,
                min: node.runtime.min
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};