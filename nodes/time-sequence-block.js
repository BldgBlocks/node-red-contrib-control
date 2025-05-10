module.exports = function(RED) {
    function TimeSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "time sequence";
        node.delay = parseFloat(config.delay) || 5000;

        // Validate initial config
        if (isNaN(node.delay) || node.delay < 0) {
            node.delay = 5000;
            node.status({ fill: "red", shape: "ring", text: "invalid delay" });
        }

        // Initialize state
        let stage = 0;
        let timer = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                switch (msg.context) {
                    case "delay":
                        if (!msg.hasOwnProperty("payload")) {
                            node.status({ fill: "red", shape: "ring", text: "missing payload" });
                            if (done) done();
                            return;
                        }
                        const delayValue = parseFloat(msg.payload);
                        if (isNaN(delayValue) || delayValue < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid delay" });
                            if (done) done();
                            return;
                        }
                        node.delay = delayValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `delay: ${node.delay.toFixed(0)} ms`
                        });
                        if (done) done();
                        return;
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
                        stage = 0;
                        const resetMsg = { payload: false };
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "state reset"
                        });
                        send([resetMsg, resetMsg, resetMsg, resetMsg]);
                        if (done) done();
                        return;
                    default:
                        node.status({ fill: "red", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process input
            if (stage !== 0) {
                node.status({ fill: "yellow", shape: "ring", text: "sequence running" });
                if (done) done();
                return;
            }

            // Start new sequence
            stage = 1;

            // Clone msg for output
            const cloneMsg = RED.util.cloneMessage(msg);

            // Output sequence
            const sendNextOutput = () => {
                if (stage === 0) return; // Stop if reset
                const stageLabels = ["stage 1", "stage 2", "stage 3", "reset"];
                const outputs = [null, null, null, null];
                cloneMsg.stage = stage;
                outputs[stage - 1] = cloneMsg;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `stage: ${stageLabels[stage - 1]}, in: ${JSON.stringify(cloneMsg.payload).slice(0, 20)}`
                });
                send(outputs);

                stage++;
                if (stage <= 4) {
                    timer = setTimeout(sendNextOutput, node.delay);
                } else {
                    stage = 0;
                    timer = null;
                }
            };

            // Start sequence
            sendNextOutput();

            if (done) done();
        });

        node.on("close", function(done) {
            // Clear timer
            if (timer) clearTimeout(timer);

            // Reset state and properties on redeployment
            stage = 0;
            timer = null;
            node.delay = parseFloat(config.delay) || 5000;

            if (isNaN(node.delay) || node.delay < 0) {
                node.delay = 5000;
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("time-sequence-block", TimeSequenceBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/time-sequence-block/:id", RED.auth.needsPermission("time-sequence-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "time-sequence-block") {
            res.json({
                name: node.name || "time sequence",
                delay: !isNaN(node.delay) && node.delay >= 0 ? node.delay : 5000
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};