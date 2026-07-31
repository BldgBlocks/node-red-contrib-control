module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function MinMaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.mode = config.mode === "maximum" ? "maximum" : "minimum";
        node.limit = parseFloat(node.mode === "maximum" ? config.max : config.min);
        node.isBusy = false;

        let lastOutput = null;

        utils.setStatusOK(node, `${node.mode}: ${node.limit}`);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            const limitConfig = node.mode === "maximum" ? config.max : config.min;
            const limitType = node.mode === "maximum" ? config.maxType : config.minType;
            try {
                if (node.isBusy) {
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done();
                    return;
                }
                node.isBusy = true;
                if (utils.requiresEvaluation(limitType)) {
                    const evaluated = await utils.evaluateNodeProperty(limitConfig, limitType, node, msg);
                    const numericLimit = parseFloat(evaluated);
                    if (!isNaN(numericLimit)) node.limit = numericLimit;
                }
            } catch (err) {
                node.error(`Error evaluating ${node.mode}: ${err.message}`);
                if (done) done();
                return;
            } finally {
                node.isBusy = false;
            }

            if (isNaN(node.limit)) {
                utils.setStatusError(node, `invalid ${node.mode}`);
                if (done) done();
                return;
            }

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${node.mode}`);
                    if (done) done();
                    return;
                }
                const limitContext = node.mode === "minimum" ? "min" : "max";
                if (msg.context !== limitContext && msg.context !== node.mode && msg.context !== "setpoint") {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                const limit = utils.validateNumericPayload(msg.payload);
                if (!limit.valid) {
                    utils.setStatusError(node, `invalid ${node.mode}`);
                } else {
                    node.limit = limit.value;
                    utils.setStatusOK(node, `${node.mode}: ${node.limit}`);
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

            const output = node.mode === "maximum" ? Math.min(input.value, node.limit) : Math.max(input.value, node.limit);
            const statusText = `in: ${input.value.toFixed(2)}, ${node.mode}: ${node.limit.toFixed(2)}, out: ${output.toFixed(2)}`;
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