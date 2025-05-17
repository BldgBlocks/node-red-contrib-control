module.exports = function(RED) {
    function MinMaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            min: parseFloat(config.min) || 0,
            max: parseFloat(config.max) || 100
        };

        // Validate min and max at startup
        if (isNaN(node.runtime.min) || node.runtime.min < 0) {
            node.runtime.min = 0;
            node.status({ fill: "red", shape: "ring", text: "invalid min" });
        }
        if (isNaN(node.runtime.max) || node.runtime.max < 0) {
            node.runtime.max = 100;
            node.status({ fill: "red", shape: "ring", text: "invalid max" });
        }
        if (node.runtime.min > node.runtime.max) {
            node.runtime.max = node.runtime.min;
            node.status({ fill: "green", shape: "dot", text: `min: ${node.runtime.min}, max adjusted to ${node.runtime.max}` });
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
                if (msg.context === "min") {
                    node.runtime.min = value;
                    if (node.runtime.min > node.runtime.max) {
                        node.runtime.max = node.runtime.min;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `min: ${node.runtime.min}, max adjusted to ${node.runtime.max}`
                        });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `min: ${node.runtime.min}`
                        });
                    }
                } else if (msg.context === "max") {
                    node.runtime.max = value;
                    if (node.runtime.max < node.runtime.min) {
                        node.runtime.min = node.runtime.max;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `max: ${node.runtime.max}, min adjusted to ${node.runtime.min}`
                        });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `max: ${node.runtime.max}`
                        });
                    }
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
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

            // Clamp input to [min, max]
            const outputValue = Math.min(Math.max(inputValue, node.runtime.min), node.runtime.max);

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
            node.runtime.min = parseFloat(config.min) || 0;
            node.runtime.max = parseFloat(config.max) || 100;
            if (isNaN(node.runtime.min) || node.runtime.min < 0) {
                node.runtime.min = 0;
            }
            if (isNaN(node.runtime.max) || node.runtime.max < 0) {
                node.runtime.max = 100;
            }
            if (node.runtime.min > node.runtime.max) {
                node.runtime.max = node.runtime.min;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("minmax-block", MinMaxBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/minmax-block-runtime/:id", RED.auth.needsPermission("minmax-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "minmax-block") {
            res.json({
                name: node.runtime.name,
                min: node.runtime.min,
                max: node.runtime.max
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};