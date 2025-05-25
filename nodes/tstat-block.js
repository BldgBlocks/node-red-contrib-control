module.exports = function(RED) {
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const utils = require("./utils");

        node.runtime = {
            name: config.name || "tstat",
            algorithm: config.algorithm || "single",
            setpoint: parseFloat(config.setpoint) || 70,
            setpointType: config.setpointType || "num",
            heatingSetpoint: parseFloat(config.heatingSetpoint) || 68,
            heatingSetpointType: config.heatingSetpointType || "num",
            coolingSetpoint: parseFloat(config.coolingSetpoint) || 74,
            coolingSetpointType: config.coolingSetpointType || "num",
            coolingOff: parseFloat(config.coolingOff) || 72,
            coolingOffType: config.coolingOffType || "num",
            coolingOn: parseFloat(config.coolingOn) || 74,
            coolingOnType: config.coolingOnType || "num",
            heatingOff: parseFloat(config.heatingOff) || 68,
            heatingOffType: config.heatingOffType || "num",
            heatingOn: parseFloat(config.heatingOn) || 66,
            heatingOnType: config.heatingOnType || "num",
            diff: parseFloat(config.diff) || 2,
            diffType: config.diffType || "num",
            anticipator: parseFloat(config.anticipator) || 0.5,
            anticipatorType: config.anticipatorType || "num",
            ignoreAnticipatorCycles: parseInt(config.ignoreAnticipatorCycles) || 1,
            ignoreAnticipatorCyclesType: config.ignoreAnticipatorCyclesType || "num",
            isHeating: config.isHeating === true
        };

        console.log("TstatBlockNode init anticipator:", node.runtime.anticipator, "config:", config.anticipator);

        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;
        let lastIsHeating = null;
        let cyclesSinceModeChange = 0;
        let modeChanged = false;

        if (node.runtime.diff <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid diff (must be positive)" });
        }
        if (node.runtime.ignoreAnticipatorCycles < 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid ignoreAnticipatorCycles (must be non-negative)" });
        }
        if (node.runtime.algorithm === "specified") {
            const coolingOn = parseFloat(node.runtime.coolingOn);
            const coolingOff = parseFloat(node.runtime.coolingOff);
            const heatingOff = parseFloat(node.runtime.heatingOff);
            const heatingOn = parseFloat(node.runtime.heatingOn);
            if (isNaN(coolingOn) || isNaN(coolingOff) || isNaN(heatingOff) || isNaN(heatingOn) ||
                coolingOn < coolingOff || coolingOff < heatingOff || heatingOff < heatingOn) {
                node.status({ fill: "red", shape: "ring", text: "invalid specified setpoints (coolingOn >= coolingOff >= heatingOff >= heatingOn)" });
            }
        }
        if (node.runtime.algorithm === "split") {
            const heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
            const coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
            if (isNaN(heatingSetpoint) || isNaN(coolingSetpoint) || coolingSetpoint <= heatingSetpoint) {
                node.status({ fill: "red", shape: "ring", text: "invalid split setpoints (coolingSetpoint > heatingSetpoint)" });
            }
        }

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
                        algorithm: node.runtime.algorithm,
                        diff: node.runtime.diff,
                        diffType: node.runtime.diffType,
                        anticipator: node.runtime.anticipator,
                        anticipatorType: node.runtime.anticipatorType,
                        ignoreAnticipatorCycles: node.runtime.ignoreAnticipatorCycles,
                        ignoreAnticipatorCyclesType: node.runtime.ignoreAnticipatorCyclesType,
                        isHeating: node.runtime.isHeating
                    };
                    if (node.runtime.algorithm === "single") {
                        statusPayload.setpoint = node.runtime.setpoint;
                        statusPayload.setpointType = node.runtime.setpointType;
                    } else if (node.runtime.algorithm === "split") {
                        statusPayload.heatingSetpoint = node.runtime.heatingSetpoint;
                        statusPayload.heatingSetpointType = node.runtime.heatingSetpointType;
                        statusPayload.coolingSetpoint = node.runtime.coolingSetpoint;
                        statusPayload.coolingSetpointType = node.runtime.coolingSetpointType;
                    } else {
                        statusPayload.coolingOn = node.runtime.coolingOn;
                        statusPayload.coolingOnType = node.runtime.coolingOnType;
                        statusPayload.coolingOff = node.runtime.coolingOff;
                        statusPayload.coolingOffType = node.runtime.coolingOffType;
                        statusPayload.heatingOff = node.runtime.heatingOff;
                        statusPayload.heatingOffType = node.runtime.heatingOffType;
                        statusPayload.heatingOn = node.runtime.heatingOn;
                        statusPayload.heatingOnType = node.runtime.heatingOnType;
                    }
                    send([null, null, { payload: statusPayload }]);
                    node.status({ fill: "blue", shape: "dot", text: "status requested" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "algorithm":
                        if (["single", "split", "specified"].includes(msg.payload)) {
                            node.runtime.algorithm = msg.payload;
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
                        if (node.runtime.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "setpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const spValue = parseFloat(msg.payload);
                        if (!isNaN(spValue)) {
                            node.runtime.setpoint = spValue;
                            node.runtime.setpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `setpoint: ${spValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                        }
                        break;
                    case "heatingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "heatingSetpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const hspValue = parseFloat(msg.payload);
                        if (!isNaN(hspValue) && hspValue < node.runtime.coolingSetpoint) {
                            node.runtime.heatingSetpoint = hspValue;
                            node.runtime.heatingSetpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingSetpoint: ${hspValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                        }
                        break;
                    case "coolingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "coolingSetpoint not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const cspValue = parseFloat(msg.payload);
                        if (!isNaN(cspValue) && cspValue > node.runtime.heatingSetpoint) {
                            node.runtime.coolingSetpoint = cspValue;
                            node.runtime.coolingSetpointType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingSetpoint: ${cspValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                        }
                        break;
                    case "coolingOn":
                        if (node.runtime.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "coolingOn not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const conValue = parseFloat(msg.payload);
                        if (!isNaN(conValue) && conValue >= node.runtime.coolingOff) {
                            node.runtime.coolingOn = conValue;
                            node.runtime.coolingOnType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingOn: ${conValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOn" });
                        }
                        break;
                    case "coolingOff":
                        if (node.runtime.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "coolingOff not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const coffValue = parseFloat(msg.payload);
                        if (!isNaN(coffValue) && coffValue <= node.runtime.coolingOn && coffValue >= node.runtime.heatingOff) {
                            node.runtime.coolingOff = coffValue;
                            node.runtime.coolingOffType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `coolingOff: ${coffValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOff" });
                        }
                        break;
                    case "heatingOff":
                        if (node.runtime.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "heatingOff not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const hoffValue = parseFloat(msg.payload);
                        if (!isNaN(hoffValue) && hoffValue <= node.runtime.coolingOff && hoffValue >= node.runtime.heatingOn) {
                            node.runtime.heatingOff = hoffValue;
                            node.runtime.heatingOffType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingOff: ${hoffValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOff" });
                        }
                        break;
                    case "heatingOn":
                        if (node.runtime.algorithm !== "specified") {
                            node.status({ fill: "red", shape: "ring", text: "heatingOn not used in this algorithm" });
                            if (done) done();
                            return;
                        }
                        const honValue = parseFloat(msg.payload);
                        if (!isNaN(honValue) && honValue <= node.runtime.heatingOff) {
                            node.runtime.heatingOn = honValue;
                            node.runtime.heatingOnType = "num";
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `heatingOn: ${honValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOn" });
                        }
                        break;
                    case "diff":
                        const diffValue = utils.validateProperty(
                            msg.payload, "num", 2, { name: "diff", min: 0.01 }, msg, node
                        );
                        node.runtime.diff = diffValue;
                        node.runtime.diffType = "num";
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `diff: ${diffValue.toFixed(2)}`
                        });
                        break;
                    case "anticipator":
                        const antValue = utils.validateProperty(
                            msg.payload, "num", 0.5, { name: "anticipator", min: -2 }, msg, node
                        );
                        node.runtime.anticipator = antValue;
                        node.runtime.anticipatorType = "num";
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `anticipator: ${antValue.toFixed(2)}`
                        });
                        break;
                    case "ignoreAnticipatorCycles":
                        const cyclesValue = utils.validateProperty(
                            msg.payload, "num", 1, { name: "ignoreAnticipatorCycles", min: 0 }, msg, node
                        );
                        node.runtime.ignoreAnticipatorCycles = Math.floor(cyclesValue);
                        node.runtime.ignoreAnticipatorCyclesType = "num";
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `ignoreAnticipatorCycles: ${cyclesValue}`
                        });
                        break;
                    case "isHeating":
                        if (typeof msg.payload === "boolean") {
                            node.runtime.isHeating = msg.payload;
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

            const isHeating = msg.hasOwnProperty("isHeating") && typeof msg.isHeating === "boolean" ? msg.isHeating : node.runtime.isHeating;
            if (msg.hasOwnProperty("isHeating") && typeof msg.isHeating !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid isHeating (must be boolean)" });
                if (done) done();
                return;
            }

            console.log("TstatBlockNode input:", { input, isHeating, anticipator: node.runtime.anticipator });

            if (node.runtime.algorithm === "single") {
                node.runtime.setpoint = utils.validateProperty(
                    node.runtime.setpoint, node.runtime.setpointType, 70, { name: "setpoint" }, msg, node
                );
                node.runtime.setpointType = "num";
                node.runtime.diff = utils.validateProperty(
                    node.runtime.diff, node.runtime.diffType, 2, { name: "diff", min: 0.01 }, msg, node
                );
                node.runtime.diffType = "num";
            } else if (node.runtime.algorithm === "split") {
                node.runtime.heatingSetpoint = utils.validateProperty(
                    node.runtime.heatingSetpoint, node.runtime.heatingSetpointType, 68, { name: "heatingSetpoint" }, msg, node
                );
                node.runtime.heatingSetpointType = "num";
                node.runtime.coolingSetpoint = utils.validateProperty(
                    node.runtime.coolingSetpoint, node.runtime.coolingSetpointType, 74, { name: "coolingSetpoint" }, msg, node
                );
                node.runtime.coolingSetpointType = "num";
                const heatingSetpoint = node.runtime.heatingSetpoint;
                const coolingSetpoint = node.runtime.coolingSetpoint;
                if (isNaN(heatingSetpoint) || isNaN(coolingSetpoint) || coolingSetpoint <= heatingSetpoint) {
                    node.status({ fill: "red", shape: "ring", text: "invalid split setpoints (coolingSetpoint > heatingSetpoint)" });
                    if (done) done();
                    return;
                }
            } else if (node.runtime.algorithm === "specified") {
                node.runtime.coolingOn = utils.validateProperty(
                    node.runtime.coolingOn, node.runtime.coolingOnType, 74, { name: "coolingOn" }, msg, node
                );
                node.runtime.coolingOnType = "num";
                node.runtime.coolingOff = utils.validateProperty(
                    node.runtime.coolingOff, node.runtime.coolingOffType, 72, { name: "coolingOff" }, msg, node
                );
                node.runtime.coolingOffType = "num";
                node.runtime.heatingOff = utils.validateProperty(
                    node.runtime.heatingOff, node.runtime.heatingOffType, 68, { name: "heatingOff" }, msg, node
                );
                node.runtime.heatingOffType = "num";
                node.runtime.heatingOn = utils.validateProperty(
                    node.runtime.heatingOn, node.runtime.heatingOnType, 66, { name: "heatingOn" }, msg, node
                );
                node.runtime.heatingOnType = "num";
                const coolingOn = node.runtime.coolingOn;
                const coolingOff = node.runtime.coolingOff;
                const heatingOff = node.runtime.heatingOff;
                const heatingOn = node.runtime.heatingOn;
                if (isNaN(coolingOn) || isNaN(coolingOff) || isNaN(heatingOff) || isNaN(heatingOn) ||
                    coolingOn < coolingOff || coolingOff < heatingOff || heatingOff < heatingOn) {
                    node.status({ fill: "red", shape: "ring", text: "invalid specified setpoints (coolingOn >= coolingOff >= heatingOff >= heatingOn)" });
                    if (done) done();
                    return;
                }
            }

            node.runtime.anticipator = utils.validateProperty(
                node.runtime.anticipator, node.runtime.anticipatorType, 0.5, { name: "anticipator", min: -2 }, msg, node
            );
            node.runtime.anticipatorType = "num";
            node.runtime.ignoreAnticipatorCycles = Math.floor(utils.validateProperty(
                node.runtime.ignoreAnticipatorCycles, node.runtime.ignoreAnticipatorCyclesType, 1, { name: "ignoreAnticipatorCycles", min: 0 }, msg, node
            ));
            node.runtime.ignoreAnticipatorCyclesType = "num";

            if (lastIsHeating !== null && isHeating !== lastIsHeating) {
                modeChanged = true;
                cyclesSinceModeChange = 0;
            }
            lastIsHeating = isHeating;

            if ((below && !lastBelow) || (above && !lastAbove)) {
                cyclesSinceModeChange++;
            }

            let effectiveAnticipator = node.runtime.anticipator;
            if (modeChanged && node.runtime.ignoreAnticipatorCycles > 0 && cyclesSinceModeChange <= node.runtime.ignoreAnticipatorCycles) {
                effectiveAnticipator = 0;
            }
            if (cyclesSinceModeChange > node.runtime.ignoreAnticipatorCycles) {
                modeChanged = false;
            }

            lastAbove = above;
            lastBelow = below;

            if (node.runtime.algorithm === "single") {
                const setpoint = node.runtime.setpoint;
                const delta = node.runtime.diff / 2;
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
            } else if (node.runtime.algorithm === "split") {
                if (node.runtime.isHeating) {
                    const heatingSetpoint = node.runtime.heatingSetpoint;
                    const delta = node.runtime.diff / 2;
                    const loValue = heatingSetpoint - delta;
                    const loOffValue = heatingSetpoint - effectiveAnticipator;

                    if (input < loValue) {
                        below = true;
                    } else if (below && input > loOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    const coolingSetpoint = node.runtime.coolingSetpoint;
                    const delta = node.runtime.diff / 2;
                    const hiValue = coolingSetpoint + delta;
                    const hiOffValue = coolingSetpoint + effectiveAnticipator;

                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < hiOffValue) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.runtime.algorithm === "specified") {
                if (node.runtime.isHeating) {
                    const heatingOn = node.runtime.heatingOn;
                    const heatingOff = node.runtime.heatingOff;
                    const heatingOffValue = heatingOff - effectiveAnticipator;
                    if (input < heatingOn) {
                        below = true;
                    } else if (below && input > heatingOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    const coolingOn = node.runtime.coolingOn;
                    const coolingOff = node.runtime.coolingOff;
                    const coolingOffValue = coolingOff + effectiveAnticipator;
                    if (input > coolingOn) {
                        above = true;
                    } else if (above && input < coolingOffValue) {
                        above = false;
                    }
                    below = false;
                }
            }

            const outputs = [
                { payload: node.runtime.isHeating, context: "isHeating" },
                { payload: above },
                { payload: below }
            ];
            send(outputs);

            if (above === lastAbove && below === lastBelow) {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${node.runtime.isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${node.runtime.isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);

    RED.httpAdmin.get("/tstat-block-runtime/:id", RED.auth.needsPermission("tstat-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        const runtime = {
            name: node?.runtime?.name || "tstat",
            algorithm: node?.runtime?.algorithm || node?.algorithm || "single",
            diff: node?.runtime?.diff !== undefined ? node.runtime.diff : parseFloat(node?.diff) || 2,
            diffType: node?.runtime?.diffType || node?.diffType || "num",
            anticipator: node?.runtime?.anticipator !== undefined ? node.runtime.anticipator : parseFloat(node?.anticipator) || 0.5,
            anticipatorType: node?.runtime?.anticipatorType || node?.anticipatorType || "num",
            ignoreAnticipatorCycles: node?.runtime?.ignoreAnticipatorCycles !== undefined ? node.runtime.ignoreAnticipatorCycles : parseInt(node?.ignoreAnticipatorCycles) || 1,
            ignoreAnticipatorCyclesType: node?.runtime?.ignoreAnticipatorCyclesType || node?.ignoreAnticipatorCyclesType || "num",
            isHeating: node?.runtime?.isHeating !== undefined ? node.runtime.isHeating : node?.isHeating || false
        };
        if (runtime.algorithm === "single") {
            runtime.setpoint = node?.runtime?.setpoint !== undefined ? node.runtime.setpoint : parseFloat(node?.setpoint) || 70;
            runtime.setpointType = node?.runtime?.setpointType || node?.setpointType || "num";
        } else if (runtime.algorithm === "split") {
            runtime.heatingSetpoint = node?.runtime?.heatingSetpoint !== undefined ? node.runtime.heatingSetpoint : parseFloat(node?.heatingSetpoint) || 68;
            runtime.heatingSetpointType = node?.runtime?.heatingSetpointType || node?.heatingSetpointType || "num";
            runtime.coolingSetpoint = node?.runtime?.coolingSetpoint !== undefined ? node.runtime.coolingSetpoint : parseFloat(node?.coolingSetpoint) || 74;
            runtime.coolingSetpointType = node?.runtime?.coolingSetpointType || node?.coolingSetpointType || "num";
        } else {
            runtime.coolingOn = node?.runtime?.coolingOn !== undefined ? node.runtime.coolingOn : parseFloat(node?.coolingOn) || 74;
            runtime.coolingOnType = node?.runtime?.coolingOnType || node?.coolingOnType || "num";
            runtime.coolingOff = node?.runtime?.coolingOff !== undefined ? node.runtime.coolingOff : parseFloat(node?.coolingOff) || 72;
            runtime.coolingOffType = node?.runtime?.coolingOffType || node?.coolingOffType || "num";
            runtime.heatingOff = node?.runtime?.heatingOff !== undefined ? node.runtime.heatingOff : parseFloat(node?.heatingOff) || 68;
            runtime.heatingOffType = node?.runtime?.heatingOffType || node?.heatingOffType || "num";
            runtime.heatingOn = node?.runtime?.heatingOn !== undefined ? node.runtime.heatingOn : parseFloat(node?.heatingOn) || 66;
            runtime.heatingOnType = node?.runtime?.heatingOnType || node?.heatingOnType || "num";
        }
        console.log("Runtime endpoint anticipator:", runtime.anticipator);
        res.json(runtime);
    });
};