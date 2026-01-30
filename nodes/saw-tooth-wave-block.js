module.exports = function(RED) {
    const utils = require("./utils")(RED);

    function SawToothWaveBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            lowerLimit: parseFloat(config.lowerLimit),
            upperLimit: parseFloat(config.upperLimit),
            period: (parseFloat(config.period) || 10) * (config.periodUnits === "minutes" ? 60000 : config.periodUnits === "seconds" ? 1000 : 1),
            periodUnits: config.periodUnits || "seconds",
            lastExecution: Date.now(),
            phase: 0
        };

        // Validate initial config
        if (isNaN(node.runtime.lowerLimit) || isNaN(node.runtime.upperLimit) || !isFinite(node.runtime.lowerLimit) || !isFinite(node.runtime.upperLimit)) {
            node.runtime.lowerLimit = 0;
            node.runtime.upperLimit = 100;
            utils.setStatusError(node, "invalid limits");
        } else if (node.runtime.lowerLimit > node.runtime.upperLimit) {
            node.runtime.upperLimit = node.runtime.lowerLimit;
            utils.setStatusError(node, "invalid limits");
        }
        if (isNaN(node.runtime.period) || node.runtime.period <= 0 || !isFinite(node.runtime.period)) {
            node.runtime.period = 10000;
            node.runtime.periodUnits = "milliseconds";
            utils.setStatusError(node, "invalid period");
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }
                if (typeof msg.context !== "string") {
                    utils.setStatusError(node, "invalid context");
                    if (done) done();
                    return;
                }
                let value = parseFloat(msg.payload);
                if (isNaN(value) || !isFinite(value)) {
                    utils.setStatusError(node, `invalid ${msg.context}`);
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "lowerLimit":
                        node.runtime.lowerLimit = value;
                        if (node.runtime.lowerLimit > node.runtime.upperLimit) {
                            node.runtime.upperLimit = node.runtime.lowerLimit;
                            utils.setStatusOK(node, `lower: ${node.runtime.lowerLimit.toFixed(2)}, upper adjusted to ${node.runtime.upperLimit.toFixed(2)}`);
                        } else {
                            utils.setStatusOK(node, `lower: ${node.runtime.lowerLimit.toFixed(2)}`);
                        }
                        break;
                    case "upperLimit":
                        node.runtime.upperLimit = value;
                        if (node.runtime.upperLimit < node.runtime.lowerLimit) {
                            node.runtime.lowerLimit = node.runtime.upperLimit;
                            utils.setStatusOK(node, `upper: ${node.runtime.upperLimit.toFixed(2)}, lower adjusted to ${node.runtime.lowerLimit.toFixed(2)}`);
                        } else {
                            utils.setStatusOK(node, `upper: ${node.runtime.upperLimit.toFixed(2)}`);
                        }
                        break;
                    case "period":
                        const multiplier = msg.units === "minutes" ? 60000 : msg.units === "seconds" ? 1000 : 1;
                        value *= multiplier;
                        if (value <= 0) {
                            utils.setStatusError(node, "invalid period");
                            if (done) done();
                            return;
                        }
                        node.runtime.period = value;
                        node.runtime.periodUnits = msg.units || "milliseconds";
                        utils.setStatusOK(node, `period: ${node.runtime.period.toFixed(2)} ms`);
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
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
                utils.setStatusOK(node, `out: ${node.runtime.lowerLimit.toFixed(2)}, phase: ${node.runtime.phase.toFixed(2)}`);
                send({ payload: node.runtime.lowerLimit });
                if (done) done();
                return;
            }

            // Update phase
            node.runtime.phase = (node.runtime.phase + deltaTime / (node.runtime.period / 1000)) % 1;

            // Sawtooth wave calculation
            const amplitude = node.runtime.upperLimit - node.runtime.lowerLimit;
            const value = node.runtime.lowerLimit + amplitude * node.runtime.phase;

            // Output new message
            utils.setStatusOK(node, `out: ${value.toFixed(2)}, phase: ${node.runtime.phase.toFixed(2)}`);
            send({ payload: value });

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("saw-tooth-wave-block", SawToothWaveBlockNode);
};