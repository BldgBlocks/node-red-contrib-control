module.exports = function(RED) {
    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const utils = require("./utils");

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
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
            operationMode: config.operationMode || "auto",
            initWindow: parseFloat(config.initWindow) || 10
        };

        // Initialize persistent state
        const context = node.context();
        node.runtime.currentMode = context.get("currentMode") || (node.runtime.operationMode === "cool" ? "cooling" : "heating");
        node.runtime.lastTemperature = context.get("lastTemperature") || null;
        node.runtime.lastModeChange = context.get("lastModeChange") || 0;

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
        if (node.runtime.initWindow < 0) {
            node.runtime.initWindow = 10;
            node.status({ fill: "red", shape: "ring", text: "invalid initWindow, using 10" });
        }

        // Initialize state
        let initComplete = false;
        let conditionStartTime = null;
        let pendingMode = null;
        const initStartTime = Date.now() / 1000;

        // Set initial mode based on cached temperature
        if (node.runtime.lastTemperature !== null && node.runtime.initWindow > 0) {
            evaluateInitialMode();
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Resolve typed inputs
            let minTemp = 55;
            let maxTemp = 90;

            if (node.runtime.algorithm === "single") {
                node.runtime.setpoint = utils.getTypedValue(
                    node, node.runtime.setpointType, node.runtime.setpoint, msg,
                    { min: minTemp, max: maxTemp, name: "setpoint" }, 70
                ).toString();
                node.runtime.setpointType = "num";
            } else {
                node.runtime.heatingSetpoint = utils.getTypedValue(
                    node, node.runtime.heatingSetpointType, node.runtime.heatingSetpoint, msg,
                    { min: minTemp, max: maxTemp, name: "heatingSetpoint" }, 68
                ).toString();
                node.runtime.heatingSetpointType = "num";
                node.runtime.coolingSetpoint = utils.getTypedValue(
                    node, node.runtime.coolingSetpointType, node.runtime.coolingSetpoint, msg,
                    { min: minTemp, max: maxTemp, name: "coolingSetpoint" }, 74
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
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
                    if (done) done();
                    return;
                }

                const value = parseFloat(msg.payload);
                switch (msg.context) {
                    case "operationMode":
                        if (!["auto", "heat", "cool"].includes(msg.payload)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid operationMode" });
                            if (done) done();
                            return;
                        }
                        node.runtime.operationMode = msg.payload;
                        node.status({ fill: "green", shape: "dot", text: `in: operationMode=${msg.payload}, out: ${node.runtime.currentMode}` });
                        break;
                    case "algorithm":
                        if (!["single", "split"].includes(msg.payload)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid algorithm" });
                            if (done) done();
                            return;
                        }
                        node.runtime.algorithm = msg.payload;
                        node.status({ fill: "green", shape: "dot", text: `in: algorithm=${msg.payload}, out: ${node.runtime.currentMode}` });
                        break;
                    case "setpoint":
                        if (node.runtime.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "setpoint not used in split algorithm" });
                            if (done) done();
                            return;
                        }
                        if (isNaN(value) || value < minTemp || value > maxTemp) {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.setpoint = value.toString();
                        node.runtime.setpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: setpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "deadband":
                        if (node.runtime.algorithm !== "single") {
                            node.status({ fill: "red", shape: "ring", text: "deadband not used in split algorithm" });
                            if (done) done();
                            return;
                        }
                        if (isNaN(value) || value <= 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid deadband" });
                            if (done) done();
                            return;
                        }
                        node.runtime.deadband = value;
                        node.status({ fill: "green", shape: "dot", text: `in: deadband=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "heatingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "heatingSetpoint not used in single algorithm" });
                            if (done) done();
                            return;
                        }
                        if (isNaN(value) || value < minTemp || value > maxTemp || value > parseFloat(node.runtime.coolingSetpoint)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.heatingSetpoint = value.toString();
                        node.runtime.heatingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: heatingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "coolingSetpoint":
                        if (node.runtime.algorithm !== "split") {
                            node.status({ fill: "red", shape: "ring", text: "coolingSetpoint not used in single algorithm" });
                            if (done) done();
                            return;
                        }
                        if (isNaN(value) || value < minTemp || value > maxTemp || value < parseFloat(node.runtime.heatingSetpoint)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.coolingSetpoint = value.toString();
                        node.runtime.coolingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: coolingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "anticipator":
                        if (isNaN(value) || value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid anticipator" });
                            if (done) done();
                            return;
                        }
                        node.runtime.anticipator = value;
                        node.status({ fill: "green", shape: "dot", text: `in: anticipator=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "swapTime":
                        if (isNaN(value) || value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid swapTime" });
                            if (done) done();
                            return;
                        }
                        node.runtime.swapTime = value.toString();
                        node.runtime.swapTimeType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: swapTime=${value.toFixed(0)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "minTempSetpoint":
                        if (isNaN(value) || value >= node.runtime.maxTempSetpoint ||
                            (node.runtime.algorithm === "single" && value > parseFloat(node.runtime.setpoint)) ||
                            (node.runtime.algorithm === "split" && (value > parseFloat(node.runtime.heatingSetpoint) || value > parseFloat(node.runtime.coolingSetpoint)))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid minTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.minTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `in: minTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "maxTempSetpoint":
                        if (isNaN(value) || value <= node.runtime.minTempSetpoint ||
                            (node.runtime.algorithm === "single" && value < parseFloat(node.runtime.setpoint)) ||
                            (node.runtime.algorithm === "split" && (value < parseFloat(node.runtime.heatingSetpoint) || value < parseFloat(node.runtime.coolingSetpoint)))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid maxTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.maxTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `in: maxTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "minCycleTime":
                        if (isNaN(value) || value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid minCycleTime" });
                            if (done) done();
                            return;
                        }
                        node.runtime.minCycleTime = value;
                        node.status({ fill: "green", shape: "dot", text: `in: minCycleTime=${value.toFixed(0)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "initWindow":
                        if (isNaN(value) || value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid initWindow" });
                            if (done) done();
                            return;
                        }
                        node.runtime.initWindow = value;
                        node.status({ fill: "green", shape: "dot", text: `in: initWindow=${value.toFixed(0)}, out: ${node.runtime.currentMode}` });
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }
                conditionStartTime = null;
                pendingMode = null;
                context.set("currentMode", node.runtime.currentMode);
                send(evaluateState() || buildOutputs());
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing temperature" });
                if (done) done();
                return;
            }

            let input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid temperature" });
                if (done) done();
                return;
            }

            node.runtime.lastTemperature = input;
            context.set("lastTemperature", node.runtime.lastTemperature);

            const now = Date.now() / 1000;
            if (!initComplete && now - initStartTime >= node.runtime.initWindow) {
                initComplete = true;
                evaluateInitialMode();
            }

            if (!initComplete) {
                updateStatus();
                if (done) done();
                return;
            }

            send(evaluateState() || buildOutputs());
            updateStatus();
            if (done) done();
        });

        function evaluateInitialMode() {
            if (node.runtime.lastTemperature === null) return;
            const temp = node.runtime.lastTemperature;
            let newMode = node.runtime.currentMode;

            if (node.runtime.operationMode === "heat") {
                newMode = "heating";
            } else if (node.runtime.operationMode === "cool") {
                newMode = "cooling";
            } else {
                let heatingThreshold, coolingThreshold;
                if (node.runtime.algorithm === "single") {
                    heatingThreshold = parseFloat(node.runtime.setpoint) - node.runtime.deadband / 2 - node.runtime.anticipator;
                    coolingThreshold = parseFloat(node.runtime.setpoint) + node.runtime.deadband / 2 + node.runtime.anticipator;
                } else {
                    heatingThreshold = parseFloat(node.runtime.heatingSetpoint) - node.runtime.anticipator;
                    coolingThreshold = parseFloat(node.runtime.coolingSetpoint) + node.runtime.anticipator;
                }

                if (temp < heatingThreshold) {
                    newMode = "heating";
                } else if (temp > coolingThreshold) {
                    newMode = "cooling";
                }
            }

            node.runtime.currentMode = newMode;
            node.runtime.lastModeChange = Date.now() / 1000;
            context.set("currentMode", node.runtime.currentMode);
            context.set("lastModeChange", node.runtime.lastModeChange);
        }

        function evaluateState() {
            const now = Date.now() / 1000;
            if (!initComplete) return null;

            let newMode = node.runtime.currentMode;
            if (node.runtime.operationMode === "heat") {
                newMode = "heating";
                conditionStartTime = null;
                pendingMode = null;
            } else if (node.runtime.operationMode === "cool") {
                newMode = "cooling";
                conditionStartTime = null;
                pendingMode = null;
            } else if (node.runtime.lastTemperature !== null) {
                let heatingThreshold, coolingThreshold;
                if (node.runtime.algorithm === "single") {
                    heatingThreshold = parseFloat(node.runtime.setpoint) - node.runtime.deadband / 2 - node.runtime.anticipator;
                    coolingThreshold = parseFloat(node.runtime.setpoint) + node.runtime.deadband / 2 + node.runtime.anticipator;
                } else {
                    heatingThreshold = parseFloat(node.runtime.heatingSetpoint) - node.runtime.anticipator;
                    coolingThreshold = parseFloat(node.runtime.coolingSetpoint) + node.runtime.anticipator;
                }

                let desiredMode = node.runtime.currentMode;
                if (node.runtime.lastTemperature < heatingThreshold) {
                    desiredMode = "heating";
                } else if (node.runtime.lastTemperature > coolingThreshold) {
                    desiredMode = "cooling";
                }

                if (desiredMode !== node.runtime.currentMode) {
                    if (pendingMode !== desiredMode) {
                        conditionStartTime = now;
                        pendingMode = desiredMode;
                    } else if (conditionStartTime && now - conditionStartTime >= parseFloat(node.runtime.swapTime)) {
                        newMode = desiredMode;
                        conditionStartTime = null;
                        pendingMode = null;
                    }
                } else {
                    conditionStartTime = null;
                    pendingMode = null;
                }
            }

            if (newMode !== node.runtime.currentMode && (now - node.runtime.lastModeChange >= node.runtime.minCycleTime)) {
                node.runtime.currentMode = newMode;
                node.runtime.lastModeChange = now;
                context.set("currentMode", node.runtime.currentMode);
                context.set("lastModeChange", node.runtime.lastModeChange);
                return buildOutputs();
            }

            return null;
        }

        function buildOutputs() {
            const isHeating = node.runtime.currentMode === "heating";
            let heatingSetpoint, coolingSetpoint;
            if (node.runtime.algorithm === "single") {
                heatingSetpoint = parseFloat(node.runtime.setpoint) - node.runtime.deadband / 2;
                coolingSetpoint = parseFloat(node.runtime.setpoint) + node.runtime.deadband / 2;
            } else {
                heatingSetpoint = parseFloat(node.runtime.heatingSetpoint);
                coolingSetpoint = parseFloat(node.runtime.coolingSetpoint);
            }

            return [
                { payload: isHeating, context: "isHeating" },
                {
                    payload: {
                        mode: node.runtime.currentMode,
                        isHeating,
                        heatingSetpoint,
                        coolingSetpoint,
                        temperature: node.runtime.lastTemperature
                    }
                }
            ];
        }

        function updateStatus() {
            const now = Date.now() / 1000;
            const inInitWindow = !initComplete && now - initStartTime < node.runtime.initWindow;

            if (inInitWindow) {
                node.status({ fill: "yellow", shape: "ring", text: `initializing, out: ${node.runtime.currentMode}` });
            } else {
                let statusText = `in: temp=${node.runtime.lastTemperature !== null ? node.runtime.lastTemperature.toFixed(1) : "unknown"}, out: ${node.runtime.currentMode}`;
                if (pendingMode && conditionStartTime) {
                    const remaining = Math.max(0, parseFloat(node.runtime.swapTime) - (now - conditionStartTime));
                    statusText += `, pending: ${pendingMode} in ${remaining.toFixed(0)}s`;
                }
                node.status({
                    fill: "blue",
                    shape: now - node.runtime.lastModeChange < 1 ? "dot" : "ring",
                    text: statusText
                });
            }
        }

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("changeover-block", ChangeoverBlockNode);

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
                operationMode: node.runtime.operationMode,
                initWindow: node.runtime.initWindow,
                currentMode: node.runtime.currentMode,
                lastTemperature: node.runtime.lastTemperature
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