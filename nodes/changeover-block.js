module.exports = function(RED) {
    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        const utils = require("./utils");
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "changeover",
            algorithm: config.algorithm || "single",
            setpoint: config.setpoint || "70",
            setpointType: config.setpointType || "num",
            deadband: parseFloat(config.deadband) || 2,
            heatingSetpoint: config.heatingSetpoint || "68",
            heatingSetpointType: config.heatingSetpointType || "num",
            coolingSetpoint: config.coolingSetpoint || "74",
            coolingSetpointType: config.coolingSetpointType || "num",
            anticipator: parseFloat(config.anticipator) || 0.5,
            swapTime: config.swapTime || "300",
            swapTimeType: config.swapTimeType || "num",
            minTempSetpoint: parseFloat(config.minTempSetpoint) || 55,
            maxTempSetpoint: parseFloat(config.maxTempSetpoint) || 90,
            minCycleTime: parseFloat(config.minCycleTime) || 60,
            enable: config.enable !== false,
            operationMode: config.operationMode || "auto"
        };

        // Validate non-typedInput fields at startup
        if (node.runtime.deadband <= 0) {
            node.runtime.deadband = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid deadband, using 2" });
        }
        if (node.runtime.anticipator < 0) {
            node.runtime.anticipator = 0.5;
            node.status({ fill: "red", shape: "ring", text: "invalid anticipator, using 0.5" });
        }
        if (node.runtime.minTempSetpoint >= node.runtime.maxTempSetpoint) {
            node.runtime.minTempSetpoint = 55;
            node.runtime.maxTempSetpoint = 90;
            node.status({ fill: "red", shape: "ring", text: "invalid setpoint range, using 55-90" });
        }
        if (node.runtime.minCycleTime < 0) {
            node.runtime.minCycleTime = 60;
            node.status({ fill: "red", shape: "ring", text: "invalid minCycleTime, using 60" });
        }

        // Initialize state
        let currentMode = node.runtime.operationMode === "cool" ? "cooling" : "heating";
        let isHeating = node.runtime.operationMode === "cool" ? false : true;
        let lastModeChange = 0;
        let lastCycleStart = 0;
        let temperature = null;
        let lastMode = currentMode;

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
                    { min: node.runtime.minTempSetpoint, max: node.runtime.maxTempSetpoint, name: "setpoint" }, 70
                ).toString();
                node.runtime.setpointType = "num";
            } else {
                node.runtime.heatingSetpoint = utils.getTypedValue(
                    node, node.runtime.heatingSetpointType, node.runtime.heatingSetpoint, msg,
                    { min: node.runtime.minTempSetpoint, max: node.runtime.maxTempSetpoint, name: "heatingSetpoint" }, 68
                ).toString();
                node.runtime.heatingSetpointType = "num";
                node.runtime.coolingSetpoint = utils.getTypedValue(
                    node, node.runtime.coolingSetpointType, node.runtime.coolingSetpoint, msg,
                    { min: node.runtime.minTempSetpoint, max: node.runtime.maxTempSetpoint, name: "coolingSetpoint" }, 74
                ).toString();
                node.runtime.coolingSetpointType = "num";
                if (parseFloat(node.runtime.coolingSetpoint) < parseFloat(node.runtime.heatingSetpoint)) {
                    node.runtime.coolingSetpoint = node.runtime.heatingSetpoint;
                }
            }

            node.runtime.swapTime = utils.getTypedValue(
                node, node.runtime.swapTimeType, node.runtime.swapTime, msg,
                { min: 0, name: "swapTime" }, 300
            ).toString();
            node.runtime.swapTimeType = "num";

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (msg.context === "status") {
                    const statusPayload = {
                        algorithm: node.runtime.algorithm,
                        swapTime: parseFloat(node.runtime.swapTime),
                        swapTimeType: node.runtime.swapTimeType,
                        anticipator: node.runtime.anticipator,
                        minTempSetpoint: node.runtime.minTempSetpoint,
                        maxTempSetpoint: node.runtime.maxTempSetpoint,
                        minCycleTime: node.runtime.minCycleTime,
                        enable: node.runtime.enable,
                        operationMode: node.runtime.operationMode
                    };
                    if (node.runtime.algorithm === "single") {
                        statusPayload.setpoint = parseFloat(node.runtime.setpoint);
                        statusPayload.setpointType = node.runtime.setpointType;
                        statusPayload.deadband = node.runtime.deadband;
                    } else {
                        statusPayload.heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                        statusPayload.heatingSetpointType = node.runtime.heatingSetpointType;
                        statusPayload.coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                        statusPayload.coolingSetpointType = node.runtime.coolingSetpointType;
                    }
                    send([null, { payload: statusPayload }]);
                    node.status({ fill: "blue", shape: "dot", text: "status requested" });
                    if (done) done();
                    return;
                }

                if (msg.context === "enable") {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid enable" });
                        if (done) done();
                        return;
                    }
                    node.runtime.enable = msg.payload;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `enable: ${msg.payload}`
                    });
                    send(evaluateState() || buildOutputs());
                    if (done) done();
                    return;
                }

                if (msg.context === "operationMode") {
                    if (["auto", "heat", "cool"].includes(msg.payload)) {
                        node.runtime.operationMode = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `operationMode: ${msg.payload}`
                        });
                        send(evaluateState() || buildOutputs());
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid operationMode" });
                    }
                    if (done) done();
                    return;
                }

                if (msg.context === "algorithm") {
                    if (["single", "split"].includes(msg.payload)) {
                        node.runtime.algorithm = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `algorithm: ${msg.payload}`
                        });
                        send(evaluateState() || buildOutputs());
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid algorithm" });
                    }
                    if (done) done();
                    return;
                }

                const value = parseFloat(msg.payload);
                if (isNaN(value)) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "setpoint":
                        if (node.runtime.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "setpoint not used in split algorithm" });
                            if (done) done();
                            return;
                        }
                        if (value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint) {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.setpoint = value.toString();
                        node.runtime.setpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `setpoint: ${value.toFixed(1)}` });
                        break;
                    case "deadband":
                        if (node.runtime.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "deadband not used in split algorithm" });
                            if (done) done();
                            return;
                        }
                        if (value <= 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid deadband" });
                            if (done) done();
                            return;
                        }
                        node.runtime.deadband = value;
                        node.status({ fill: "green", shape: "dot", text: `deadband: ${value.toFixed(1)}` });
                        break;
                    case "heatingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "heatingSetpoint not used in single algorithm" });
                            if (done) done();
                            return;
                        }
                        if (value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value > parseFloat(node.runtime.coolingSetpoint)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.heatingSetpoint = value.toString();
                        node.runtime.heatingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `heatingSetpoint: ${value.toFixed(1)}` });
                        break;
                    case "coolingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "coolingSetpoint not used in single algorithm" });
                            if (done) done();
                            return;
                        }
                        if (value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value < parseFloat(node.runtime.heatingSetpoint)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.coolingSetpoint = value.toString();
                        node.runtime.coolingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `coolingSetpoint: ${value.toFixed(1)}` });
                        break;
                    case "anticipator":
                        if (value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid anticipator" });
                            if (done) done();
                            return;
                        }
                        node.runtime.anticipator = value;
                        node.status({ fill: "green", shape: "dot", text: `anticipator: ${value.toFixed(1)}` });
                        break;
                    case "swapTime":
                        if (value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid swapTime" });
                            if (done) done();
                            return;
                        }
                        node.runtime.swapTime = value.toString();
                        node.runtime.swapTimeType = "num";
                        node.status({ fill: "green", shape: "dot", text: `swapTime: ${value.toFixed(0)}` });
                        break;
                    case "minTempSetpoint":
                        if (value >= node.runtime.maxTempSetpoint ||
                            (node.runtime.algorithm === "single" && value > parseFloat(node.runtime.setpoint)) ||
                            (node.runtime.algorithm === "split" && (value > parseFloat(node.runtime.heatingSetpoint) || value > parseFloat(node.runtime.coolingSetpoint)))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid minTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.minTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `minTempSetpoint: ${value.toFixed(1)}` });
                        break;
                    case "maxTempSetpoint":
                        if (value <= node.runtime.minTempSetpoint ||
                            (node.runtime.algorithm === "single" && value < parseFloat(node.runtime.setpoint)) ||
                            (node.runtime.algorithm === "split" && (value < parseFloat(node.runtime.heatingSetpoint) || value < parseFloat(node.runtime.coolingSetpoint)))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid maxTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.maxTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `maxTempSetpoint: ${value.toFixed(1)}` });
                        break;
                    case "minCycleTime":
                        if (value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid minCycleTime" });
                            if (done) done();
                            return;
                        }
                        node.runtime.minCycleTime = value;
                        node.status({ fill: "green", shape: "dot", text: `minCycleTime: ${value.toFixed(0)}` });
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }
                send(evaluateState() || buildOutputs());
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing temperature" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid temperature" });
                if (done) done();
                return;
            }

            temperature = input;
            send(evaluateState() || buildOutputs());
            updateStatus();
            if (done) done();

            function evaluateState() {
                if (!node.runtime.enable) {
                    if (isHeating !== null) {
                        isHeating = null;
                        updateStatus();
                        return buildOutputs();
                    }
                    updateStatus();
                    return null;
                }

                let newMode = currentMode;
                let newIsHeating = isHeating;

                if (node.runtime.operationMode === "heat") {
                    newMode = "heating";
                    newIsHeating = true;
                } else if (node.runtime.operationMode === "cool") {
                    newMode = "cooling";
                    newIsHeating = false;
                } else { // auto
                    let now = Date.now() / 1000;
                    let canSwitchMode = now - lastModeChange >= parseFloat(node.runtime.swapTime);

                    let heatingThreshold, coolingThreshold;

                    if (node.runtime.algorithm === "single") {
                        heatingThreshold = parseFloat(node.runtime.setpoint) - node.runtime.deadband / 2 - node.runtime.anticipator;
                        coolingThreshold = parseFloat(node.runtime.setpoint) + node.runtime.deadband / 2 + node.runtime.anticipator;
                    } else {
                        heatingThreshold = parseFloat(node.runtime.heatingSetpoint) - node.runtime.anticipator;
                        coolingThreshold = parseFloat(node.runtime.coolingSetpoint) + node.runtime.anticipator;
                    }

                    if (temperature < heatingThreshold && canSwitchMode) {
                        newMode = "heating";
                        newIsHeating = true;
                    } else if (temperature > coolingThreshold && canSwitchMode) {
                        newMode = "cooling";
                        newIsHeating = false;
                    }
                }

                if (newMode !== currentMode) {
                    let now = Date.now() / 1000;
                    lastModeChange = now;
                    lastCycleStart = now;
                    currentMode = newMode;
                    isHeating = newIsHeating;
                    updateStatus();
                    return buildOutputs();
                }

                updateStatus();
                return null;
            }

            function buildOutputs() {
                let heatingSetpoint, coolingSetpoint;
                if (node.runtime.algorithm === "single") {
                    heatingSetpoint = parseFloat(node.runtime.setpoint) - node.runtime.deadband / 2;
                    coolingSetpoint = parseFloat(node.runtime.setpoint) + node.runtime.deadband / 2;
                } else {
                    heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                    coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
                }

                return [
                    { payload: node.runtime.enable ? isHeating : null },
                    {
                        payload: {
                            mode: node.runtime.enable ? currentMode : "disabled",
                            isHeating,
                            heatingSetpoint,
                            coolingSetpoint,
                            temperature,
                            enabled: node.runtime.enable,
                            operationMode: node.runtime.operationMode,
                            algorithm: node.runtime.algorithm,
                            ...(node.runtime.algorithm === "single" ? {
                                setpoint: parseFloat(node.runtime.setpoint),
                                deadband: node.runtime.deadband
                            } : {})
                        }
                    }
                ];
            }

            function updateStatus() {
                if (!node.runtime.enable) {
                    node.status({ fill: "red", shape: "ring", text: "disabled" });
                } else if (currentMode === lastMode) {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `in: ${temperature !== null ? temperature.toFixed(2) : "unknown"}, out: ${currentMode}`
                    });
                } else {
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `in: ${temperature !== null ? temperature.toFixed(2) : "unknown"}, out: ${currentMode}`
                    });
                }
                lastMode = currentMode;
            }
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("changeover-block", ChangeoverBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/changeover-block-runtime/:id", RED.auth.needsPermission("changeover-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "changeover-block") {
            const runtime = {
                name: node.runtime.name,
                algorithm: node.runtime.algorithm,
                anticipator: node.runtime.anticipator,
                swapTime: parseFloat(node.runtime.swapTime),
                swapTimeType: node.runtime.swapTimeType,
                minTempSetpoint: node.runtime.minTempSetpoint,
                maxTempSetpoint: node.runtime.maxTempSetpoint,
                minCycleTime: node.runtime.minCycleTime,
                enable: node.runtime.enable,
                operationMode: node.runtime.operationMode
            };
            if (node.runtime.algorithm === "single") {
                runtime.setpoint = parseFloat(node.runtime.setpoint);
                runtime.setpointType = node.runtime.setpointType;
                runtime.deadband = node.runtime.deadband;
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