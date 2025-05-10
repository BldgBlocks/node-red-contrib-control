module.exports = function(RED) {
    function MaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "max";
        node.max = parseFloat(config.max) || 50;
        if (isNaN(node.max)) {
            node.max = 50;
            node.status({ fill: "red", shape: "ring", text: "invalid max" });
        }

        // Store last output value to check for changes
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                
                if (msg.context === "max" || msg.context === "setpoint") {
                    const maxValue = parseFloat(msg.payload);
                    if (!isNaN(maxValue)) {
                        node.max = maxValue;
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

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Cap input at max
            const outputValue = inputValue < node.max ? inputValue : node.max;

            // Check if output value has changed
            if (lastOutput !== outputValue) {
                lastOutput = outputValue;
                msg.payload = outputValue;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
                });
                send(msg);
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset max to config value on redeployment
            node.max = parseFloat(config.max) || 50;
            if (isNaN(node.max)) {
                node.max = 50;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("max-block", MaxBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/max-block/:id", RED.auth.needsPermission("max-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "max-block") {
            res.json({
                name: node.name || "max",
                max: !isNaN(node.max) ? node.max : 50
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};