module.exports = function(RED) {
    function PIDBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "pid";
        node.kp = parseFloat(config.kp) || 0;
        node.ki = parseFloat(config.ki) || 0;
        node.kd = parseFloat(config.kd) || 0;
        node.setpoint = parseFloat(config.setpoint) || 0;
        node.deadband = parseFloat(config.deadband) || 0;
        node.dbBehavior = config.dbBehavior || "ReturnToZero";
        node.outMin = config.outMin ? parseFloat(config.outMin) : -Infinity;
        node.outMax = config.outMax ? parseFloat(config.outMax) : Infinity;
        node.maxChange = parseFloat(config.maxChange) || 0;
        node.directAction = config.directAction === true;
        node.run = config.run !== false;

        // Validate initial config
        if (isNaN(node.kp) || isNaN(node.ki) || isNaN(node.kd) || isNaN(node.setpoint) ||
            isNaN(node.deadband) || isNaN(node.maxChange)) {
            node.status({ fill: "red", shape: "ring", text: "invalid config" });
            node.kp = node.ki = node.kd = node.setpoint = node.deadband = node.maxChange = 0;
        }
        if (node.deadband < 0 || node.maxChange < 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid deadband or maxChange" });
            node.deadband = node.maxChange = 0;
        }
        if (isFinite(node.outMin) && isFinite(node.outMax) && node.outMax <= node.outMin) {
            node.status({ fill: "red", shape: "ring", text: "invalid output range" });
            node.outMin = -Infinity;
            node.outMax = Infinity;
        }
        if (node.dbBehavior !== "ReturnToZero" && node.dbBehavior !== "HoldLastResult") {
            node.status({ fill: "red", shape: "ring", text: "invalid dbBehavior" });
            node.dbBehavior = "ReturnToZero";
        }

        // Initialize state
        let errorSum = 0;
        let lastError = 0;
        let lastDError = 0;
        let result = 0;
        let storekp = node.kp;
        let storeki = node.ki;
        let storemin = node.outMin;
        let storemax = node.outMax;
        let kpkiConst = node.kp * node.ki;
        let minInt = kpkiConst === 0 ? 0 : node.outMin * kpkiConst;
        let maxInt = kpkiConst === 0 ? 0 : node.outMax * kpkiConst;
        let lastTime = Date.now();
        let tuneMode = false;
        let tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (["setpoint", "kp", "ki", "kd", "deadband", "outMin", "outMax", "maxChange"].includes(msg.context)) {
                    let value = parseFloat(msg.payload);
                    if (isNaN(value)) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if ((msg.context === "deadband" || msg.context === "maxChange") && value < 0) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if (msg.context === "setpoint") node.setpoint = value;
                    else if (msg.context === "kp") node.kp = value;
                    else if (msg.context === "ki") node.ki = value;
                    else if (msg.context === "kd") node.kd = value;
                    else if (msg.context === "deadband") node.deadband = value;
                    else if (msg.context === "outMin") node.outMin = value;
                    else if (msg.context === "outMax") node.outMax = value;
                    else node.maxChange = value;

                    if (isFinite(node.outMin) && isFinite(node.outMax) && node.outMax <= node.outMin) {
                        node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                        if (done) done();
                        return;
                    }
                    node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${value}` });
                } else if (["run", "directAction"].includes(msg.context)) {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if (msg.context === "run") node.run = msg.payload;
                    else node.directAction = msg.payload;
                    node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${msg.payload}` });
                } else if (msg.context === "dbBehavior") {
                    if (msg.payload !== "ReturnToZero" && msg.payload !== "HoldLastResult") {
                        node.status({ fill: "red", shape: "ring", text: "invalid dbBehavior" });
                        if (done) done();
                        return;
                    }
                    node.dbBehavior = msg.payload;
                    node.status({ fill: "green", shape: "dot", text: `dbBehavior: ${msg.payload}` });
                } else if (msg.context === "reset") {
                    errorSum = 0;
                    lastError = 0;
                    lastDError = 0;
                    result = 0;
                    tuneMode = false;
                    tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
                    node.status({ fill: "green", shape: "dot", text: "reset" });
                    if (done) done();
                    return;
                } else if (msg.context === "tune") {
                    let tuneKp = parseFloat(msg.payload) || 1;
                    if (isNaN(tuneKp)) {
                        node.status({ fill: "red", shape: "ring", text: "invalid tune kp" });
                        if (done) done();
                        return;
                    }
                    tuneMode = true;
                    node.kp = tuneKp;
                    node.ki = 0;
                    node.kd = 0;
                    tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
                    node.status({ fill: "green", shape: "dot", text: `tune: started, kp=${tuneKp}` });
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
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

            // PID Calculation
            let currentTime = Date.now();
            let interval = (currentTime - lastTime) / 1000; // Seconds
            lastTime = currentTime;

            let outputMsg = { payload: 0, diagnostics: {} };
            if (!node.run || interval <= 0 || node.kp === 0) {
                if (lastOutput !== 0) {
                    lastOutput = 0;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.setpoint}`
                    });
                    send(outputMsg);
                } else {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.setpoint}`
                    });
                }
                if (done) done();
                return;
            }

            // Deadband check
            if (node.deadband !== 0 && input <= node.setpoint + node.deadband && input >= node.setpoint - node.deadband) {
                outputMsg.payload = node.dbBehavior === "ReturnToZero" ? 0 : result;
                const outputChanged = !lastOutput || lastOutput !== outputMsg.payload;
                if (outputChanged) {
                    lastOutput = outputMsg.payload;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.setpoint}`
                    });
                    send(outputMsg);
                } else {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.setpoint}`
                    });
                }
                if (done) done();
                return;
            }

            // Update internal constraints
            if (node.kp !== storekp || node.ki !== storeki || node.outMin !== storemin || node.outMax !== storemax) {
                if (node.kp !== storekp && node.kp !== 0 && storekp !== 0) {
                    errorSum = errorSum * storekp / node.kp;
                }
                if (node.ki !== storeki && node.ki !== 0 && storeki !== 0) {
                    errorSum = errorSum * storeki / node.ki;
                }
                kpkiConst = node.kp * node.ki;
                minInt = kpkiConst === 0 ? 0 : node.outMin * kpkiConst;
                maxInt = kpkiConst === 0 ? 0 : node.outMax * kpkiConst;
                storekp = node.kp;
                storeki = node.ki;
                storemin = node.outMin;
                storemax = node.outMax;
            }

            // Calculate error
            let error = node.setpoint - input;

            // Tuning assistant (Ziegler-Nichols)
            if (tuneMode) {
                if (lastError > 0 && error <= 0) { // Peak detected
                    if (tuneData.lastPeak !== null) {
                        tuneData.oscillations.push({ time: currentTime, amplitude: tuneData.lastPeak });
                    }
                    tuneData.lastPeak = lastError;
                } else if (lastError < 0 && error >= 0) { // Trough detected
                    tuneData.lastTrough = lastError;
                }
                if (tuneData.oscillations.length >= 3) { // Enough data to tune
                    let periodSum = 0;
                    for (let i = 1; i < tuneData.oscillations.length; i++) {
                        periodSum += (tuneData.oscillations[i].time - tuneData.oscillations[i-1].time) / 1000;
                    }
                    tuneData.Tu = periodSum / (tuneData.oscillations.length - 1); // Average period in seconds
                    tuneData.Ku = node.kp; // Ultimate gain
                    node.kp = 0.6 * tuneData.Ku;
                    node.ki = 2 * node.kp / tuneData.Tu;
                    node.kd = node.kp * tuneData.Tu / 8;
                    tuneMode = false;
                    outputMsg.payload = result;
                    outputMsg.tuneResult = { Kp: node.kp, Ki: node.ki, Kd: node.kd, Ku: tuneData.Ku, Tu: tuneData.Tu };
                    lastOutput = { payload: outputMsg.payload, tuneResult: outputMsg.tuneResult };
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `tune: completed, Kp=${node.kp}, Ki=${node.ki}, Kd=${node.kd}`
                    });
                    send(outputMsg);
                    if (done) done();
                    return;
                }
            }

            // Integral term
            if (node.ki !== 0) {
                errorSum += interval * error;
                if (node.directAction) {
                    if (-errorSum > maxInt) errorSum = -maxInt;
                    else if (-errorSum < minInt) errorSum = -minInt;
                } else {
                    errorSum = Math.min(Math.max(errorSum, minInt), maxInt);
                }
            }

            // Gain calculations
            let pGain = node.kp * error;
            let intGain = node.ki !== 0 ? node.kp * node.ki * errorSum * interval : 0;
            let dRaw = (error - lastError) / interval;
            let dFiltered = node.kd !== 0 ? 0.1 * dRaw + 0.9 * lastDError : 0;
            let dGain = node.kd !== 0 ? node.kp * node.kd * dFiltered : 0;

            lastError = error;
            lastDError = dFiltered;

            // Output calculation
            let pv = pGain + intGain + dGain;
            if (node.directAction) pv = -pv;
            pv = Math.min(Math.max(pv, node.outMin), node.outMax);

            // Rate of change limit
            if (node.maxChange !== 0) {
                if (result > pv) {
                    result = (result - pv > node.maxChange) ? result - node.maxChange : pv;
                } else {
                    result = (pv - result > node.maxChange) ? result + node.maxChange : pv;
                }
            } else {
                result = pv;
            }

            outputMsg.payload = result;
            outputMsg.diagnostics = { pGain, intGain, dGain, error, errorSum };

            const outputChanged = !lastOutput || lastOutput.payload !== outputMsg.payload ||
                                 lastOutput.tuneResult !== outputMsg.tuneResult;
            if (outputChanged) {
                lastOutput = { payload: outputMsg.payload, tuneResult: outputMsg.tuneResult };
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${result.toFixed(2)}, setpoint: ${node.setpoint}`
                });
                send(outputMsg);
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${result.toFixed(2)}, setpoint: ${node.setpoint}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            errorSum = 0;
            lastError = 0;
            lastDError = 0;
            result = 0;
            storekp = node.kp;
            storeki = node.ki;
            storemin = node.outMin;
            storemax = node.outMax;
            kpkiConst = node.kp * node.ki;
            minInt = kpkiConst === 0 ? 0 : node.outMin * kpkiConst;
            maxInt = kpkiConst === 0 ? 0 : node.outMax * kpkiConst;
            lastTime = Date.now();
            tuneMode = false;
            tuneData = { oscillations: [], lastPeak: null, lastTrough: null, Ku: 0, Tu: 0 };
            lastOutput = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("pid-block", PIDBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/pid-block/:id", RED.auth.needsPermission("pid-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "pid-block") {
            res.json({
                name: node.name || "pid",
                kp: isNaN(node.kp) ? 0 : node.kp,
                ki: isNaN(node.ki) ? 0 : node.ki,
                kd: isNaN(node.kd) ? 0 : node.kd,
                setpoint: isNaN(node.setpoint) ? 0 : node.setpoint,
                deadband: isNaN(node.deadband) ? 0 : node.deadband,
                dbBehavior: node.dbBehavior || "ReturnToZero",
                outMin: isNaN(node.outMin) ? null : node.outMin,
                outMax: isNaN(node.outMax) ? null : node.outMax,
                maxChange: isNaN(node.maxChange) ? 0 : node.maxChange,
                directAction: !!node.directAction,
                run: node.run !== false
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};