module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function LoadSequenceBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name || "";
        node.enable = config.enable;
        node.hysteresis = parseFloat(config.hysteresis);
        node.threshold1 = parseFloat(config.threshold1);
        node.threshold2 = parseFloat(config.threshold2);
        node.threshold3 = parseFloat(config.threshold3);
        node.threshold4 = parseFloat(config.threshold4);
        node.feedback1 = config.feedback1;
        node.feedback2 = config.feedback2;
        node.feedback3 = config.feedback3;
        node.feedback4 = config.feedback4;
        node.out1 = false;
        node.out2 = false;
        node.out3 = false;
        node.out4 = false;
        node.dOn = 0;
        node.lastInput = 0;
        node.lastOutputs = [false, false, false, false];

        // Validate initial config
        if (isNaN(node.hysteresis) || node.hysteresis < 0) {
            node.hysteresis = 0.5;
            utils.setStatusError(node, "invalid hysteresis");
        }
        if (isNaN(node.threshold1) || isNaN(node.threshold2) || isNaN(node.threshold3) || isNaN(node.threshold4) ||
            node.threshold1 < 0 || node.threshold2 < 0 || node.threshold3 < 0 || node.threshold4 < 0 ||
            node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
            node.threshold1 = 10.0;
            node.threshold2 = 20.0;
            node.threshold3 = 30.0;
            node.threshold4 = 40.0;
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
                        node.enable = msg.payload;
                        utils.setStatusOK(node, `enable: ${node.enable}`);
                        break;
                    case "hysteresis":
                        const hystValue = parseFloat(msg.payload);
                        if (isNaN(hystValue) || hystValue < 0) {
                            utils.setStatusError(node, "invalid hysteresis");
                            if (done) done();
                            return;
                        }
                        node.hysteresis = hystValue;
                        utils.setStatusOK(node, `hysteresis: ${node.hysteresis}`);
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
                        const prevThresholds = [node.threshold1, node.threshold2, node.threshold3, node.threshold4];
                        const index = parseInt(msg.context.replace("threshold", "")) - 1;
                        const newThresholds = [...prevThresholds];
                        newThresholds[index] = threshValue;
                        if (newThresholds[0] >= newThresholds[1] || newThresholds[1] >= newThresholds[2] || newThresholds[2] >= newThresholds[3]) {
                            utils.setStatusError(node, "invalid threshold order");
                            if (done) done();
                            return;
                        }
                        node[`threshold${index + 1}`] = threshValue;
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
                        node[msg.context] = msg.payload;
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
                inputValue = node.lastInput;
            } else {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }
                if (msg.payload === "kill") {
                    inputValue = node.lastInput;
                } else {
                    inputValue = parseFloat(msg.payload);
                    if (isNaN(inputValue)) {
                        utils.setStatusError(node, "invalid payload");
                        if (done) done();
                        return;
                    }
                    node.lastInput = inputValue;
                }
            }

            // Kill switch
            if (msg.payload === "kill") {
                node.out1 = node.out2 = node.out3 = node.out4 = false;
                node.dOn = 0;
                node.lastOutputs = [false, false, false, false];
                utils.setStatusError(node, "kill: all off");
                send([{ payload: false }, { payload: false }, { payload: false }, { payload: false }]);
                if (done) done();
                return;
            }

            // Validate thresholds
            if (node.threshold1 >= node.threshold2 || node.threshold2 >= node.threshold3 || node.threshold3 >= node.threshold4) {
                utils.setStatusError(node, "invalid threshold order");
                if (done) done();
                return;
            }

            // Process logic
            let newMsg = [null, null, null, null];
            let numStagesOn = 0;

            if (!node.enable) {
                if (node.out4) {
                    node.out4 = false;
                    newMsg[3] = { payload: false };
                } else if (node.out3) {
                    node.out3 = false;
                    newMsg[2] = { payload: false };
                } else if (node.out2) {
                    node.out2 = false;
                    newMsg[1] = { payload: false };
                } else if (node.out1) {
                    node.out1 = false;
                    newMsg[0] = { payload: false };
                }
                numStagesOn = 0;
            } else {
                let newOut1 = node.out1;
                let newOut2 = node.out2;
                let newOut3 = node.out3;
                let newOut4 = node.out4;

                // Output 1
                if (node.out1) {
                    if (inputValue < (node.threshold1 - node.hysteresis) && (node.feedback1 && !node.out2)) {
                        newOut1 = false;
                    }
                } else if (inputValue >= node.threshold1) {
                    newOut1 = true;
                }

                // Output 2
                if (node.out2) {
                    if (inputValue < (node.threshold2 - node.hysteresis) && (node.feedback2 && !node.out3)) {
                        newOut2 = false;
                    }
                } else if (inputValue >= node.threshold2 && node.feedback1) {
                    newOut2 = true;
                }

                // Output 3
                if (node.out3) {
                    if (inputValue < (node.threshold3 - node.hysteresis) && (node.feedback3 && !node.out4)) {
                        newOut3 = false;
                    }
                } else if (inputValue >= node.threshold3 && node.feedback2) {
                    newOut3 = true;
                }

                // Output 4
                if (node.out4) {
                    if (inputValue < (node.threshold4 - node.hysteresis) && node.feedback4) {
                        newOut4 = false;
                    }
                } else if (inputValue >= node.threshold4 && node.feedback3) {
                    newOut4 = true;
                }

                // Prioritize lowest stage change
                if (newOut1 !== node.out1) {
                    node.out1 = newOut1;
                    newMsg = [{ payload: node.out1 }, null, null, null];
                } else if (newOut2 !== node.out2) {
                    node.out2 = newOut2;
                    newMsg = [null, { payload: node.out2 }, null, null];
                } else if (newOut3 !== node.out3) {
                    node.out3 = newOut3;
                    newMsg = [null, null, { payload: node.out3 }, null];
                } else if (newOut4 !== node.out4) {
                    node.out4 = newOut4;
                    newMsg = [null, null, null, { payload: node.out4 }];
                }

                numStagesOn = (node.out1 ? 1 : 0) + (node.out2 ? 1 : 0) + (node.out3 ? 1 : 0) + (node.out4 ? 1 : 0);
            }

            // Update state
            node.dOn = numStagesOn;

            // Check if outputs changed
            const outputsChanged = newMsg.some((msg, i) => msg !== null && msg.payload !== node.lastOutputs[i]);
            node.lastOutputs = [node.out1, node.out2, node.out3, node.out4];

            if (outputsChanged) {
                utils.setStatusChanged(node, `in: ${inputValue.toFixed(2)}, out: [${node.out1}, ${node.out2}, ${node.out3}, ${node.out4}]`);
                send(newMsg);
            } else {
                utils.setStatusUnchanged(node, `in: ${inputValue.toFixed(2)}, out: [${node.out1}, ${node.out2}, ${node.out3}, ${node.out4}]`);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("load-sequence-block", LoadSequenceBlockNode);
};