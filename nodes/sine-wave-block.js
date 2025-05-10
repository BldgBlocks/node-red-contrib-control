module.exports = function(RED) {
    function SineWaveBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "sine wave";
        node.lowerLimit = parseFloat(config.lowerLimit) || 0;
        node.upperLimit = parseFloat(config.upperLimit) || 100;
        const periodMultiplier = config.periodUnits === "minutes" ? 60000 : config.periodUnits === "seconds" ? 1000 : 1;
        node.period = (parseFloat(config.period) || 10) * periodMultiplier;
        
        // Validate initial config
        if (isNaN(node.lowerLimit) || isNaN(node.upperLimit) || node.lowerLimit > node.upperLimit) {
            node.lowerLimit = 0;
            node.upperLimit = 100;
            node.status({ fill: "red", shape: "ring", text: "invalid limits" });
        }
        if (isNaN(node.period) || node.period <= 0) {
            node.period = 10000;
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
        }

        // Initialize state
        let lastExecution = Date.now();
        let phase = 0;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                let value = parseFloat(msg.payload);
                if (isNaN(value)) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }
                if (msg.context === "lowerLimit") {
                    node.lowerLimit = value;
                    if (node.lowerLimit > node.upperLimit) {
                        node.upperLimit = node.lowerLimit;
                        node.status({ fill: "green", shape: "dot", text: `lower: ${node.lowerLimit.toFixed(2)}, upper adjusted to ${node.upperLimit.toFixed(2)}` });
                    } else {
                        node.status({ fill: "green", shape: "dot", text: `lower: ${node.lowerLimit.toFixed(2)}` });
                    }
                } else if (msg.context === "upperLimit") {
                    node.upperLimit = value;
                    if (node.upperLimit < node.lowerLimit) {
                        node.lowerLimit = node.upperLimit;
                        node.status({ fill: "green", shape: "dot", text: `upper: ${node.upperLimit.toFixed(2)}, lower adjusted to ${node.lowerLimit.toFixed(2)}` });
                    } else {
                        node.status({ fill: "green", shape: "dot", text: `upper: ${node.upperLimit.toFixed(2)}` });
                    }
                } else if (msg.context === "period") {
                    const multiplier = msg.units === "minutes" ? 60000 : msg.units === "seconds" ? 1000 : 1;
                    value *= multiplier;
                    if (value <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid period" });
                        if (done) done();
                        return;
                    }
                    node.period = value;
                    node.status({ fill: "green", shape: "dot", text: `period: ${node.period.toFixed(2)}` });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
                if (done) done();
                return;
            }

            // Calculate time difference
            const now = Date.now();
            const deltaTime = (now - lastExecution) / 1000; // Seconds
            lastExecution = now;

            // Return lowerLimit if period is invalid
            if (node.period <= 0) {
                node.status({ fill: "blue", shape: "dot", text: `out: ${node.lowerLimit.toFixed(2)}, phase: ${phase.toFixed(2)}` });
                send({ payload: node.lowerLimit });
                if (done) done();
                return;
            }

            // Update phase
            phase = (phase + deltaTime / (node.period / 1000)) % 1;

            // Sine wave calculation
            const sineValue = Math.sin(2 * Math.PI * phase);
            const amplitude = (node.upperLimit - node.lowerLimit) / 2;
            const value = node.lowerLimit + amplitude * (sineValue + 1);

            // Output new message
            node.status({ fill: "blue", shape: "dot", text: `out: ${value.toFixed(2)}, phase: ${phase.toFixed(2)}` });
            send({ payload: value });

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            lastExecution = Date.now();
            phase = 0;
            node.lowerLimit = parseFloat(config.lowerLimit) || 0;
            node.upperLimit = parseFloat(config.upperLimit) || 100;
            node.period = (parseFloat(config.period) || 10) * (config.periodUnits === "minutes" ? 60000 : config.periodUnits === "seconds" ? 1000 : 1);
            if (node.lowerLimit > node.upperLimit) {
                node.upperLimit = node.lowerLimit;
            }
            if (node.period <= 0) {
                node.period = 10000;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("sine-wave-block", SineWaveBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/sine-wave-block/:id", RED.auth.needsPermission("sine-wave-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "sine-wave-block") {
            let period = node.period || 10000;
            let periodUnits = "milliseconds";
            if (period >= 60000 && period % 60000 === 0) {
                period = period / 60000;
                periodUnits = "minutes";
            } else if (period >= 1000 && period % 1000 === 0) {
                period = period / 1000;
                periodUnits = "seconds";
            }
            res.json({
                name: node.name || "sine wave",
                lowerLimit: node.lowerLimit || 0,
                upperLimit: node.upperLimit || 100,
                period: period,
                periodUnits: periodUnits
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};