module.exports = function(RED) {
    function SineWaveBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            lowerLimit: parseFloat(config.lowerLimit),
            upperLimit: parseFloat(config.upperLimit),
            period: (parseFloat(config.period)) * (config.periodUnits === "minutes" ? 60000 : config.periodUnits === "seconds" ? 1000 : 1),
            periodUnits: config.periodUnits,
            lastExecution: Date.now(),
            phase: 0
        };

        // Validate initial config
        if (isNaN(node.runtime.lowerLimit) || isNaN(node.runtime.upperLimit) || !isFinite(node.runtime.lowerLimit) || !isFinite(node.runtime.upperLimit)) {
            node.runtime.lowerLimit = 0;
            node.runtime.upperLimit = 100;
            node.status({ fill: "red", shape: "ring", text: "invalid limits" });
        } else if (node.runtime.lowerLimit > node.runtime.upperLimit) {
            node.runtime.upperLimit = node.runtime.lowerLimit;
            node.status({ fill: "red", shape: "ring", text: "invalid limits" });
        }
        if (isNaN(node.runtime.period) || node.runtime.period <= 0 || !isFinite(node.runtime.period)) {
            node.runtime.period = 10000;
            node.runtime.periodUnits = "milliseconds";
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
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
                if (typeof msg.context !== "string") {
                    node.status({ fill: "red", shape: "ring", text: "invalid context" });
                    if (done) done();
                    return;
                }
                let value = parseFloat(msg.payload);
                if (isNaN(value) || !isFinite(value)) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "lowerLimit":
                        node.runtime.lowerLimit = value;
                        if (node.runtime.lowerLimit > node.runtime.upperLimit) {
                            node.runtime.upperLimit = node.runtime.lowerLimit;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `lower: ${node.runtime.lowerLimit.toFixed(2)}, upper adjusted to ${node.runtime.upperLimit.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "green", shape: "dot", text: `lower: ${node.runtime.lowerLimit.toFixed(2)}` });
                        }
                        break;
                    case "upperLimit":
                        node.runtime.upperLimit = value;
                        if (node.runtime.upperLimit < node.runtime.lowerLimit) {
                            node.runtime.lowerLimit = node.runtime.upperLimit;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `upper: ${node.runtime.upperLimit.toFixed(2)}, lower adjusted to ${node.runtime.lowerLimit.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "green", shape: "dot", text: `upper: ${node.runtime.upperLimit.toFixed(2)}` });
                        }
                        break;
                    case "period":
                        const multiplier = msg.units === "minutes" ? 60000 : msg.units === "seconds" ? 1000 : 1;
                        value *= multiplier;
                        if (value <= 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid period" });
                            if (done) done();
                            return;
                        }
                        node.runtime.period = value;
                        node.runtime.periodUnits = msg.units || "milliseconds";
                        node.status({ fill: "green", shape: "dot", text: `period: ${node.runtime.period.toFixed(2)} ms` });
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done("Unknown context");
                        return;
                }
                if (done) done();
                return;
            }

            // Calculate time difference
            const now = Date.now();
            const deltaTime = (now - node.runtime.lastExecution) / 1000; // Seconds
            node.runtime.lastExecution = now;

            // Return lowerLimit if period is invalid
            if (node.runtime.period <= 0) {
                node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.lowerLimit.toFixed(2)}, phase: ${node.runtime.phase.toFixed(2)}` });
                send({ payload: node.runtime.lowerLimit });
                if (done) done();
                return;
            }

            // Update phase
            node.runtime.phase = (node.runtime.phase + deltaTime / (node.runtime.period / 1000)) % 1;

            // Sine wave calculation
            const sineValue = Math.sin(2 * Math.PI * node.runtime.phase);
            const amplitude = (node.runtime.upperLimit - node.runtime.lowerLimit) / 2;
            const value = node.runtime.lowerLimit + amplitude * (sineValue + 1);

            // Output new message
            node.status({ fill: "blue", shape: "dot", text: `out: ${value.toFixed(2)}, phase: ${node.runtime.phase.toFixed(2)}` });
            send({ payload: value });

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("sine-wave-block", SineWaveBlockNode);
};