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
            diff: parseFloat(config.diff) || 2,
            isHeating: config.isHeating === true
        };

        // Validate non-typedInput fields at startup
        if (node.runtime.diff <= 0) {
            node.runtime.diff = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid diff, using 2" });
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
            } else {
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
                    } else {
                        statusPayload.heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                        statusPayload.heatingSetpointType = node.runtime.heatingSetpointType;
                        statusPayload.coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                        statusPayload.coolingSetpointType = node.runtime.coolingSetpointType;
                    }
                    send([null, null, { payload: statusPayload }]);
                    node.status({ fill: "blue", shape: "dot", text: "status requested" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "algorithm":
                        if (["single", "split"].includes(msg.payload)) {
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
                            node.status({ fill: "red", shape: "ring", text: "setpoint not used in split algorithm" });
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
                            node.status({ fill: "red", shape: "ring", text: "heatingSetpoint not used in single algorithm" });
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
                            node.status({ fill: "red", shape: "ring", text: "coolingSetpoint not used in single algorithm" });
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
            } else {
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
            }

            // Send outputs
            const outputs = [
                { payload: node.runtime.isHeating },
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
            } else {
                runtime.heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                runtime.heatingSetpointType = node.runtime.heatingSetpointType;
                runtime.coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                runtime.coolingSetpointType = node.runtime.coolingSetpointType;
            }
            res.json(runtime);
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};