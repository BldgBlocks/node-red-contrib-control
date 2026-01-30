module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function LoadSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            enable: config.enable,
            hysteresis: parseFloat(config.hysteresis),
            threshold1: parseFloat(config.threshold1),
            threshold2: parseFloat(config.threshold2),
            threshold3: parseFloat(config.threshold3),
            threshold4: parseFloat(config.threshold4),
            feedback1: config.feedback1,
            feedback2: config.feedback2,
            feedback3: config.feedback3,
            feedback4: config.feedback4,
            out1: false,
            out2: false,
            out3: false,
            out4: false,
            dOn: 0,
            lastInput: 0,
            lastOutputs: [false, false, false, false]
        };

        // Validate initial config
        if (isNaN(node.runtime.hysteresis) || node.runtime.hysteresis < 0) {
            node.runtime.hysteresis = 0.5;
            utils.setStatusError(node, "invalid hysteresis");
        }
        if (isNaN(node.runtime.threshold1) || isNaN(node.runtime.threshold2) || isNaN(node.runtime.threshold3) || isNaN(node.runtime.threshold4) ||
            node.runtime.threshold1 < 0 || node.runtime.threshold2 < 0 || node.runtime.threshold3 < 0 || node.runtime.threshold4 < 0 ||
            node.runtime.threshold1 >= node.runtime.threshold2 || node.runtime.threshold2 >= node.runtime.threshold3 || node.runtime.threshold3 >= node.runtime.threshold4) {
            node.runtime.threshold1 = 10.0;
            node.runtime.threshold2 = 20.0;
            node.runtime.threshold3 = 30.0;
            node.runtime.threshold4 = 40.0;
            utils.setStatusError(node, "invalid threshold order");
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle configuration updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "enable":
                        if (typeof msg.payload !== "boolean") {
                            utils.setStatusError(node, "invalid enable");
                            if (done) done();
                            return;
                        }
                        node.runtime.enable = msg.payload;
                        utils.setStatusOK(node, `enable: ${node.runtime.enable}`);
                        break;
                    case "hysteresis":
                        const hystValue = parseFloat(msg.payload);
                        if (isNaN(hystValue) || hystValue < 0) {
                            utils.setStatusError(node, "invalid hysteresis");
                            if (done) done();
                            return;
                        }
                        node.runtime.hysteresis = hystValue;
                        utils.setStatusOK(node, `hysteresis: ${node.runtime.hysteresis}`);
                        break;
                    case "threshold1":
                    case "threshold2":
                    case "threshold3":
                    case "threshold4":
                        const threshValue = parseFloat(msg.payload);
                        if (isNaN(threshValue) || threshValue < 0) {
                            utils.setStatusError(node, `invalid ${msg.context}`);
                            if (done) done();
                            return;
                        }
                        const prevThresholds = [node.runtime.threshold1, node.runtime.threshold2, node.runtime.threshold3, node.runtime.threshold4];
                        const index = parseInt(msg.context.replace("threshold", "")) - 1;
                        const newThresholds = [...prevThresholds];
                        newThresholds[index] = threshValue;
                        if (newThresholds[0] >= newThresholds[1] || newThresholds[1] >= newThresholds[2] || newThresholds[2] >= newThresholds[3]) {
                            utils.setStatusError(node, "invalid threshold order");
                            if (done) done();
                            return;
                        }
                        node.runtime[`threshold${index + 1}`] = threshValue;
                        utils.setStatusOK(node, `${msg.context}: ${threshValue}`);
                        break;
                    case "feedback1":
                    case "feedback2":
                    case "feedback3":
                    case "feedback4":
                        if (typeof msg.payload !== "boolean") {
                            utils.setStatusError(node, `invalid ${msg.context}`);
                            if (done) done();
                            return;
                        }
                        node.runtime[msg.context] = msg.payload;
                        utils.setStatusOK(node, `${msg.context}: ${msg.payload}`);
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        if (done) done("Unknown context");
                        return;
                }
            }

            // Handle input
            let inputValue;
            if (msg.hasOwnProperty("context")) {
                inputValue = node.runtime.lastInput;
            } else {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }
                if (msg.payload === "kill") {
                    inputValue = node.runtime.lastInput;
                } else {
                    inputValue = parseFloat(msg.payload);
                    if (isNaN(inputValue)) {
                        utils.setStatusError(node, "invalid payload");
                        if (done) done();
                        return;
                    }
                    node.runtime.lastInput = inputValue;
                }
            }

            // Kill switch
            if (msg.payload === "kill") {
                node.runtime.out1 = node.runtime.out2 = node.runtime.out3 = node.runtime.out4 = false;
                node.runtime.dOn = 0;
                node.runtime.lastOutputs = [false, false, false, false];
                utils.setStatusError(node, "kill: all off");
                send([{ payload: false }, { payload: false }, { payload: false }, { payload: false }]);
                if (done) done();
                return;
            }

            // Validate thresholds
            if (node.runtime.threshold1 >= node.runtime.threshold2 || node.runtime.threshold2 >= node.runtime.threshold3 || node.runtime.threshold3 >= node.runtime.threshold4) {
                utils.setStatusError(node, "invalid threshold order");
                if (done) done();
                return;
            }

            // Process logic
            let newMsg = [null, null, null, null];
            let numStagesOn = 0;

            if (!node.runtime.enable) {
                if (node.runtime.out4) {
                    node.runtime.out4 = false;
                    newMsg[3] = { payload: false };
                } else if (node.runtime.out3) {
                    node.runtime.out3 = false;
                    newMsg[2] = { payload: false };
                } else if (node.runtime.out2) {
                    node.runtime.out2 = false;
                    newMsg[1] = { payload: false };
                } else if (node.runtime.out1) {
                    node.runtime.out1 = false;
                    newMsg[0] = { payload: false };
                }
                numStagesOn = 0;
            } else {
                let newOut1 = node.runtime.out1;
                let newOut2 = node.runtime.out2;
                let newOut3 = node.runtime.out3;
                let newOut4 = node.runtime.out4;

                // Output 1
                if (node.runtime.out1) {
                    if (inputValue < (node.runtime.threshold1 - node.runtime.hysteresis) && (node.runtime.feedback1 && !node.runtime.out2)) {
                        newOut1 = false;
                    }
                } else if (inputValue >= node.runtime.threshold1) {
                    newOut1 = true;
                }

                // Output 2
                if (node.runtime.out2) {
                    if (inputValue < (node.runtime.threshold2 - node.runtime.hysteresis) && (node.runtime.feedback2 && !node.runtime.out3)) {
                        newOut2 = false;
                    }
                } else if (inputValue >= node.runtime.threshold2 && node.runtime.feedback1) {
                    newOut2 = true;
                }

                // Output 3
                if (node.runtime.out3) {
                    if (inputValue < (node.runtime.threshold3 - node.runtime.hysteresis) && (node.runtime.feedback3 && !node.runtime.out4)) {
                        newOut3 = false;
                    }
                } else if (inputValue >= node.runtime.threshold3 && node.runtime.feedback2) {
                    newOut3 = true;
                }

                // Output 4
                if (node.runtime.out4) {
                    if (inputValue < (node.runtime.threshold4 - node.runtime.hysteresis) && node.runtime.feedback4) {
                        newOut4 = false;
                    }
                } else if (inputValue >= node.runtime.threshold4 && node.runtime.feedback3) {
                    newOut4 = true;
                }

                // Prioritize lowest stage change
                if (newOut1 !== node.runtime.out1) {
                    node.runtime.out1 = newOut1;
                    newMsg = [{ payload: node.runtime.out1 }, null, null, null];
                } else if (newOut2 !== node.runtime.out2) {
                    node.runtime.out2 = newOut2;
                    newMsg = [null, { payload: node.runtime.out2 }, null, null];
                } else if (newOut3 !== node.runtime.out3) {
                    node.runtime.out3 = newOut3;
                    newMsg = [null, null, { payload: node.runtime.out3 }, null];
                } else if (newOut4 !== node.runtime.out4) {
                    node.runtime.out4 = newOut4;
                    newMsg = [null, null, null, { payload: node.runtime.out4 }];
                }

                numStagesOn = (node.runtime.out1 ? 1 : 0) + (node.runtime.out2 ? 1 : 0) + (node.runtime.out3 ? 1 : 0) + (node.runtime.out4 ? 1 : 0);
            }

            // Update state
            node.runtime.dOn = numStagesOn;

            // Check if outputs changed
            const outputsChanged = newMsg.some((msg, i) => msg !== null && msg.payload !== node.runtime.lastOutputs[i]);
            node.runtime.lastOutputs = [node.runtime.out1, node.runtime.out2, node.runtime.out3, node.runtime.out4];

            if (outputsChanged) {
                utils.setStatusChanged(node, `in: ${inputValue.toFixed(2)}, out: [${node.runtime.out1}, ${node.runtime.out2}, ${node.runtime.out3}, ${node.runtime.out4}]`);
                send(newMsg);
            } else {
                utils.setStatusUnchanged(node, `in: ${inputValue.toFixed(2)}, out: [${node.runtime.out1}, ${node.runtime.out2}, ${node.runtime.out3}, ${node.runtime.out4}]`);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("load-sequence-block", LoadSequenceBlockNode);
};