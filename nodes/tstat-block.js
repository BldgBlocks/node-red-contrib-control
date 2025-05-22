module.exports = function(RED) {
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        const utils = require("./utils");
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "tstat",
            algorithm: config.algorithm || "single",
            setpoint: config.setpoint || "70",
            setpointType: config.setpointType || "num",
            heatingSetpoint: config.heatingSetpoint || "68",
            heatingSetpointType: config.heatingSetpointType || "num",
            coolingSetpoint: config.coolingSetpoint || "74",
            coolingSetpointType: config.coolingSetpointType || "num",
            coolingOff: config.coolingOff || "72",
            coolingOffType: config.coolingOffType || "num",
            coolingOn: config.coolingOn || "74",
            coolingOnType: config.coolingOnType || "num",
            heatingOff: config.heatingOff || "68",
            heatingOffType: config.heatingOffType || "num",
            heatingOn: config.heatingOn || "66",
            heatingOnType: config.heatingOnType || "num",
            diff: parseFloat(config.diff) || 2,
            isHeating: config.isHeating === true
        };

        // Validate non-typedInput fields at startup
        if (node.runtime.diff <= 0) {
            node.runtime.diff = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid diff, using 2" });
        }
        // Validate specified algorithm setpoints
        if (node.runtime.algorithm === "specified") {
            const coolingOn = parseFloat(node.runtime.coolingOn);
            const coolingOff = parseFloat(node.runtime.coolingOff);
            const heatingOff = parseFloat(node.runtime.heatingOff);
            const heatingOn = parseFloat(node.runtime.heatingOn);
            if (isNaN(coolingOn) || isNaN(coolingOff) || isNaN(heatingOff) || isNaN(heatingOn) ||
                coolingOn < coolingOff || coolingOff < heatingOff || heatingOff < heatingOn) {
                node.runtime.coolingOn = "74";
                node.runtime.coolingOff = "72";
                node.runtime.heatingOff = "68";
                node.runtime.heatingOn = "66";
                node.status({ fill: "red", shape: "ring", text: "invalid specified setpoints, using defaults" });
            }
        }

        // Initialize state
        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Resolve typed inputs
            if (node.runtime.algorithm === "single") {
                node.runtime.setpoint = utils.getTypedValue(
                    node, node.runtime.setpointType, node.runtime.setpoint, msg,
                    { name: "setpoint" }, 70
                ).toString();
                node.runtime.setpointType = "num";
            } else if (node.runtime.algorithm === "split") {
                node.runtime.heatingSetpoint = utils.getTypedValue(
                    node, node.runtime.heatingSetpointType, node.runtime.heatingSetpoint, msg,
                    { name: "heatingSetpoint" }, 68
                ).toString();
                node.runtime.heatingSetpointType = "num";
                node.runtime.coolingSetpoint = utils.getTypedValue(
                    node, node.runtime.coolingSetpointType, node.runtime.coolingSetpoint, msg,
                    { name: "coolingSetpoint" }, 74
                ).toString();
                node.runtime.coolingSetpointType = "num";
                if (parseFloat(node.runtime.coolingSetpoint) < parseFloat(node.runtime.heatingSetpoint)) {
                    node.runtime.coolingSetpoint = node.runtime.heatingSetpoint;
                }
            } else if (node.runtime.algorithm === "specified") {
                node.runtime.coolingOn = utils.getTypedValue(
                    node, node.runtime.coolingOnType, node.runtime.coolingOn, msg,
                    { name: "coolingOn" }, 74
                ).toString();
                node.runtime.coolingOnType = "num";
                node.runtime.coolingOff = utils.getTypedValue(
                    node, node.runtime.coolingOffType, node.runtime.coolingOff, msg,
                    { name: "coolingOff" }, 72
                ).toString();
                node.runtime.coolingOffType = "num";
                node.runtime.heatingOff = utils.getTypedValue(
                    node, node.runtime.heatingOffType, node.runtime.heatingOff, msg,
                    { name: "heatingOff" }, 68
                ).toString();
                node.runtime.heatingOffType = "num";
                node.runtime.heatingOn = utils.getTypedValue(
                    node, node.runtime.heatingOnType, node.runtime.heatingOn, msg,
                    { name: "heatingOn" }, 66
                ).toString();
                node.runtime.heatingOnType = "num";
                // Validate specified setpoints
                const coolingOn = parseFloat(node.runtime.coolingOn);
                const coolingOff = parseFloat(node.runtime.coolingOff);
                const heatingOff = parseFloat(node.runtime.heatingOff);
                const heatingOn = parseFloat(node.runtime.heatingOn);
                if (coolingOn < coolingOff) node.runtime.coolingOn = node.runtime.coolingOff;
                if (coolingOff < heatingOff) node.runtime.coolingOff = node.runtime.heatingOff;
                if (heatingOff < heatingOn) node.runtime.heatingOff = node.runtime.heatingOn;
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
                        isHeating: node.runtime.isHeating
                    };
                    if (node.runtime.algorithm === "single") {
                        statusPayload.setpoint = parseFloat(node.runtime.setpoint);
                        statusPayload.setpointType = node.runtime.setpointType;
                    } else if (node.runtime.algorithm === "split") {
                        statusPayload.heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                        statusPayload.heatingSetpointType = node.runtime.heatingSetpointType;
                        statusPayload.coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                        statusPayload.coolingSetpointType = node.runtime.coolingSetpointType;
                    } else {
                        statusPayload.coolingOn = parseFloat(node.runtime.coolingOn);
                        statusPayload.coolingOnType = node.runtime.coolingOnType;
                        statusPayload.coolingOff = parseFloat(node.runtime.coolingOff);
                        statusPayload.coolingOffType = node.runtime.coolingOffType;
                        statusPayload.heatingOff = parseFloat(node.runtime.heatingOff);
                        statusPayload.heatingOffType = node.runtime.heatingOffType;
                        statusPayload.heatingOn = parseFloat(node.runtime.heatingOn);
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
                            node.runtime.setpoint = spValue.toString();
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
                        if (!isNaN(hspValue) && hspValue <= parseFloat(node.runtime.coolingSetpoint)) {
                            node.runtime.heatingSetpoint = hspValue.toString();
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
                        if (!isNaN(cspValue) && cspValue >= parseFloat(node.runtime.heatingSetpoint)) {
                            node.runtime.coolingSetpoint = cspValue.toString();
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
                        if (!isNaN(conValue) && conValue >= parseFloat(node.runtime.coolingOff)) {
                            node.runtime.coolingOn = conValue.toString();
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
                        if (!isNaN(coffValue) && coffValue <= parseFloat(node.runtime.coolingOn) && coffValue >= parseFloat(node.runtime.heatingOff)) {
                            node.runtime.coolingOff = coffValue.toString();
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
                        if (!isNaN(hoffValue) && hoffValue <= parseFloat(node.runtime.coolingOff) && hoffValue >= parseFloat(node.runtime.heatingOn)) {
                            node.runtime.heatingOff = hoffValue.toString();
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
                        if (!isNaN(honValue) && honValue <= parseFloat(node.runtime.heatingOff)) {
                            node.runtime.heatingOn = honValue.toString();
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
                        const diffValue = parseFloat(msg.payload);
                        if (!isNaN(diffValue) && diffValue >= 0) {
                            node.runtime.diff = diffValue;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `diff: ${diffValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid diff" });
                        }
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

            // Store previous state for unchanged check
            lastAbove = above;
            lastBelow = below;

            // Thermostat logic
            if (node.runtime.algorithm === "single") {
                const setpoint = parseFloat(node.runtime.setpoint);
                const delta = node.runtime.diff / 2;
                const hiValue = setpoint + delta;
                const loValue = setpoint - delta;

                if (input > hiValue) {
                    above = true;
                    below = false;
                } else if (input < loValue) {
                    above = false;
                    below = true;
                } else if (above && input < setpoint) {
                    above = false;
                } else if (below && input > setpoint) {
                    below = false;
                }
            } else if (node.runtime.algorithm === "split") {
                if (node.runtime.isHeating) {
                    const heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                    const delta = node.runtime.diff / 2;
                    const loValue = heatingSetpoint - delta;

                    if (input < loValue) {
                        below = true;
                    } else if (below && input > heatingSetpoint) {
                        below = false;
                    }
                    above = false;
                } else {
                    const coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                    const delta = node.runtime.diff / 2;
                    const hiValue = coolingSetpoint + delta;

                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < coolingSetpoint) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.runtime.algorithm === "specified") {
                if (node.runtime.isHeating) {
                    const heatingOn = parseFloat(node.runtime.heatingOn);
                    const heatingOff = parseFloat(node.runtime.heatingOff);
                    if (input < heatingOn) {
                        below = true;
                    } else if (below && input > heatingOff) {
                        below = false;
                    }
                    above = false;
                } else {
                    const coolingOn = parseFloat(node.runtime.coolingOn);
                    const coolingOff = parseFloat(node.runtime.coolingOff);
                    if (input > coolingOn) {
                        above = true;
                    } else if (above && input < coolingOff) {
                        above = false;
                    }
                    below = false;
                }
            }

            // Send outputs
            const outputs = [
                { payload: node.runtime.isHeating, context: "isHeating" },
                { payload: above },
                { payload: below }
            ];
            send(outputs);

            // Update status
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

    // Serve runtime state for editor
    RED.httpAdmin.get("/tstat-block-runtime/:id", RED.auth.needsPermission("tstat-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "tstat-block") {
            const runtime = {
                name: node.runtime.name,
                algorithm: node.runtime.algorithm,
                diff: node.runtime.diff,
                isHeating: node.runtime.isHeating
            };
            if (node.runtime.algorithm === "single") {
                runtime.setpoint = parseFloat(node.runtime.setpoint);
                runtime.setpointType = node.runtime.setpointType;
            } else if (node.runtime.algorithm === "split") {
                runtime.heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                runtime.heatingSetpointType = node.runtime.heatingSetpointType;
                runtime.coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                runtime.coolingSetpointType = node.runtime.coolingSetpointType;
            } else {
                runtime.coolingOn = parseFloat(node.runtime.coolingOn);
                runtime.coolingOnType = node.runtime.coolingOnType;
                runtime.coolingOff = parseFloat(node.runtime.coolingOff);
                runtime.coolingOffType = node.runtime.coolingOffType;
                runtime.heatingOff = parseFloat(node.runtime.heatingOff);
                runtime.heatingOffType = node.runtime.heatingOffType;
                runtime.heatingOn = parseFloat(node.runtime.heatingOn);
                runtime.heatingOnType = node.runtime.heatingOnType;
            }
            res.json(runtime);
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};