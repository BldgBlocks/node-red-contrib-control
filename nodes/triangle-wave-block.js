module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function TriangleWaveBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name || "";
        node.lowerLimit = parseFloat(config.lowerLimit);
        node.upperLimit = parseFloat(config.upperLimit);
        node.period = (parseFloat(config.period)) * (config.periodUnits === "minutes" ? 60000 : config.periodUnits === "seconds" ? 1000 : 1);
        node.periodUnits = config.periodUnits;
        node.lastExecution = Date.now();
        node.phase = 0;

        // Validate initial config
        if (isNaN(node.lowerLimit) || isNaN(node.upperLimit) || !isFinite(node.lowerLimit) || !isFinite(node.upperLimit)) {
            node.lowerLimit = 0;
            node.upperLimit = 100;
            utils.setStatusError(node, "invalid limits");
        } else if (node.lowerLimit > node.upperLimit) {
            node.upperLimit = node.lowerLimit;
            utils.setStatusError(node, "invalid limits");
        }
        if (isNaN(node.period) || node.period <= 0 || !isFinite(node.period)) {
            node.period = 10000;
            node.periodUnits = "milliseconds";
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
                        node.lowerLimit = value;
                        if (node.lowerLimit > node.upperLimit) {
                            node.upperLimit = node.lowerLimit;
                            utils.setStatusOK(node, `lower: ${node.lowerLimit.toFixed(2)}, upper adjusted to ${node.upperLimit.toFixed(2)}`);
                        } else {
                            utils.setStatusOK(node, `lower: ${node.lowerLimit.toFixed(2)}`);
                        }
                        break;
                    case "upperLimit":
                        node.upperLimit = value;
                        if (node.upperLimit < node.lowerLimit) {
                            node.lowerLimit = node.upperLimit;
                            utils.setStatusOK(node, `upper: ${node.upperLimit.toFixed(2)}, lower adjusted to ${node.lowerLimit.toFixed(2)}`);
                        } else {
                            utils.setStatusOK(node, `upper: ${node.upperLimit.toFixed(2)}`);
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
                        node.period = value;
                        node.periodUnits = msg.units || "milliseconds";
                        utils.setStatusOK(node, `period: ${node.period.toFixed(2)} ms`);
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
            const deltaTime = (now - node.lastExecution) / 1000; // Seconds
            node.lastExecution = now;

            // Return lowerLimit if period is invalid
            if (node.period <= 0) {
                utils.setStatusOK(node, `out: ${node.lowerLimit.toFixed(2)}, phase: ${node.phase.toFixed(2)}`);
                send({ payload: node.lowerLimit });
                if (done) done();
                return;
            }

            // Update phase
            node.phase = (node.phase + deltaTime / (node.period / 1000)) % 1;

            // Triangle wave calculation
            const triangleValue = node.phase < 0.5 ? 2 * node.phase : 2 * (1 - node.phase);
            const amplitude = (node.upperLimit - node.lowerLimit) / 2;
            const value = node.lowerLimit + amplitude * triangleValue;

            // Output new message
            utils.setStatusOK(node, `out: ${value.toFixed(2)}, phase: ${node.phase.toFixed(2)}`);
            send({ payload: value });

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("triangle-wave-block", TriangleWaveBlockNode);
};