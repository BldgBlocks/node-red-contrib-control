module.exports = function(RED) {
    function TimeSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            delay: parseFloat(config.delay) || 5000,
            stage: 0
        };

        // Validate initial config
        if (isNaN(node.runtime.delay) || node.runtime.delay < 0 || !isFinite(node.runtime.delay)) {
            node.runtime.delay = 5000;
            node.status({ fill: "red", shape: "ring", text: "invalid delay" });
        }

        let timer = null;

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
                switch (msg.context) {
                    case "delay":
                        const delayValue = parseFloat(msg.payload);
                        if (isNaN(delayValue) || delayValue < 0 || !isFinite(delayValue)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid delay" });
                            if (done) done();
                            return;
                        }
                        node.runtime.delay = delayValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `delay: ${node.runtime.delay.toFixed(2)} ms`
                        });
                        break;
                    case "reset":
                        if (typeof msg.payload !== "boolean" || !msg.payload) {
                            node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                            if (done) done();
                            return;
                        }
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                        node.runtime.stage = 0;
                        const resetMsg = { payload: false };
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "state reset"
                        });
                        send([resetMsg, resetMsg, resetMsg, resetMsg]);
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done("Unknown context");
                        return;
                }
                if (done) done();
                return;
            }

            // Validate input
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            // Process input
            if (node.runtime.stage !== 0) {
                node.status({ fill: "yellow", shape: "ring", text: "sequence running" });
                if (done) done();
                return;
            }

            // Start new sequence
            node.runtime.stage = 1;
            const cloneMsg = RED.util.cloneMessage(msg);

            // Output sequence
            const sendNextOutput = () => {
                if (node.runtime.stage === 0) return;
                const stageLabels = ["stage 1", "stage 2", "stage 3", "reset"];
                const outputs = [null, null, null, null];
                cloneMsg.stage = node.runtime.stage;
                outputs[node.runtime.stage - 1] = cloneMsg;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `stage: ${stageLabels[node.runtime.stage - 1]}, in: ${JSON.stringify(cloneMsg.payload).slice(0, 20)}`
                });
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
            node.runtime = {
                name: config.name || "",
                delay: parseFloat(config.delay) || 5000,
                stage: 0
            };
            if (isNaN(node.runtime.delay) || node.runtime.delay < 0 || !isFinite(node.runtime.delay)) {
                node.runtime.delay = 5000;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("time-sequence-block", TimeSequenceBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/time-sequence-block-runtime/:id", RED.auth.needsPermission("time-sequence-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "time-sequence-block") {
            res.json({
                name: node.runtime.name,
                delay: node.runtime.delay
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};