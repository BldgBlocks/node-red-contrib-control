module.exports = function(RED) {
    function MinBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "min";
        node.min = parseFloat(config.min) || 50;
        if (isNaN(node.min)) {
            node.min = 50;
            node.status({ fill: "red", shape: "ring", text: "invalid min" });
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
                
                if (msg.context === "min" || msg.context === "setpoint") {
                    const minValue = parseFloat(msg.payload);
                    if (!isNaN(minValue)) {
                        node.min = minValue;
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

            // Cap input at min
            const outputValue = inputValue > node.min ? inputValue : node.min;

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
            // Reset min to config value on redeployment
            node.min = parseFloat(config.min) || 50;
            if (isNaN(node.min)) {
                node.min = 50;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("min-block", MinBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/min-block/:id", RED.auth.needsPermission("min-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "min-block") {
            res.json({
                name: node.name || "min",
                min: !isNaN(node.min) ? node.min : 50
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};