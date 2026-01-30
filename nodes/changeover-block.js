//const { parse } = require('echarts/types/src/export/api/time.js');

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.initWindow = parseFloat(config.initWindow);
        node.lastTemperature = null;
        node.lastModeChange = 0;
        node.setpoint = parseFloat(config.setpoint);
        node.heatingSetpoint = parseFloat(config.heatingSetpoint);
        node.coolingSetpoint = parseFloat(config.coolingSetpoint);
        node.swapTime = parseFloat(config.swapTime);
        node.deadband = parseFloat(config.deadband);
        node.extent = parseFloat(config.extent);
        node.minTempSetpoint = parseFloat(config.minTempSetpoint);
        node.maxTempSetpoint = parseFloat(config.maxTempSetpoint);
        node.algorithm = config.algorithm;
        node.operationMode = config.operationMode;
        node.currentMode = config.operationMode === "cool" ? "cooling" : "heating";

        // Initialize state
        let initComplete = false;
        let conditionStartTime = null;
        let pendingMode = null;
        const initStartTime = Date.now() / 1000;

        node.isBusy = false;

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }             

            // Evaluate dynamic properties
            try {
                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.setpointType) 
                        ? utils.evaluateNodeProperty(config.setpoint, config.setpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.setpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.heatingSetpointType) 
                        ? utils.evaluateNodeProperty(config.heatingSetpoint, config.heatingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.heatingSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.coolingSetpointType) 
                        ? utils.evaluateNodeProperty(config.coolingSetpoint, config.coolingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.coolingSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.swapTimeType) 
                        ? utils.evaluateNodeProperty(config.swapTime, config.swapTimeType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.swapTime),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.deadbandType) 
                        ? utils.evaluateNodeProperty(config.deadband, config.deadbandType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.deadband),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.extentType) 
                        ? utils.evaluateNodeProperty(config.extent, config.extentType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.extent),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.minTempSetpointType) 
                        ? utils.evaluateNodeProperty(config.minTempSetpoint, config.minTempSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.minTempSetpoint),
                );  

                evaluations.push(
                    utils.requiresEvaluation(config.maxTempSetpointType)
                        ? utils.evaluateNodeProperty(config.maxTempSetpoint, config.maxTempSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.maxTempSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.algorithmType)
                        ? utils.evaluateNodeProperty(config.algorithm, config.algorithmType, node, msg)
                        : Promise.resolve(node.algorithm),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.operationModeType)
                        ? utils.evaluateNodeProperty(config.operationMode, config.operationModeType, node, msg)
                        : Promise.resolve(node.operationMode),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values

                if (!isNaN(results[0])) node.setpoint = results[0];
                if (!isNaN(results[1])) node.heatingSetpoint = results[1];
                if (!isNaN(results[2])) node.coolingSetpoint = results[2];
                if (!isNaN(results[3])) node.swapTime = results[3];
                if (!isNaN(results[4])) node.deadband = results[4];
                if (!isNaN(results[5])) node.extent = results[5];
                if (!isNaN(results[6])) node.minTempSetpoint = results[6];
                if (!isNaN(results[7])) node.maxTempSetpoint = results[7];
                if (results[8]) node.algorithm = results[8];
                if (results[9]) node.operationMode = results[9];
                node.currentMode = node.operationMode === "cool" ? "cooling" : "heating";   
      
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Validate
            if (node.coolingSetpoint < node.heatingSetpoint 
                || node.maxTempSetpoint < node.minTempSetpoint 
                || node.deadband <= 0 || node.extent < 0) {
                utils.setStatusError(node, "error validating properties, check setpoints");
                if (done) done(err);
                return;
            }
            
            if (node.swapTime < 60) {
                node.swapTime = 60;
                utils.setStatusError(node, "swapTime below 60s, using 60");
            }

            if (node.coolingSetpoint < node.heatingSetpoint) {
                node.coolingSetpoint = node.heatingSetpoint + 4;
                utils.setStatusError(node, "invalid setpoints, using fallback");
            }

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }

                const value = parseFloat(msg.payload);
                switch (msg.context) {
                    case "operationMode":
                        if (!["auto", "heat", "cool"].includes(msg.payload)) {
                            utils.setStatusError(node, "invalid operationMode");
                            if (done) done();
                            return;
                        }
                        node.operationMode = msg.payload;
                        utils.setStatusOK(node, `in: operationMode=${msg.payload}, out: ${node.currentMode}`);
                        break;
                    case "algorithm":
                        if (!["single", "split"].includes(msg.payload)) {
                            utils.setStatusError(node, "invalid algorithm");
                            if (done) done();
                            return;
                        }
                        node.algorithm = msg.payload;
                        utils.setStatusOK(node, `in: algorithm=${msg.payload}, out: ${node.currentMode}`);
                        break;
                    case "setpoint":
                        if (isNaN(value) || value < node.minTempSetpoint || value > node.maxTempSetpoint) {
                            utils.setStatusError(node, "invalid setpoint");
                            if (done) done();
                            return;
                        }
                        node.setpoint = value.toString();
                        node.setpointType = "num";
                        utils.setStatusOK(node, `in: setpoint=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "deadband":
                        if (isNaN(value) || value <= 0) {
                            utils.setStatusError(node, "invalid deadband");
                            if (done) done();
                            return;
                        }
                        node.deadband = value;
                        utils.setStatusOK(node, `in: deadband=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "heatingSetpoint":
                        if (isNaN(value) || value < node.minTempSetpoint || value > node.maxTempSetpoint || value > node.coolingSetpoint) {
                            utils.setStatusError(node, "invalid heatingSetpoint");
                            if (done) done();
                            return;
                        }
                        node.heatingSetpoint = value.toString();
                        node.heatingSetpointType = "num";
                        utils.setStatusOK(node, `in: heatingSetpoint=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "coolingSetpoint":
                        if (isNaN(value) || value < node.minTempSetpoint || value > node.maxTempSetpoint || value < node.heatingSetpoint) {
                            utils.setStatusError(node, "invalid coolingSetpoint");
                            if (done) done();
                            return;
                        }
                        node.coolingSetpoint = value.toString();
                        node.coolingSetpointType = "num";
                        utils.setStatusOK(node, `in: coolingSetpoint=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "extent":
                        if (isNaN(value) || value < 0) {
                            utils.setStatusError(node, "invalid extent");
                            if (done) done();
                            return;
                        }
                        node.extent = value;
                        utils.setStatusOK(node, `in: extent=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "swapTime":
                        if (isNaN(value) || value < 60) {
                            utils.setStatusError(node, "invalid swapTime, minimum 60s");
                            if (done) done();
                            return;
                        }
                        node.swapTime = value.toString();
                        node.swapTimeType = "num";
                        utils.setStatusOK(node, `in: swapTime=${value.toFixed(0)}, out: ${node.currentMode}`);
                        break;
                    case "minTempSetpoint":
                        if (isNaN(value) || value >= node.maxTempSetpoint ||
                            (node.algorithm === "single" && value > node.setpoint) ||
                            (node.algorithm === "split" && (value > node.heatingSetpoint || value > node.coolingSetpoint))) {
                            utils.setStatusError(node, "invalid minTempSetpoint");
                            if (done) done();
                            return;
                        }
                        node.minTempSetpoint = value;
                        utils.setStatusOK(node, `in: minTempSetpoint=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "maxTempSetpoint":
                        if (isNaN(value) || value <= node.minTempSetpoint ||
                            (node.algorithm === "single" && value < node.setpoint) ||
                            (node.algorithm === "split" && (value < node.heatingSetpoint || value < node.coolingSetpoint))) {
                            utils.setStatusError(node, "invalid maxTempSetpoint");
                            if (done) done();
                            return;
                        }
                        node.maxTempSetpoint = value;
                        utils.setStatusOK(node, `in: maxTempSetpoint=${value.toFixed(1)}, out: ${node.currentMode}`);
                        break;
                    case "initWindow":
                        if (isNaN(value) || value < 0) {
                            utils.setStatusError(node, "invalid initWindow");
                            if (done) done();
                            return;
                        }
                        node.initWindow = value;
                        utils.setStatusOK(node, `in: initWindow=${value.toFixed(0)}, out: ${node.currentMode}`);
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
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
                utils.setStatusError(node, "missing temperature payload property");
                if (done) done();
                return;
            }

            let input;
            try {
                input = parseFloat(RED.util.getMessageProperty(msg, node.inputProperty));
            } catch (err) {
                input = NaN;
            }
            if (isNaN(input)) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }
            
            if (node.lastTemperature !== input) {
                node.lastTemperature = input;
            }

            const now = Date.now() / 1000;
            if (!initComplete && now - initStartTime >= node.initWindow) {
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
            if (node.lastTemperature === null) return;
            const temp = node.lastTemperature;
            let newMode = node.currentMode;

            if (node.operationMode === "heat") {
                newMode = "heating";
            } else if (node.operationMode === "cool") {
                newMode = "cooling";
            } else {
                let heatingThreshold, coolingThreshold;
                if (node.algorithm === "single") {
                    heatingThreshold = node.setpoint - node.deadband / 2;
                    coolingThreshold = node.setpoint + node.deadband / 2;
                } else if (node.algorithm === "split") {
                    heatingThreshold = node.heatingSetpoint - node.extent;
                    coolingThreshold = node.coolingSetpoint + node.extent;
                } else if (node.algorithm === "specified") {
                    heatingThreshold = node.heatingOn - node.extent;
                    coolingThreshold = node.coolingOn + node.extent;
                }

                if (temp < heatingThreshold) {
                    newMode = "heating";
                } else if (temp > coolingThreshold) {
                    newMode = "cooling";
                }
            }

            node.currentMode = newMode;
            node.lastModeChange = Date.now() / 1000;
        }

        function evaluateState() {
            const now = Date.now() / 1000;
            if (!initComplete) return null;

            let newMode = node.currentMode;
            if (node.operationMode === "heat") {
                newMode = "heating";
                conditionStartTime = null;
                pendingMode = null;
            } else if (node.operationMode === "cool") {
                newMode = "cooling";
                conditionStartTime = null;
                pendingMode = null;
            } else if (node.lastTemperature !== null) {
                let heatingThreshold, coolingThreshold;
                if (node.algorithm === "single") {
                    heatingThreshold = node.setpoint - node.deadband / 2;
                    coolingThreshold = node.setpoint + node.deadband / 2;
                } else if (node.algorithm === "split") {
                    heatingThreshold = node.heatingSetpoint - node.extent;
                    coolingThreshold = node.coolingSetpoint + node.extent;
                } else if (node.algorithm === "specified") {
                    heatingThreshold = node.heatingOn - node.extent;
                    coolingThreshold = node.coolingOn + node.extent;
                }

                let desiredMode = node.currentMode;
                if (node.lastTemperature < heatingThreshold) {
                    desiredMode = "heating";
                } else if (node.lastTemperature > coolingThreshold) {
                    desiredMode = "cooling";
                }

                if (desiredMode !== node.currentMode) {
                    if (pendingMode !== desiredMode) {
                        conditionStartTime = now;
                        pendingMode = desiredMode;
                    } else if (conditionStartTime && now - conditionStartTime >= node.swapTime) {
                        newMode = desiredMode;
                        conditionStartTime = null;
                        pendingMode = null;
                    }
                } else {
                    conditionStartTime = null;
                    pendingMode = null;
                }
            }

            if (newMode !== node.currentMode) {
                node.currentMode = newMode;
                node.lastModeChange = now;
            }

            return null;
        }

        function buildOutputs() {
            const isHeating = node.currentMode === "heating";
            let effectiveHeatingSetpoint, effectiveCoolingSetpoint;
            if (node.algorithm === "single") {
                effectiveHeatingSetpoint = node.setpoint - node.deadband / 2;
                effectiveCoolingSetpoint = node.setpoint + node.deadband / 2;
            } else if (node.algorithm === "split") {
                effectiveHeatingSetpoint = node.heatingSetpoint;
                effectiveCoolingSetpoint = node.coolingSetpoint;
            } else if (node.algorithm === "specified") {
                effectiveHeatingSetpoint = node.heatingOn;
                effectiveCoolingSetpoint = node.coolingOn;
            }

            return [
                { 
                    payload: isHeating,
                    context: "isHeating", 
                    status: {
                        mode: node.currentMode,
                        isHeating,
                        heatingSetpoint: effectiveHeatingSetpoint,
                        coolingSetpoint: effectiveCoolingSetpoint,
                        temperature: node.lastTemperature
                    }
                },
            ];
        }

        function updateStatus() {
            const now = Date.now() / 1000;
            const inInitWindow = !initComplete && now - initStartTime < node.initWindow;

            if (inInitWindow) {
                utils.setStatusBusy(node, `initializing, out: ${node.currentMode}`);
            } else {
                let statusText = `in: temp=${node.lastTemperature !== null ? node.lastTemperature.toFixed(1) : "unknown"}, out: ${node.currentMode}`;
                if (pendingMode && conditionStartTime) {
                    const remaining = Math.max(0, node.swapTime - (now - conditionStartTime));
                    statusText += `, pending: ${pendingMode} in ${remaining.toFixed(0)}s`;
                }
                if (now - node.lastModeChange < 1) {
                    utils.setStatusChanged(node, statusText);
                } else {
                    utils.setStatusUnchanged(node, statusText);
                }
            }
        }

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("changeover-block", ChangeoverBlockNode);
};