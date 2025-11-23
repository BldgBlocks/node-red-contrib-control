//const { parse } = require('echarts/types/src/export/api/time.js');

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            algorithm: config.algorithm,
            operationMode: config.operationMode,
            initWindow: parseFloat(config.initWindow),
            currentMode: (config.operationMode === "cool" ? "cooling" : "heating"),
            lastTemperature: null,
            lastModeChange: 0
        };

        // Evaluate typed-input properties    
        try {     
            node.runtime.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node ));
            node.runtime.heatingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.heatingSetpoint, config.heatingSetpointType, node ));
            node.runtime.coolingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.coolingSetpoint, config.coolingSetpointType, node ));
            node.runtime.swapTime = parseFloat(RED.util.evaluateNodeProperty( config.swapTime, config.swapTimeType, node ));
            node.runtime.deadband = parseFloat(RED.util.evaluateNodeProperty( config.deadband, config.deadbandType, node ));
            node.runtime.extent = parseFloat(RED.util.evaluateNodeProperty( config.extent, config.extentType, node ));
            node.runtime.minTempSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.minTempSetpoint, config.minTempSetpointType, node ));
            node.runtime.maxTempSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.maxTempSetpoint, config.maxTempSetpointType, node ));            
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
            if (done) done();
            return;
        }

        // Initialize state
        let initComplete = false;
        let conditionStartTime = null;
        let pendingMode = null;
        const initStartTime = Date.now() / 1000;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }     

            // Update typed-input properties if needed
            try {    
                if (utils.requiresEvaluation(config.setpointType)) {
                    node.runtime.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node, msg ));
                }
                if (utils.requiresEvaluation(config.heatingSetpointType)) {
                    node.runtime.heatingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.heatingSetpoint, config.heatingSetpointType, node, msg ));
                }
                if (utils.requiresEvaluation(config.coolingSetpointType)) {
                    node.runtime.coolingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.coolingSetpoint, config.coolingSetpointType, node, msg ));
                }
                if (utils.requiresEvaluation(config.swapTimeType)) {
                    node.runtime.swapTime = parseFloat(RED.util.evaluateNodeProperty( config.swapTime, config.swapTimeType, node, msg ));
                }
                if (utils.requiresEvaluation(config.deadbandType)) {
                    node.runtime.deadband = parseFloat(RED.util.evaluateNodeProperty( config.deadband, config.deadbandType, node, msg ));
                }
                if (utils.requiresEvaluation(config.extentType)) {
                    node.runtime.extent = parseFloat(RED.util.evaluateNodeProperty( config.extent, config.extentType, node, msg ));
                }
                if (utils.requiresEvaluation(config.minTempSetpointType)) {
                    node.runtime.minTempSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.minTempSetpoint, config.minTempSetpointType, node, msg ));
                }
                if (utils.requiresEvaluation(config.maxTempSetpointType)) {
                    node.runtime.maxTempSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.maxTempSetpoint, config.maxTempSetpointType, node, msg )); 
                }             
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            }

            // Validate
            if (node.runtime.coolingSetpoint < node.runtime.heatingSetpoint 
                || node.runtime.maxTempSetpoint < node.runtime.minTempSetpoint 
                || node.runtime.deadband <= 0 || node.runtime.extent < 0) {
                node.status({ fill: "red", shape: "ring", text: "error validating properties, check setpoints" });
                if (done) done(err);
                return;
            }
            
            if (node.runtime.swapTime < 60) {
                node.runtime.swapTime = 60;
                node.status({ fill: "red", shape: "ring", text: "swapTime below 60s, using 60" });
            }

            if (node.runtime.coolingSetpoint < node.runtime.heatingSetpoint) {
                node.runtime.coolingSetpoint = node.runtime.heatingSetpoint + 4;
                node.status({ fill: "red", shape: "ring", text: "invalid setpoints, using fallback" });
            }

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
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint) {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.setpoint = value.toString();
                        node.runtime.setpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: setpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "deadband":
                        if (isNaN(value) || value <= 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid deadband" });
                            if (done) done();
                            return;
                        }
                        node.runtime.deadband = value;
                        node.status({ fill: "green", shape: "dot", text: `in: deadband=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "heatingSetpoint":
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value > node.runtime.coolingSetpoint) {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.heatingSetpoint = value.toString();
                        node.runtime.heatingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: heatingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "coolingSetpoint":
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value < node.runtime.heatingSetpoint) {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.coolingSetpoint = value.toString();
                        node.runtime.coolingSetpointType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: coolingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "extent":
                        if (isNaN(value) || value < 0) {
                            node.status({ fill: "red", shape: "ring", text: "invalid extent" });
                            if (done) done();
                            return;
                        }
                        node.runtime.extent = value;
                        node.status({ fill: "green", shape: "dot", text: `in: extent=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "swapTime":
                        if (isNaN(value) || value < 60) {
                            node.status({ fill: "red", shape: "ring", text: "invalid swapTime, minimum 60s" });
                            if (done) done();
                            return;
                        }
                        node.runtime.swapTime = value.toString();
                        node.runtime.swapTimeType = "num";
                        node.status({ fill: "green", shape: "dot", text: `in: swapTime=${value.toFixed(0)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "minTempSetpoint":
                        if (isNaN(value) || value >= node.runtime.maxTempSetpoint ||
                            (node.runtime.algorithm === "single" && value > node.runtime.setpoint) ||
                            (node.runtime.algorithm === "split" && (value > node.runtime.heatingSetpoint || value > node.runtime.coolingSetpoint))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid minTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.minTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `in: minTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
                        break;
                    case "maxTempSetpoint":
                        if (isNaN(value) || value <= node.runtime.minTempSetpoint ||
                            (node.runtime.algorithm === "single" && value < node.runtime.setpoint) ||
                            (node.runtime.algorithm === "split" && (value < node.runtime.heatingSetpoint || value < node.runtime.coolingSetpoint))) {
                            node.status({ fill: "red", shape: "ring", text: "invalid maxTempSetpoint" });
                            if (done) done();
                            return;
                        }
                        node.runtime.maxTempSetpoint = value;
                        node.status({ fill: "green", shape: "dot", text: `in: maxTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}` });
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

                send(evaluateState() || buildOutputs());
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing temperature payload property" });
                if (done) done();
                return;
            }

            let input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid temperature payload" });
                if (done) done();
                return;
            }
            
            if (node.runtime.lastTemperature !== input) {
                node.runtime.lastTemperature = input;
            }

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
                    heatingThreshold = node.runtime.setpoint - node.runtime.deadband / 2;
                    coolingThreshold = node.runtime.setpoint + node.runtime.deadband / 2;
                } else {
                    heatingThreshold = node.runtime.heatingSetpoint - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingSetpoint + node.runtime.extent;
                }

                if (temp < heatingThreshold) {
                    newMode = "heating";
                } else if (temp > coolingThreshold) {
                    newMode = "cooling";
                }
            }

            node.runtime.currentMode = newMode;
            node.runtime.lastModeChange = Date.now() / 1000;
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
                    heatingThreshold = node.runtime.setpoint - node.runtime.deadband / 2;
                    coolingThreshold = node.runtime.setpoint + node.runtime.deadband / 2;
                } else {
                    heatingThreshold = node.runtime.heatingSetpoint - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingSetpoint + node.runtime.extent;
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
                    } else if (conditionStartTime && now - conditionStartTime >= node.runtime.swapTime) {
                        newMode = desiredMode;
                        conditionStartTime = null;
                        pendingMode = null;
                    }
                } else {
                    conditionStartTime = null;
                    pendingMode = null;
                }
            }

            if (newMode !== node.runtime.currentMode) {
                node.runtime.currentMode = newMode;
                node.runtime.lastModeChange = now;
            }

            return null;
        }

        function buildOutputs() {
            const isHeating = node.runtime.currentMode === "heating";
            let effectiveHeatingSetpoint, effectiveCoolingSetpoint;
            if (node.runtime.algorithm === "single") {
                effectiveHeatingSetpoint = node.runtime.setpoint - node.runtime.deadband / 2;
                effectiveCoolingSetpoint = node.runtime.setpoint + node.runtime.deadband / 2;
            } else {
                effectiveHeatingSetpoint = node.runtime.heatingSetpoint;
                effectiveCoolingSetpoint = node.runtime.coolingSetpoint;
            }

            return [
                { 
                    payload: isHeating,
                    context: "isHeating", 
                    status: {
                        mode: node.runtime.currentMode,
                        isHeating,
                        heatingSetpoint: effectiveHeatingSetpoint,
                        coolingSetpoint: effectiveCoolingSetpoint,
                        temperature: node.runtime.lastTemperature
                    }
                },
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
                    const remaining = Math.max(0, node.runtime.swapTime - (now - conditionStartTime));
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
            done();
        });
    }

    RED.nodes.registerType("changeover-block", ChangeoverBlockNode);
};