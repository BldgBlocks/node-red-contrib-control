module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function TimeSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            delay: parseFloat(config.delay),
            stage: 0
        };

        // Validate initial config
        if (isNaN(node.runtime.delay) || node.runtime.delay < 0 || !isFinite(node.runtime.delay)) {
            node.runtime.delay = 5000;
            utils.setStatusError(node, "invalid delay");
        }

        let timer = null;

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
                if (typeof msg.context !== "string") {
                    utils.setStatusError(node, "invalid context");
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "delay":
                        if (!msg.hasOwnProperty("payload")) {
                            utils.setStatusError(node, `missing payload for ${msg.context}`);
                            if (done) done();
                            return;
                        }
                        const delayValue = parseFloat(msg.payload);
                        if (isNaN(delayValue) || delayValue < 0 || !isFinite(delayValue)) {
                            utils.setStatusError(node, "invalid delay");
                            if (done) done();
                            return;
                        }
                        node.runtime.delay = delayValue;
                        utils.setStatusOK(node, `delay: ${node.runtime.delay.toFixed(2)} ms`);
                        if (done) done();
                        return;
                    case "reset":
                        if (!msg.hasOwnProperty("payload")) {
                            utils.setStatusError(node, `missing payload for ${msg.context}`);
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload !== "boolean" || !msg.payload) {
                            utils.setStatusError(node, "invalid reset");
                            if (done) done();
                            return;
                        }
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                        node.runtime.stage = 0;
                        const resetMsg = { payload: false };
                        utils.setStatusOK(node, "state reset");
                        send([resetMsg, resetMsg, resetMsg, resetMsg]);
                        if (done) done();
                        return;
                    default:
                        break;
                }
            }

            // Validate input
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing input");
                if (done) done();
                return;
            }

            // Process input
            if (node.runtime.stage !== 0) {
                utils.setStatusWarn(node, "sequence already running");
                if (done) done();
                return;
            }

            // Start new sequence
            node.runtime.stage = 1;
            const cloneMsg = RED.util.cloneMessage(msg);

            // Output sequence
            const sendNextOutput = () => {
                if (node.runtime.stage === 0) return;
                const stageLabels = ["stage 1", "stage 2", "stage 3", "stage 4"];
                const outputs = [null, null, null, null];
                cloneMsg.stage = node.runtime.stage;
                outputs[node.runtime.stage - 1] = cloneMsg;
                utils.setStatusOK(node, `stage: ${stageLabels[node.runtime.stage - 1]}, in: ${JSON.stringify(cloneMsg.payload).slice(0, 20)}`);
                send(outputs);

                node.runtime.stage++;
                if (node.runtime.stage <= 4) {
                    timer = setTimeout(sendNextOutput, node.runtime.delay);
                } else {
                    node.runtime.stage = 0;
                    timer = null;
                }
            };

            // Start sequence
            sendNextOutput();

            if (done) done();
        });

        node.on("close", function(done) {
            if (timer) clearTimeout(timer);
            timer = null;
            done();
        });
    }

    RED.nodes.registerType("time-sequence-block", TimeSequenceBlockNode);
};