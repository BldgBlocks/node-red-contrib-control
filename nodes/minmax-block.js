module.exports = function(RED) {
    function MinMaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "minmax";
        node.min = parseFloat(config.min) || 0;
        node.max = parseFloat(config.max) || 100;
        if (isNaN(node.min)) {
            node.min = 0;
            node.status({ fill: "red", shape: "ring", text: "invalid min" });
        }
        if (isNaN(node.max)) {
            node.max = 100;
            node.status({ fill: "red", shape: "ring", text: "invalid max" });
        }
        // Ensure min <= max
        if (node.min > node.max) {
            node.max = node.min;
        }

        // Store last input value to check for changes
        let lastInput = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                const value = parseFloat(msg.payload);
                if (isNaN(value)) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }

                if (msg.context === "min") {
                    node.min = value;
                    if (node.min > node.max) {
                        node.max = node.min;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `min: ${node.min}, max adjusted to ${node.max}`
                        });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `min: ${node.min}`
                        });
                    }
                } else if (msg.context === "max") {
                    node.max = value;
                    if (node.max < node.min) {
                        node.min = node.max;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `max: ${node.max}, min adjusted to ${node.min}`
                        });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `max: ${node.max}`
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

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Validate min and max
            if (isNaN(node.min)) {
                node.status({ fill: "red", shape: "ring", text: "invalid min" });
                if (done) done();
                return;
            }
            if (isNaN(node.max)) {
                node.status({ fill: "red", shape: "ring", text: "invalid max" });
                if (done) done();
                return;
            }

            // Clamp input to [min, max]
            const output = Math.min(Math.max(input, node.min), node.max);

            // Check if input or output has changed
            if (lastInput !== input || output !== Math.min(Math.max(lastInput, node.min), node.max)) {
                lastInput = input;
                msg.payload = output;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${output.toFixed(2)}`
                });
                send(msg);
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${output.toFixed(2)}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset properties to config values on redeployment
            node.min = parseFloat(config.min) || 0;
            node.max = parseFloat(config.max) || 100;
            if (isNaN(node.min)) {
                node.min = 0;
            }
            if (isNaN(node.max)) {
                node.max = 100;
            }
            if (node.min > node.max) {
                node.max = node.min;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("minmax-block", MinMaxBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/minmax-block/:id", RED.auth.needsPermission("minmax-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "minmax-block") {
            res.json({
                name: node.name || "minmax",
                min: !isNaN(node.min) ? node.min : 0,
                max: !isNaN(node.max) ? node.max : 100
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};