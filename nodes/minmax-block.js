module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function MinMaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.mode = ["min", "max", "minmax"].includes(config.mode) ? config.mode : "minmax";
        node.min = parseFloat(config.min);
        node.max = parseFloat(config.max);
        node.isBusy = false;

        let lastOutput = null;

        utils.setStatusOK(node, `${node.mode}: ${node.min} to ${node.max}`);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            try {
                if (node.isBusy) {
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done();
                    return;
                }
                node.isBusy = true;
                if (node.mode !== "max" && utils.requiresEvaluation(config.minType)) {
                    const evaluatedMin = await utils.evaluateNodeProperty(config.min, config.minType, node, msg);
                    const numericMin = parseFloat(evaluatedMin);
                    if (!isNaN(numericMin)) node.min = numericMin;
                }
                if (node.mode !== "min" && utils.requiresEvaluation(config.maxType)) {
                    const evaluatedMax = await utils.evaluateNodeProperty(config.max, config.maxType, node, msg);
                    const numericMax = parseFloat(evaluatedMax);
                    if (!isNaN(numericMax)) node.max = numericMax;
                }
            } catch (err) {
                node.error(`Error evaluating limits: ${err.message}`);
                if (done) done();
                return;
            } finally {
                node.isBusy = false;
            }

            if ((node.mode !== "max" && isNaN(node.min)) ||
                (node.mode !== "min" && isNaN(node.max)) ||
                (node.mode === "minmax" && node.min > node.max)) {
                utils.setStatusError(node, "invalid min/max");
                if (done) done();
                return;
            }

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload for min/max");
                    if (done) done();
                    return;
                }
                const isMinContext = msg.context === "min" || msg.context === "minimum";
                const isMaxContext = msg.context === "max" || msg.context === "maximum";
                if ((!isMinContext && !isMaxContext && msg.context !== "setpoint") ||
                    (isMinContext && node.mode === "max") ||
                    (isMaxContext && node.mode === "min")) {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                const limit = utils.validateNumericPayload(msg.payload);
                if (!limit.valid) {
                    utils.setStatusError(node, "invalid min/max");
                } else if (isMinContext || (msg.context === "setpoint" && node.mode === "min")) {
                    if (node.mode === "minmax" && limit.value > node.max) {
                        utils.setStatusError(node, "minimum exceeds maximum");
                    } else {
                        node.min = limit.value;
                        utils.setStatusOK(node, `min: ${node.min}`);
                    }
                } else if (isMaxContext || (msg.context === "setpoint" && node.mode === "max")) {
                    if (node.mode === "minmax" && limit.value < node.min) {
                        utils.setStatusError(node, "maximum below minimum");
                    } else {
                        node.max = limit.value;
                        utils.setStatusOK(node, `max: ${node.max}`);
                    }
                } else {
                    utils.setStatusWarn(node, "setpoint requires min or max mode");
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            const input = utils.validateNumericPayload(msg.payload);
            if (!input.valid) {
                utils.setStatusError(node, input.error);
                if (done) done();
                return;
            }

            let output = input.value;
            if (node.mode !== "max") output = Math.max(output, node.min);
            if (node.mode !== "min") output = Math.min(output, node.max);
            const statusText = `in: ${input.value.toFixed(2)}, min: ${node.min.toFixed(2)}, max: ${node.max.toFixed(2)}, out: ${output.toFixed(2)}`;
            if (lastOutput === output) {
                utils.setStatusUnchanged(node, statusText);
            } else {
                utils.setStatusChanged(node, statusText);
            }
            lastOutput = output;
            msg.payload = output;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("minmax-block", MinMaxBlockNode);
};