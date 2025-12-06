module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function PIDBlockNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        // Initialize runtime state        
        node.runtime = {
            name: config.name,
            dbBehavior: config.dbBehavior,
            errorSum: 0,
            lastError: 0,
            lastDError: 0,
            result: 0,
            lastTime: Date.now(),
            tuneMode: false,
            tuneData: { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 }
        };
        
        try {      
            node.runtime.kp = parseFloat(RED.util.evaluateNodeProperty( config.kp, config.kpType, node ));
            node.runtime.ki = parseFloat(RED.util.evaluateNodeProperty( config.ki, config.kiType, node ));
            node.runtime.kd = parseFloat(RED.util.evaluateNodeProperty( config.kd, config.kdType, node ));
            node.runtime.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node ));
            node.runtime.deadband = parseFloat(RED.util.evaluateNodeProperty( config.deadband, config.deadbandType, node ));
            node.runtime.outMin = parseFloat(RED.util.evaluateNodeProperty( config.outMin, config.outMinType, node ));
            node.runtime.outMax = parseFloat(RED.util.evaluateNodeProperty( config.outMax, config.outMaxType, node ));
            node.runtime.maxChange = parseFloat(RED.util.evaluateNodeProperty( config.maxChange, config.maxChangeType, node ));
            node.runtime.run = RED.util.evaluateNodeProperty( config.run, config.runType, node ) === true;
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
        }

        // Initialize internal variables
        let storekp = parseFloat(config.kp) || 0;
        let storeki = parseFloat(config.ki) || 0;
        let storekd = parseFloat(config.kd) || 0;
        let storesetpoint = parseFloat(config.setpoint) || 0;
        let storedeadband = parseFloat(config.deadband) || 0;
        let storeOutMin = config.outMin ? parseFloat(config.outMin) : null;
        let storeOutMax = config.outMax ? parseFloat(config.outMax) : null;
        let storemaxChange = parseFloat(config.maxChange) || 0;
        let storerun = !!config.run;  // convert to boolean

        let kpkiConst = storekp * storeki;
        let minInt = kpkiConst === 0 ? 0 : (storeOutMin || -Infinity) * kpkiConst;
        let maxInt = kpkiConst === 0 ? 0 : (storeOutMax || Infinity) * kpkiConst;
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate typed-input properties    
            try {      
                if (utils.requiresEvaluation(config.kpType)) {
                    node.runtime.kp = parseFloat(RED.util.evaluateNodeProperty( config.kp, config.kpType, node, msg ));
                }
                if (utils.requiresEvaluation(config.kiType)) {
                    node.runtime.ki = parseFloat(RED.util.evaluateNodeProperty( config.ki, config.kiType, node, msg ));
                }
                if (utils.requiresEvaluation(config.kdType)) {
                    node.runtime.kd = parseFloat(RED.util.evaluateNodeProperty( config.kd, config.kdType, node, msg ));
                }
                if (utils.requiresEvaluation(config.setpointType)) {
                    node.runtime.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node, msg ));
                }
                if (utils.requiresEvaluation(config.deadbandType)) {
                    node.runtime.deadband = parseFloat(RED.util.evaluateNodeProperty( config.deadband, config.deadbandType, node, msg ));
                }
                if (utils.requiresEvaluation(config.outMinType)) {
                    node.runtime.outMin = parseFloat(RED.util.evaluateNodeProperty( config.outMin, config.outMinType, node, msg ));
                }
                if (utils.requiresEvaluation(config.outMaxType)) {
                    node.runtime.outMax = parseFloat(RED.util.evaluateNodeProperty( config.outMax, config.outMaxType, node, msg ));
                }
                if (utils.requiresEvaluation(config.maxChangeType)) {
                    node.runtime.maxChange = parseFloat(RED.util.evaluateNodeProperty( config.maxChange, config.maxChangeType, node, msg ));
                }
                if (utils.requiresEvaluation(config.runType)) {
                    node.runtime.run = RED.util.evaluateNodeProperty( config.run, config.runType, node, msg ) === true;
                }
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
            }

            // Validate config
            if (isNaN(node.runtime.kp) || isNaN(node.runtime.ki) || isNaN(node.runtime.kd) ||
                isNaN(node.runtime.setpoint) || isNaN(node.runtime.deadband) || isNaN(node.runtime.maxChange) ||
                !isFinite(node.runtime.kp) || !isFinite(node.runtime.ki) || !isFinite(node.runtime.kd) ||
                !isFinite(node.runtime.setpoint) || !isFinite(node.runtime.deadband) || !isFinite(node.runtime.maxChange)) {
                node.status({ fill: "red", shape: "ring", text: "invalid config" });
                node.runtime.kp = node.runtime.ki = node.runtime.kd = node.runtime.setpoint = node.runtime.deadband = node.runtime.maxChange = 0;
            }
            if (node.runtime.deadband < 0 || node.runtime.maxChange < 0) {
                node.status({ fill: "red", shape: "ring", text: "invalid deadband or maxChange" });
                node.runtime.deadband = node.runtime.maxChange = 0;
            }
            if (node.runtime.outMin != null && node.runtime.outMax != null && node.runtime.outMax <= node.runtime.outMin) {
                node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                node.runtime.outMin = node.runtime.outMax = null;
            }
            if (!["ReturnToZero", "HoldLastResult"].includes(node.runtime.dbBehavior)) {
                node.status({ fill: "red", shape: "ring", text: "invalid dbBehavior" });
                node.runtime.dbBehavior = "ReturnToZero";
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
                    if (done) done();
                    return;
                }
                if (typeof msg.context !== "string") {
                    node.status({ fill: "red", shape: "ring", text: "invalid context" });
                    if (done) done();
                    return;
                }
                if (["setpoint", "kp", "ki", "kd", "deadband", "outMin", "outMax", "maxChange"].includes(msg.context)) {
                    let value = parseFloat(msg.payload);
                    if (isNaN(value) || !isFinite(value)) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if ((msg.context === "deadband" || msg.context === "maxChange") && value < 0) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    node.runtime[msg.context] = value;
                    if (msg.context === "outMin" || msg.context === "outMax") {
                        if (node.runtime.outMin != null && node.runtime.outMax != null && node.runtime.outMax <= node.runtime.outMin) {
                            node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                            if (done) done();
                            return;
                        }
                    }
                    node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${value.toFixed(2)}` });
                } else if (["run", "directAction"].includes(msg.context)) {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    node.runtime[msg.context] = msg.payload;
                    node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${msg.payload}` });
                } else if (msg.context === "dbBehavior") {
                    if (!["ReturnToZero", "HoldLastResult"].includes(msg.payload)) {
                        node.status({ fill: "red", shape: "ring", text: "invalid dbBehavior" });
                        if (done) done();
                        return;
                    }
                    node.runtime.dbBehavior = msg.payload;
                    node.status({ fill: "green", shape: "dot", text: `dbBehavior: ${msg.payload}` });
                } else if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    node.runtime.errorSum = 0;
                    node.runtime.lastError = 0;
                    node.runtime.lastDError = 0;
                    node.runtime.result = 0;
                    node.runtime.tuneMode = false;
                    node.runtime.tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
                    node.status({ fill: "green", shape: "dot", text: "reset" });
                    if (done) done();
                    return;
                } else if (msg.context === "tune") {
                    let tuneKp = parseFloat(msg.payload);
                    if (isNaN(tuneKp) || !isFinite(tuneKp) || tuneKp <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid tune kp" });
                        if (done) done();
                        return;
                    }
                    node.runtime.tuneMode = true;
                    node.runtime.kp = tuneKp;
                    node.runtime.ki = 0;
                    node.runtime.kd = 0;
                    node.runtime.tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
                    node.status({ fill: "green", shape: "dot", text: `tune: started, kp=${tuneKp.toFixed(2)}` });
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input) || !isFinite(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            // PID Calculation
            let currentTime = Date.now();
            let interval = (currentTime - node.runtime.lastTime) / 1000; // Seconds
            node.runtime.lastTime = currentTime;

            let outputMsg = { payload: 0 };
            outputMsg.diagnostics = { 
                setpoint: node.runtime.setpoint,
                interval,
                lastOutput,
                run: node.runtime.run, 
                directAction: node.runtime.directAction,
                kp: node.runtime.kp, 
                ki: node.runtime.ki, 
                kd: node.runtime.kd 
            };

            if (!node.runtime.run || interval <= 0 || node.runtime.kp === 0) {
                if (lastOutput !== 0) {
                    lastOutput = 0;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                    });
                } else {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                    });
                }
                send(outputMsg);
                if (done) done();
                return;
            }

            // Deadband check
            if (node.runtime.deadband !== 0 && input <= node.runtime.setpoint + node.runtime.deadband && input >= node.runtime.setpoint - node.runtime.deadband) {
                outputMsg.payload = node.runtime.dbBehavior === "ReturnToZero" ? 0 : node.runtime.result;
                const outputChanged = !lastOutput || lastOutput !== outputMsg.payload;
                if (outputChanged) {
                    lastOutput = outputMsg.payload;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                    });
                    send(outputMsg);
                } else {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                    });
                }
                if (done) done();
                return;
            }

            // Update internal constraints
            if (node.runtime.kp !== storekp || node.runtime.ki !== storeki || node.runtime.outMin !== storeOutMin || node.runtime.outMax !== storeOutMax) {
                if (node.runtime.kp !== storekp && node.runtime.kp !== 0 && storekp !== 0) {
                    node.runtime.errorSum = node.runtime.errorSum * storekp / node.runtime.kp;
                }
                if (node.runtime.ki !== storeki && node.runtime.ki !== 0 && storeki !== 0) {
                    node.runtime.errorSum = node.runtime.errorSum * storeki / node.runtime.ki;
                }
                kpkiConst = node.runtime.kp * node.runtime.ki;
                minInt = kpkiConst === 0 ? 0 : (node.runtime.outMin || -Infinity) * kpkiConst;
                maxInt = kpkiConst === 0 ? 0 : (node.runtime.outMax || Infinity) * kpkiConst;
                storekp = node.runtime.kp;
                storeki = node.runtime.ki;
                storeOutMin = node.runtime.outMin;
                storeOutMax = node.runtime.outMax;
            }

            // Calculate error
            let error = node.runtime.setpoint - input;

            // Tuning assistant (Ziegler-Nichols)
            if (node.runtime.tuneMode) {
                if (node.runtime.lastError > 0 && error <= 0) { // Peak detected
                    if (node.runtime.tuneData.lastPeak !== null) {
                        node.runtime.tuneData.oscillations.push({ time: currentTime, amplitude: node.runtime.tuneData.lastPeak });
                    }
                    node.runtime.tuneData.lastPeak = node.runtime.lastError;
                } else if (node.runtime.lastError < 0 && error >= 0) { // Trough detected
                    node.runtime.tuneData.lastTrough = node.runtime.lastError;
                }
                if (node.runtime.tuneData.oscillations.length >= 3) { // Enough data to tune
                    let periodSum = 0;
                    for (let i = 1; i < node.runtime.tuneData.oscillations.length; i++) {
                        periodSum += (node.runtime.tuneData.oscillations[i].time - node.runtime.tuneData.oscillations[i-1].time) / 1000;
                    }
                    node.runtime.tuneData.Tu = periodSum / (node.runtime.tuneData.oscillations.length - 1); // Average period in seconds
                    node.runtime.tuneData.Ku = node.runtime.kp; // Ultimate gain
                    node.runtime.kp = 0.6 * node.runtime.tuneData.Ku;
                    node.runtime.ki = 2 * node.runtime.kp / node.runtime.tuneData.Tu;
                    node.runtime.kd = node.runtime.kp * node.runtime.tuneData.Tu / 8;
                    node.runtime.tuneMode = false;
                    outputMsg.payload = node.runtime.result;
                    outputMsg.tuneResult = {
                        Kp: node.runtime.kp,
                        Ki: node.runtime.ki,
                        Kd: node.runtime.kd,
                        Ku: node.runtime.tuneData.Ku,
                        Tu: node.runtime.tuneData.Tu
                    };
                    lastOutput = outputMsg.payload;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `tune: completed, Kp=${node.runtime.kp.toFixed(2)}, Ki=${node.runtime.ki.toFixed(2)}, Kd=${node.runtime.kd.toFixed(2)}`
                    });

                    send(outputMsg);
                    if (done) done();
                    return;
                }
            }

            // Integral term
            if (node.runtime.ki !== 0) {
                node.runtime.errorSum += interval * error;
                if (node.runtime.directAction) {
                    if (-node.runtime.errorSum > maxInt) node.runtime.errorSum = -maxInt;
                    else if (-node.runtime.errorSum < minInt) node.runtime.errorSum = -minInt;
                } else {
                    node.runtime.errorSum = Math.min(Math.max(node.runtime.errorSum, minInt), maxInt);
                }
            }

            // Gain calculations
            let pGain = node.runtime.kp * error;
            let intGain = node.runtime.ki !== 0 ? node.runtime.kp * node.runtime.ki * node.runtime.errorSum * interval : 0;
            let dRaw = (error - node.runtime.lastError) / interval;
            let dFiltered = node.runtime.kd !== 0 ? 0.1 * dRaw + 0.9 * node.runtime.lastDError : 0;
            let dGain = node.runtime.kd !== 0 ? node.runtime.kp * node.runtime.kd * dFiltered : 0;

            node.runtime.lastError = error;
            node.runtime.lastDError = dFiltered;

            // Output calculation
            let pv = pGain + intGain + dGain;
            //if (node.runtime.directAction) pv = -pv;
            pv = Math.min(Math.max(pv, node.runtime.outMin), node.runtime.outMax);

            // Rate of change limit
            if (node.runtime.maxChange !== 0) {
                if (node.runtime.result > pv) {
                    node.runtime.result = (node.runtime.result - pv > node.runtime.maxChange) ? node.runtime.result - node.runtime.maxChange : pv;
                } else {
                    node.runtime.result = (pv - node.runtime.result > node.runtime.maxChange) ? node.runtime.result + node.runtime.maxChange : pv;
                }
            } else {
                node.runtime.result = pv;
            }

            outputMsg.payload = node.runtime.result;
            outputMsg.diagnostics = { 
                pGain, 
                intGain, 
                dGain, 
                error, 
                errorSum: node.runtime.errorSum, 
                run: node.runtime.run, 
                directAction: node.runtime.directAction,
                kp: node.runtime.kp, 
                ki: node.runtime.ki, 
                kd: node.runtime.kd 
            };

            const outputChanged = !lastOutput || lastOutput !== outputMsg.payload;
            if (outputChanged) {
                lastOutput = outputMsg.payload;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${node.runtime.result.toFixed(2)}, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${node.runtime.result.toFixed(2)}, setpoint: ${node.runtime.setpoint.toFixed(2)}`
                });
            }

            send(outputMsg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("pid-block", PIDBlockNode);
};