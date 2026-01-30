//const { parse } = require('echarts/types/src/export/api/time.js');

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            initWindow: parseFloat(config.initWindow),
            lastTemperature: null,
            lastModeChange: 0,
            setpoint: parseFloat(config.setpoint),
            heatingSetpoint: parseFloat(config.heatingSetpoint),
            coolingSetpoint: parseFloat(config.coolingSetpoint),
            swapTime: parseFloat(config.swapTime),
            deadband: parseFloat(config.deadband),
            extent: parseFloat(config.extent),
            minTempSetpoint: parseFloat(config.minTempSetpoint),
            maxTempSetpoint: parseFloat(config.maxTempSetpoint),
            algorithm: config.algorithm,
            operationMode: config.operationMode,
            currentMode: config.operationMode === "cool" ? "cooling" : "heating",
        };

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
                        : Promise.resolve(node.runtime.setpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.heatingSetpointType) 
                        ? utils.evaluateNodeProperty(config.heatingSetpoint, config.heatingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.heatingSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.coolingSetpointType) 
                        ? utils.evaluateNodeProperty(config.coolingSetpoint, config.coolingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.coolingSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.swapTimeType) 
                        ? utils.evaluateNodeProperty(config.swapTime, config.swapTimeType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.swapTime),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.deadbandType) 
                        ? utils.evaluateNodeProperty(config.deadband, config.deadbandType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.deadband),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.extentType) 
                        ? utils.evaluateNodeProperty(config.extent, config.extentType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.extent),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.minTempSetpointType) 
                        ? utils.evaluateNodeProperty(config.minTempSetpoint, config.minTempSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.minTempSetpoint),
                );  

                evaluations.push(
                    utils.requiresEvaluation(config.maxTempSetpointType)
                        ? utils.evaluateNodeProperty(config.maxTempSetpoint, config.maxTempSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.maxTempSetpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.algorithmType)
                        ? utils.evaluateNodeProperty(config.algorithm, config.algorithmType, node, msg)
                        : Promise.resolve(node.runtime.algorithm),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.operationModeType)
                        ? utils.evaluateNodeProperty(config.operationMode, config.operationModeType, node, msg)
                        : Promise.resolve(node.runtime.operationMode),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values

                if (!isNaN(results[0])) node.runtime.setpoint = results[0];
                if (!isNaN(results[1])) node.runtime.heatingSetpoint = results[1];
                if (!isNaN(results[2])) node.runtime.coolingSetpoint = results[2];
                if (!isNaN(results[3])) node.runtime.swapTime = results[3];
                if (!isNaN(results[4])) node.runtime.deadband = results[4];
                if (!isNaN(results[5])) node.runtime.extent = results[5];
                if (!isNaN(results[6])) node.runtime.minTempSetpoint = results[6];
                if (!isNaN(results[7])) node.runtime.maxTempSetpoint = results[7];
                if (results[8]) node.runtime.algorithm = results[8];
                if (results[9]) node.runtime.operationMode = results[9];
                node.runtime.currentMode = node.runtime.operationMode === "cool" ? "cooling" : "heating";   
      
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Validate
            if (node.runtime.coolingSetpoint < node.runtime.heatingSetpoint 
                || node.runtime.maxTempSetpoint < node.runtime.minTempSetpoint 
                || node.runtime.deadband <= 0 || node.runtime.extent < 0) {
                utils.setStatusError(node, "error validating properties, check setpoints");
                if (done) done(err);
                return;
            }
            
            if (node.runtime.swapTime < 60) {
                node.runtime.swapTime = 60;
                utils.setStatusError(node, "swapTime below 60s, using 60");
            }

            if (node.runtime.coolingSetpoint < node.runtime.heatingSetpoint) {
                node.runtime.coolingSetpoint = node.runtime.heatingSetpoint + 4;
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
                        node.runtime.operationMode = msg.payload;
                        utils.setStatusOK(node, `in: operationMode=${msg.payload}, out: ${node.runtime.currentMode}`);
                        break;
                    case "algorithm":
                        if (!["single", "split"].includes(msg.payload)) {
                            utils.setStatusError(node, "invalid algorithm");
                            if (done) done();
                            return;
                        }
                        node.runtime.algorithm = msg.payload;
                        utils.setStatusOK(node, `in: algorithm=${msg.payload}, out: ${node.runtime.currentMode}`);
                        break;
                    case "setpoint":
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint) {
                            utils.setStatusError(node, "invalid setpoint");
                            if (done) done();
                            return;
                        }
                        node.runtime.setpoint = value.toString();
                        node.runtime.setpointType = "num";
                        utils.setStatusOK(node, `in: setpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "deadband":
                        if (isNaN(value) || value <= 0) {
                            utils.setStatusError(node, "invalid deadband");
                            if (done) done();
                            return;
                        }
                        node.runtime.deadband = value;
                        utils.setStatusOK(node, `in: deadband=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "heatingSetpoint":
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value > node.runtime.coolingSetpoint) {
                            utils.setStatusError(node, "invalid heatingSetpoint");
                            if (done) done();
                            return;
                        }
                        node.runtime.heatingSetpoint = value.toString();
                        node.runtime.heatingSetpointType = "num";
                        utils.setStatusOK(node, `in: heatingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "coolingSetpoint":
                        if (isNaN(value) || value < node.runtime.minTempSetpoint || value > node.runtime.maxTempSetpoint || value < node.runtime.heatingSetpoint) {
                            utils.setStatusError(node, "invalid coolingSetpoint");
                            if (done) done();
                            return;
                        }
                        node.runtime.coolingSetpoint = value.toString();
                        node.runtime.coolingSetpointType = "num";
                        utils.setStatusOK(node, `in: coolingSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "extent":
                        if (isNaN(value) || value < 0) {
                            utils.setStatusError(node, "invalid extent");
                            if (done) done();
                            return;
                        }
                        node.runtime.extent = value;
                        utils.setStatusOK(node, `in: extent=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "swapTime":
                        if (isNaN(value) || value < 60) {
                            utils.setStatusError(node, "invalid swapTime, minimum 60s");
                            if (done) done();
                            return;
                        }
                        node.runtime.swapTime = value.toString();
                        node.runtime.swapTimeType = "num";
                        utils.setStatusOK(node, `in: swapTime=${value.toFixed(0)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "minTempSetpoint":
                        if (isNaN(value) || value >= node.runtime.maxTempSetpoint ||
                            (node.runtime.algorithm === "single" && value > node.runtime.setpoint) ||
                            (node.runtime.algorithm === "split" && (value > node.runtime.heatingSetpoint || value > node.runtime.coolingSetpoint))) {
                            utils.setStatusError(node, "invalid minTempSetpoint");
                            if (done) done();
                            return;
                        }
                        node.runtime.minTempSetpoint = value;
                        utils.setStatusOK(node, `in: minTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "maxTempSetpoint":
                        if (isNaN(value) || value <= node.runtime.minTempSetpoint ||
                            (node.runtime.algorithm === "single" && value < node.runtime.setpoint) ||
                            (node.runtime.algorithm === "split" && (value < node.runtime.heatingSetpoint || value < node.runtime.coolingSetpoint))) {
                            utils.setStatusError(node, "invalid maxTempSetpoint");
                            if (done) done();
                            return;
                        }
                        node.runtime.maxTempSetpoint = value;
                        utils.setStatusOK(node, `in: maxTempSetpoint=${value.toFixed(1)}, out: ${node.runtime.currentMode}`);
                        break;
                    case "initWindow":
                        if (isNaN(value) || value < 0) {
                            utils.setStatusError(node, "invalid initWindow");
                            if (done) done();
                            return;
                        }
                        node.runtime.initWindow = value;
                        utils.setStatusOK(node, `in: initWindow=${value.toFixed(0)}, out: ${node.runtime.currentMode}`);
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
                input = parseFloat(RED.util.getMessageProperty(msg, node.runtime.inputProperty));
            } catch (err) {
                input = NaN;
            }
            if (isNaN(input)) {
                utils.setStatusError(node, "missing or invalid input property");
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
                } else if (node.runtime.algorithm === "split") {
                    heatingThreshold = node.runtime.heatingSetpoint - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingSetpoint + node.runtime.extent;
                } else if (node.runtime.algorithm === "specified") {
                    heatingThreshold = node.runtime.heatingOn - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingOn + node.runtime.extent;
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
                } else if (node.runtime.algorithm === "split") {
                    heatingThreshold = node.runtime.heatingSetpoint - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingSetpoint + node.runtime.extent;
                } else if (node.runtime.algorithm === "specified") {
                    heatingThreshold = node.runtime.heatingOn - node.runtime.extent;
                    coolingThreshold = node.runtime.coolingOn + node.runtime.extent;
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
            } else if (node.runtime.algorithm === "split") {
                effectiveHeatingSetpoint = node.runtime.heatingSetpoint;
                effectiveCoolingSetpoint = node.runtime.coolingSetpoint;
            } else if (node.runtime.algorithm === "specified") {
                effectiveHeatingSetpoint = node.runtime.heatingOn;
                effectiveCoolingSetpoint = node.runtime.coolingOn;
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
                utils.setStatusBusy(node, `initializing, out: ${node.runtime.currentMode}`);
            } else {
                let statusText = `in: temp=${node.runtime.lastTemperature !== null ? node.runtime.lastTemperature.toFixed(1) : "unknown"}, out: ${node.runtime.currentMode}`;
                if (pendingMode && conditionStartTime) {
                    const remaining = Math.max(0, node.runtime.swapTime - (now - conditionStartTime));
                    statusText += `, pending: ${pendingMode} in ${remaining.toFixed(0)}s`;
                }
                if (now - node.runtime.lastModeChange < 1) {
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