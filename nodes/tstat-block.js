module.exports = function(RED) {
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Store typed-input properties
        node.setpoint = config.setpoint;
        node.setpointType = config.setpointType;
        node.heatingSetpoint = config.heatingSetpoint;
        node.heatingSetpointType = config.heatingSetpointType;
        node.coolingSetpoint = config.coolingSetpoint;
        node.coolingSetpointType = config.coolingSetpointType;
        node.coolingOn = config.coolingOn;
        node.coolingOnType = config.coolingOnType;
        node.coolingOff = config.coolingOff;
        node.coolingOffType = config.coolingOffType;
        node.heatingOff = config.heatingOff;
        node.heatingOffType = config.heatingOffType;
        node.heatingOn = config.heatingOn;
        node.heatingOnType = config.heatingOnType;
        node.diff = config.diff;
        node.diffType = config.diffType;
        node.anticipator = config.anticipator;
        node.anticipatorType = config.anticipatorType;
        node.ignoreAnticipatorCycles = config.ignoreAnticipatorCycles;
        node.ignoreAnticipatorCyclesType = config.ignoreAnticipatorCyclesType;
        node.isHeating = config.isHeating;
        node.algorithm = config.algorithm;
        node.name = config.name;

        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;
        let lastIsHeating = null;
        let cyclesSinceModeChange = 0;
        let modeChanged = false;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (msg.context === "status") {
                    const statusPayload = {
                        algorithm: node.algorithm,
                        diff: node.diff,
                        diffType: node.diffType,
                        anticipator: node.anticipator,
                        anticipatorType: node.anticipatorType,
                        ignoreAnticipatorCycles: node.ignoreAnticipatorCycles,
                        ignoreAnticipatorCyclesType: node.ignoreAnticipatorCyclesType,
                        isHeating: node.isHeating
                    };
                    if (node.algorithm === "single") {
                        statusPayload.setpoint = node.setpoint;
                        statusPayload.setpointType = node.setpointType;
                    } else if (node.algorithm === "split") {
                        statusPayload.heatingSetpoint = node.heatingSetpoint;
                        statusPayload.heatingSetpointType = node.heatingSetpointType;
                        statusPayload.coolingSetpoint = node.coolingSetpoint;
                        statusPayload.coolingSetpointType = node.coolingSetpointType;
                    } else {
                        statusPayload.coolingOn = node.coolingOn;
                        statusPayload.coolingOnType = node.coolingOnType;
                        statusPayload.coolingOff = node.coolingOff;
                        statusPayload.coolingOffType = node.coolingOffType;
                        statusPayload.heatingOff = node.heatingOff;
                        statusPayload.heatingOffType = node.heatingOffType;
                        statusPayload.heatingOn = node.heatingOn;
                        statusPayload.heatingOnType = node.heatingOnType;
                    }
                    send([null, null, { payload: statusPayload }]);
                    node.status({ fill: "blue", shape: "dot", text: "status requested" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "algorithm":
                        if (["single", "split", "specified"].includes(msg.payload)) {
                            node.algorithm = msg.payload;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `algorithm: ${msg.payload}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid algorithm" });
                        }
                        break;
                    case "setpoint":
                        if (node.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "setpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.setpoint = msg.payload;
                            node.setpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `setpoint: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                        }
                        break;
                    case "heatingSetpoint":
                        if (node.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "heatingSetpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.heatingSetpoint = msg.payload;
                            node.heatingSetpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingSetpoint: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                        }
                        break;
                    case "coolingSetpoint":
                        if (node.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "coolingSetpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.coolingSetpoint = msg.payload;
                            node.coolingSetpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingSetpoint: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                        }
                        break;
                    case "coolingOn":
                        if (node.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "coolingOn not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.coolingOn = msg.payload;
                            node.coolingOnType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingOn: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOn" });
                        }
                        break;
                    case "coolingOff":
                        if (node.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "coolingOff not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.coolingOff = msg.payload;
                            node.coolingOffType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingOff: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOff" });
                        }
                        break;
                    case "heatingOff":
                        if (node.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "heatingOff not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.heatingOff = msg.payload;
                            node.heatingOffType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingOff: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOff" });
                        }
                        break;
                    case "heatingOn":
                        if (node.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "heatingOn not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        if (typeof msg.payload === 'number') {
                            node.heatingOn = msg.payload;
                            node.heatingOnType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingOn: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOn" });
                        }
                        break;
                    case "diff":
                        if (typeof msg.payload === 'number' && msg.payload >= 0.01) {
                            node.diff = msg.payload;
                            node.diffType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `diff: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid diff" });
                        }
                        break;
                    case "anticipator":
                        if (typeof msg.payload === 'number' && msg.payload >= -2) {
                            node.anticipator = msg.payload;
                            node.anticipatorType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `anticipator: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid anticipator" });
                        }
                        break;
                    case "ignoreAnticipatorCycles":
                        if (typeof msg.payload === 'number' && msg.payload >= 0) {
                            node.ignoreAnticipatorCycles = Math.floor(msg.payload);
                            node.ignoreAnticipatorCyclesType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `ignoreAnticipatorCycles: ${Math.floor(msg.payload)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid ignoreAnticipatorCycles" });
                        }
                        break;
                    case "isHeating":
                        if (typeof msg.payload === "boolean") {
                            node.isHeating = msg.payload;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `isHeating: ${msg.payload}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid isHeating" });
                        }
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        break;
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            const isHeating = msg.hasOwnProperty("isHeating") && typeof msg.isHeating === "boolean" ? msg.isHeating : node.isHeating;
            if (msg.hasOwnProperty("isHeating") && typeof msg.isHeating !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid isHeating (must be boolean)" });
                if (done) done();
                return;
            }

            // Evaluate all properties using typed-input system
            let setpoint, heatingSetpoint, coolingSetpoint, coolingOn, coolingOff, heatingOff, heatingOn, diff, anticipator, ignoreAnticipatorCycles;

            try {
                setpoint = RED.util.evaluateNodeProperty(node.setpoint, node.setpointType, node, msg);
                heatingSetpoint = RED.util.evaluateNodeProperty(node.heatingSetpoint, node.heatingSetpointType, node, msg);
                coolingSetpoint = RED.util.evaluateNodeProperty(node.coolingSetpoint, node.coolingSetpointType, node, msg);
                coolingOn = RED.util.evaluateNodeProperty(node.coolingOn, node.coolingOnType, node, msg);
                coolingOff = RED.util.evaluateNodeProperty(node.coolingOff, node.coolingOffType, node, msg);
                heatingOff = RED.util.evaluateNodeProperty(node.heatingOff, node.heatingOffType, node, msg);
                heatingOn = RED.util.evaluateNodeProperty(node.heatingOn, node.heatingOnType, node, msg);
                diff = RED.util.evaluateNodeProperty(node.diff, node.diffType, node, msg);
                anticipator = RED.util.evaluateNodeProperty(node.anticipator, node.anticipatorType, node, msg);
                ignoreAnticipatorCycles = RED.util.evaluateNodeProperty(node.ignoreAnticipatorCycles, node.ignoreAnticipatorCyclesType, node, msg);
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`, msg);
                if (done) done();
                return;
            }

            // Set defaults for invalid values
            if (typeof setpoint !== 'number' || isNaN(setpoint)) setpoint = 70;
            if (typeof heatingSetpoint !== 'number' || isNaN(heatingSetpoint)) heatingSetpoint = 68;
            if (typeof coolingSetpoint !== 'number' || isNaN(coolingSetpoint)) coolingSetpoint = 74;
            if (typeof coolingOn !== 'number' || isNaN(coolingOn)) coolingOn = 74;
            if (typeof coolingOff !== 'number' || isNaN(coolingOff)) coolingOff = 72;
            if (typeof heatingOff !== 'number' || isNaN(heatingOff)) heatingOff = 68;
            if (typeof heatingOn !== 'number' || isNaN(heatingOn)) heatingOn = 66;
            if (typeof diff !== 'number' || isNaN(diff) || diff < 0.01) diff = 2;
            if (typeof anticipator !== 'number' || isNaN(anticipator) || anticipator < -2) anticipator = 0.5;
            if (typeof ignoreAnticipatorCycles !== 'number' || isNaN(ignoreAnticipatorCycles) || ignoreAnticipatorCycles < 0) {
                ignoreAnticipatorCycles = 1;
            }

            // Handle mode changes and anticipator logic
            if (lastIsHeating !== null && isHeating !== lastIsHeating) {
                modeChanged = true;
                cyclesSinceModeChange = 0;
            }
            lastIsHeating = isHeating;   
            if ((below && !lastBelow) || (above && !lastAbove)) {
                cyclesSinceModeChange++;
            }

            let effectiveAnticipator = anticipator;
            if (modeChanged && ignoreAnticipatorCycles > 0 && cyclesSinceModeChange <= ignoreAnticipatorCycles) {
                effectiveAnticipator = 0;
            }
            if (cyclesSinceModeChange > ignoreAnticipatorCycles) {
                modeChanged = false;
            }

            lastAbove = above;
            lastBelow = below;

            // Main thermostat logic
            if (node.algorithm === "single") {
                const delta = diff / 2;
                const hiValue = setpoint + delta;
                const loValue = setpoint - delta;
                const hiOffValue = setpoint + effectiveAnticipator;
                const loOffValue = setpoint - effectiveAnticipator;

                if (input > hiValue) {
                    above = true;
                    below = false;
                } else if (input < loValue) {
                    above = false;
                    below = true;
                } else if (above && input < hiOffValue) {
                    above = false;
                } else if (below && input > loOffValue) {
                    below = false;
                }
            } else if (node.algorithm === "split") {
                if (isHeating) {
                    const delta = diff / 2;
                    const loValue = heatingSetpoint - delta;
                    const loOffValue = heatingSetpoint - effectiveAnticipator;

                    if (input < loValue) {
                        below = true;
                    } else if (below && input > loOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    const delta = diff / 2;
                    const hiValue = coolingSetpoint + delta;
                    const hiOffValue = coolingSetpoint + effectiveAnticipator;

                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < hiOffValue) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "specified") {
                if (isHeating) {
                    const heatingOffValue = heatingOff - effectiveAnticipator;
                    if (input < heatingOn) {
                        below = true;
                    } else if (below && input > heatingOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    const coolingOffValue = coolingOff + effectiveAnticipator;
                    if (input > coolingOn) {
                        above = true;
                    } else if (above && input < coolingOffValue) {
                        above = false;
                    }
                    below = false;
                }
            }
            
            // Add status information to every output message
            const statusInfo = {
                algorithm: node.algorithm,
                input: input,
                isHeating: isHeating,
                above: above,
                below: below,
                modeChanged: modeChanged,
                cyclesSinceModeChange: cyclesSinceModeChange,
                effectiveAnticipator: effectiveAnticipator
            };

            // Add algorithm-specific status
            if (node.algorithm === "single") {
                statusInfo.setpoint = setpoint;
                statusInfo.diff = diff;
                statusInfo.anticipator = anticipator;
            } else if (node.algorithm === "split") {
                statusInfo.heatingSetpoint = heatingSetpoint;
                statusInfo.coolingSetpoint = coolingSetpoint;
                statusInfo.diff = diff;
                statusInfo.anticipator = anticipator;
            } else {
                statusInfo.coolingOn = coolingOn;
                statusInfo.coolingOff = coolingOff;
                statusInfo.heatingOff = heatingOff;
                statusInfo.heatingOn = heatingOn;
                statusInfo.anticipator = anticipator;
            }

            // Create outputs with status information
            const outputs = [
                { 
                    payload: isHeating, 
                    context: "isHeating",
                    status: statusInfo
                },
                { 
                    payload: above,
                    status: statusInfo
                },
                { 
                    payload: below,
                    status: statusInfo
                }
            ];

            send(outputs);

            if (above === lastAbove && below === lastBelow) {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);
};
