module.exports = function(RED) {
    function LoadSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "load sequence";
        node.enable = config.enable !== false;
        node.hysteresis = parseFloat(config.hysteresis) || 0.5;
        node.threshold1 = parseFloat(config.threshold1) || 10.0;
        node.threshold2 = parseFloat(config.threshold2) || 20.0;
        node.threshold3 = parseFloat(config.threshold3) || 30.0;
        node.threshold4 = parseFloat(config.threshold4) || 40.0;
        node.feedback1 = config.feedback1 !== false;
        node.feedback2 = config.feedback2 !== false;
        node.feedback3 = config.feedback3 !== false;
        node.feedback4 = config.feedback4 !== false;

        // Validate initial config
        if (isNaN(node.hysteresis) || node.hysteresis < 0) {
            node.hysteresis = 0.5;
            node.status({ fill: "red", shape: "ring", text: "invalid hysteresis" });
        }
        if (isNaN(node.threshold1) || isNaN(node.threshold2) || isNaN(node.threshold3) || isNaN(node.threshold4) ||
            node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
            node.threshold1 = 10.0;
            node.threshold2 = 20.0;
            node.threshold3 = 30.0;
            node.threshold4 = 40.0;
            node.status({ fill: "red", shape: "ring", text: "invalid threshold order" });
        }

        // Initialize state
        let out1 = false;
        let out2 = false;
        let out3 = false;
        let out4 = false;
        let dOn = 0;
        let lastInput = 0;
        let lastOutputs = [false, false, false, false];

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!msg.hasOwnProperty("context") && !msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing context or payload" });
                if (done) done();
                return;
            }

            let inputValue;

            // Handle configuration updates
            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "enable":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid enable" });
                            if (done) done();
                            return;
                        }
                        node.enable = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `enable: ${node.enable}`
                        });
                        break;
                    case "hysteresis":
                        const hystValue = parseFloat(msg.payload);
                        if (isNaN(hystValue) || hystValue < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid hysteresis" });
                            if (done) done();
                            return;
                        }
                        node.hysteresis = hystValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `hysteresis: ${node.hysteresis}`
                        });
                        break;
                    case "threshold1":
                    case "threshold2":
                    case "threshold3":
                    case "threshold4":
                        const threshValue = parseFloat(msg.payload);
                        if (isNaN(threshValue)) {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        const prevThresholds = [node.threshold1, node.threshold2, node.threshold3, node.threshold4];
                        if (msg.context === "threshold1") node.threshold1 = threshValue;
                        else if (msg.context === "threshold2") node.threshold2 = threshValue;
                        else if (msg.context === "threshold3") node.threshold3 = threshValue;
                        else node.threshold4 = threshValue;
                        if (node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
                            node.threshold1 = prevThresholds[0];
                            node.threshold2 = prevThresholds[1];
                            node.threshold3 = prevThresholds[2];
                            node.threshold4 = prevThresholds[3];
                            node.status({ fill: "red", shape: "ring", text: "invalid threshold order" });
                            if (done) done();
                            return;
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${threshValue}`
                        });
                        break;
                    case "feedback1":
                    case "feedback2":
                    case "feedback3":
                    case "feedback4":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        if (msg.context === "feedback1") node.feedback1 = msg.payload;
                        else if (msg.context === "feedback2") node.feedback2 = msg.payload;
                        else if (msg.context === "feedback3") node.feedback3 = msg.payload;
                        else node.feedback4 = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${msg.payload}`
                        });
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }
                inputValue = lastInput;
            } else {
                // Handle non-config inputs
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                if (msg.payload === "kill") {
                    inputValue = lastInput;
                } else {
                    inputValue = parseFloat(msg.payload);
                    if (isNaN(inputValue)) {
                        node.status({ fill: "red", shape: "ring", text: "invalid input" });
                        if (done) done();
                        return;
                    }
                    lastInput = inputValue;
                }
            }

            // Kill switch
            if (msg.payload === "kill") {
                out1 = out2 = out3 = out4 = false;
                dOn = 0;
                node.status({ fill: "red", shape: "dot", text: "kill: all off" });
                send([{ payload: false }, { payload: false }, { payload: false }, { payload: false }]);
                lastOutputs = [false, false, false, false];
                if (done) done();
                return;
            }

            // Validate thresholds
            if (node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
                node.status({ fill: "red", shape: "ring", text: "invalid threshold order" });
                if (done) done();
                return;
            }

            // Process logic (source conditions with reversed prioritization)
            let newMsg = [null, null, null, null];
            let numStagesOn = 0;

            if (!node.enable) {
                if (out4) {
                    out4 = false;
                    newMsg[3] = { payload: false };
                } else if (out3) {
                    out3 = false;
                    newMsg[2] = { payload: false };
                } else if (out2) {
                    out2 = false;
                    newMsg[1] = { payload: false };
                } else if (out1) {
                    out1 = false;
                    newMsg[0] = { payload: false };
                }
                numStagesOn = 0;
            } else {
                let newOut1 = out1;
                let newOut2 = out2;
                let newOut3 = out3;
                let newOut4 = out4;

                // Output 1
                if (out1) {
                    if (inputValue < (node.threshold1 - node.hysteresis) && (node.feedback1 && !out2)) {
                        newOut1 = false;
                    }
                } else if (inputValue >= node.threshold1) {
                    newOut1 = true;
                }

                // Output 2
                if (out2) {
                    if (inputValue < (node.threshold2 - node.hysteresis) && (node.feedback2 && !out3)) {
                        newOut2 = false;
                    }
                } else if (inputValue >= node.threshold2 && node.feedback1) {
                    newOut2 = true;
                }

                // Output 3
                if (out3) {
                    if (inputValue < (node.threshold3 - node.hysteresis) && (node.feedback3 && !out4)) {
                        newOut3 = false;
                    }
                } else if (inputValue >= node.threshold3 && node.feedback2) {
                    newOut3 = true;
                }

                // Output 4
                if (out4) {
                    if (inputValue < (node.threshold4 - node.hysteresis) && node.feedback4) {
                        newOut4 = false;
                    }
                } else if (inputValue >= node.threshold4 && node.feedback3) {
                    newOut4 = true;
                }

                // Prioritize lowest stage change
                if (newOut1 !== out1) {
                    out1 = newOut1;
                    newMsg = [{ payload: out1 }, null, null, null];
                } else if (newOut2 !== out2) {
                    out2 = newOut2;
                    newMsg = [null, { payload: out2 }, null, null];
                } else if (newOut3 !== out3) {
                    out3 = newOut3;
                    newMsg = [null, null, { payload: out3 }, null];
                } else if (newOut4 !== out4) {
                    out4 = newOut4;
                    newMsg = [null, null, null, { payload: out4 }];
                }

                numStagesOn = (out1 ? 1 : 0) + (out2 ? 1 : 0) + (out3 ? 1 : 0) + (out4 ? 1 : 0);
            }

            // Update state
            dOn = numStagesOn;

            // Check if outputs changed
            const outputsChanged = newMsg.some((msg, i) => msg !== null && msg.payload !== lastOutputs[i]);
            const currentOutputs = [out1, out2, out3, out4];

            if (outputsChanged) {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: [${out1}, ${out2}, ${out3}, ${out4}], in: ${inputValue.toFixed(2)}`
                });
                send(newMsg);
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `out: [${out1}, ${out2}, ${out3}, ${out4}], in: ${inputValue.toFixed(2)}`
                });
            }

            lastOutputs = currentOutputs;

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset properties on redeployment
            node.enable = config.enable !== false;
            node.hysteresis = parseFloat(config.hysteresis) || 0.5;
            node.threshold1 = parseFloat(config.threshold1) || 10.0;
            node.threshold2 = parseFloat(config.threshold2) || 20.0;
            node.threshold3 = parseFloat(config.threshold3) || 30.0;
            node.threshold4 = parseFloat(config.threshold4) || 40.0;
            node.feedback1 = config.feedback1 !== false;
            node.feedback2 = config.feedback2 !== false;
            node.feedback3 = config.feedback3 !== false;
            node.feedback4 = config.feedback4 !== false;

            if (isNaN(node.hysteresis) || node.hysteresis < 0) {
                node.hysteresis = 0.5;
            }
            if (isNaN(node.threshold1) || isNaN(node.threshold2) || isNaN(node.threshold3) || isNaN(node.threshold4) ||
                node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
                node.threshold1 = 10.0;
                node.threshold2 = 20.0;
                node.threshold3 = 30.0;
                node.threshold4 = 40.0;
            }

            out1 = out2 = out3 = out4 = false;
            dOn = 0;
            lastInput = 0;
            lastOutputs = [false, false, false, false];

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("load-sequence-block", LoadSequenceBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/load-sequence-block/:id", RED.auth.needsPermission("load-sequence-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "load-sequence-block") {
            res.json({
                name: node.name || "load sequence",
                enable: node.enable !== false,
                hysteresis: !isNaN(node.hysteresis) && node.hysteresis >= 0 ? node.hysteresis : 0.5,
                threshold1: !isNaN(node.threshold1) ? node.threshold1 : 10.0,
                threshold2: !isNaN(node.threshold2) ? node.threshold2 : 20.0,
                threshold3: !isNaN(node.threshold3) ? node.threshold3 : 30.0,
                threshold4: !isNaN(node.threshold4) ? node.threshold4 : 40.0,
                feedback1: node.feedback1 !== false,
                feedback2: node.feedback2 !== false,
                feedback3: node.feedback3 !== false,
                feedback4: node.feedback4 !== false
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};