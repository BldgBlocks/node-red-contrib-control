module.exports = function(RED) {
    function ScaleRangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "scale range";
        node.inMin = parseFloat(config.inMin) || 0.0;
        node.inMax = parseFloat(config.inMax) || 100.0;
        node.outMin = parseFloat(config.outMin) || 0.0;
        node.outMax = parseFloat(config.outMax) || 80.0;
        node.clamp = config.clamp !== false;

        // Validate initial config
        if (isNaN(node.inMin) || isNaN(node.inMax) || node.inMin >= node.inMax) {
            node.inMin = 0.0;
            node.inMax = 100.0;
            node.status({ fill: "red", shape: "ring", text: "invalid input range" });
        }
        if (isNaN(node.outMin) || isNaN(node.outMax) || node.outMin >= node.outMax) {
            node.outMin = 0.0;
            node.outMax = 80.0;
            node.status({ fill: "red", shape: "ring", text: "invalid output range" });
        }

        // Initialize state
        let lastInput = node.inMin;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                let shouldOutput = false;
                switch (msg.context) {
                    case "inMin":
                    case "inMax":
                    case "outMin":
                    case "outMax":
                        const value = parseFloat(msg.payload);
                        if (isNaN(value)) {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        if (msg.context === "inMin") node.inMin = value;
                        else if (msg.context === "inMax") node.inMax = value;
                        else if (msg.context === "outMin") node.outMin = value;
                        else node.outMax = value;
                        if (node.inMax <= node.inMin) {
                            node.status({ fill: "red", shape: "ring", text: "invalid input range" });
                            if (done) done();
                            return;
                        }
                        if (node.outMax <= node.outMin) {
                            node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                            if (done) done();
                            return;
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${value.toFixed(2)}`
                        });
                        shouldOutput = true;
                        break;
                    case "clamp":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid clamp" });
                            if (done) done();
                            return;
                        }
                        node.clamp = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `clamp: ${node.clamp}`
                        });
                        shouldOutput = true;
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }

                // Recalculate with last input after config update
                if (shouldOutput) {
                    const out = calculate(lastInput, node.inMin, node.inMax, node.outMin, node.outMax, node.clamp);
                    msg.payload = out;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `out: ${out.toFixed(2)}, in: ${lastInput.toFixed(2)}`
                    });
                    send(msg);
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }
            if (node.inMax <= node.inMin) {
                node.status({ fill: "red", shape: "ring", text: "invalid input range" });
                if (done) done();
                return;
            }
            if (node.outMax <= node.outMin) {
                node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                if (done) done();
                return;
            }
            lastInput = inputValue;
            const out = calculate(inputValue, node.inMin, node.inMax, node.outMin, node.outMax, node.clamp);
            msg.payload = out;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `out: ${out.toFixed(2)}, in: ${inputValue.toFixed(2)}`
            });
            send(msg);

            if (done) done();
        });

        // Scaling function
        function calculate(input, inMin, inMax, outMin, outMax, clamp) {
            const scaleRatio = (outMax - outMin) / (inMax - inMin);
            let output = scaleRatio * (input - inMin) + outMin;
            return clamp ? Math.max(outMin, Math.min(outMax, output)) : output;
        }

        node.on("close", function(done) {
            // Reset properties on redeployment
            node.inMin = parseFloat(config.inMin) || 0.0;
            node.inMax = parseFloat(config.inMax) || 100.0;
            node.outMin = parseFloat(config.outMin) || 0.0;
            node.outMax = parseFloat(config.outMax) || 80.0;
            node.clamp = config.clamp !== false;

            if (isNaN(node.inMin) || isNaN(node.inMax) || node.inMin >= node.inMax) {
                node.inMin = 0.0;
                node.inMax = 100.0;
            }
            if (isNaN(node.outMin) || isNaN(node.outMax) || node.outMin >= node.outMax) {
                node.outMin = 0.0;
                node.outMax = 80.0;
            }

            lastInput = node.inMin;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("scale-range-block", ScaleRangeBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/scale-range-block/:id", RED.auth.needsPermission("scale-range-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "scale-range-block") {
            res.json({
                name: node.name || "scale range",
                inMin: !isNaN(node.inMin) ? node.inMin : 0.0,
                inMax: !isNaN(node.inMax) ? node.inMax : 100.0,
                outMin: !isNaN(node.outMin) ? node.outMin : 0.0,
                outMax: !isNaN(node.outMax) ? node.outMax : 80.0,
                clamp: node.clamp !== false,
                lastInput: !isNaN(node.lastInput) ? node.lastInput : node.inMin || 0.0
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};