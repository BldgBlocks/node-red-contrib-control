module.exports = function(RED) {
    function MaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            max: parseFloat(config.max) || 50
        };

        // Validate max at startup
        if (isNaN(node.runtime.max) || node.runtime.max < 0) {
            node.runtime.max = 50;
            node.status({ fill: "red", shape: "ring", text: "invalid max" });
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
                    node.status({ fill: "red", shape: "ring", text: "missing payload for max" });
                    if (done) done();
                    return;
                }
                if (msg.context === "max" || msg.context === "setpoint") {
                    const maxValue = parseFloat(msg.payload);
                    if (!isNaN(maxValue) && maxValue >= 0) {
                        node.runtime.max = maxValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `max: ${maxValue}`
                        });
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid max" });
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

            // Cap input at max
            const outputValue = Math.min(inputValue, node.runtime.max);

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
            node.runtime.max = parseFloat(config.max) || 50;
            if (isNaN(node.runtime.max) || node.runtime.max < 0) {
                node.runtime.max = 50;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("max-block", MaxBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/max-block-runtime/:id", RED.auth.needsPermission("max-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "max-block") {
            res.json({
                name: node.runtime.name,
                max: node.runtime.max
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};