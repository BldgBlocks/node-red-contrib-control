// ============================================================================
// PID Block - Proportional-Integral-Derivative Controller
// ============================================================================
// A full-featured PID controller for Node-RED with:
// - Configurable Kp, Ki, Kd gains (can be dynamic via msg or config)
// - Direct and Reverse action modes (heating vs cooling applications)
// - Deadband support (ReturnToZero or HoldLastResult behavior)
// - Output limiting and rate-of-change limiting
// - Anti-windup integral clamping
// - Automatic tuning (Ziegler-Nichols method)
// - Dynamic parameter updates via msg.context
// ============================================================================
//
// KEY CONCEPTS:
// =============
// Error = setpoint - input (for reverse action: heating)
//      OR input - setpoint (for direct action: cooling)
// Output represents demand: positive = need action, negative = excess
//
// P term (Proportional): responds immediately to error
//   - Too high: system oscillates around setpoint
//   - Too low: slow response, doesn't reach setpoint
//
// I term (Integral): removes steady-state error by accumulating error over time
//   - Eliminates offset (P alone can't reach exact setpoint)
//   - Too high: causes slower response or oscillation
//   - Anti-windup prevents excessive accumulation when limits are hit
//
// D term (Derivative): dampens response based on rate of change
//   - Helps prevent overshoot
//   - Low-pass filtered to prevent noise amplification
//   - Can cause problems with noisy sensors
//
// Tuning Tips:
// - Start with conservative Kp (0.1-1.0), set Ki=0, Kd=0
// - Increase Kp until system oscillates slightly, back off 30%
// - Add Ki to remove offset (start at Ki = Kp/100)
// - Add Kd to dampen oscillation (start at Kd = Kp * interval)
// - Use auto-tune feature for initial estimates
//
// ============================================================================

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function PIDBlockNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;
        node.isBusy = false;  // Lock to prevent concurrent message processing

        // ====================================================================
        // Initialize runtime state - values that change during operation
        // ====================================================================
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",  // Where to read input value from msg
            dbBehavior: config.dbBehavior,  // "ReturnToZero" or "HoldLastResult" - what to do in deadband
            errorSum: 0,                     // Accumulated error for integral term (I in PID)
            lastError: 0,                    // Previous error value for derivative calculation
            lastDError: 0,                   // Filtered derivative of error (prevents noise spikes)
            result: 0,                       // Current output value
            lastTime: Date.now(),            // Timestamp of last calculation for interval calculation
            setpoint: parseFloat(config.setpoint),     // Current setpoint value (may be rate-limited)
            setpointRaw: parseFloat(config.setpoint),  // Raw setpoint value (before rate limiting)
            tuneMode: false,                 // Auto-tuning mode active?
            tuneData: { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 },
            kp: parseFloat(config.kp),       // Proportional gain
            ki: parseFloat(config.ki),       // Integral gain
            kd: parseFloat(config.kd),       // Derivative gain
            setpointRateLimit: config.setpointRateLimit ? parseFloat(config.setpointRateLimit) : 0,  // Max setpoint change per second
            deadband: parseFloat(config.deadband),     // Zone around setpoint where no output
            outMin: config.outMin ? parseFloat(config.outMin) : null,  // Minimum output limit
            outMax: config.outMax ? parseFloat(config.outMax) : null,  // Maximum output limit
            maxChange: parseFloat(config.maxChange),   // Maximum change per second (rate limiting)
            run: !!config.run,               // Controller enabled/disabled
            directAction: !!config.directAction,  // true=cooling (temp↑→out↑), false=heating (temp↑→out↓)
        };

        // ====================================================================
        // Initialize internal variables - for tracking changes and constraints
        // =====================================================================
        let storekp = parseFloat(config.kp) || 0;
        let storeki = parseFloat(config.ki) || 0;
        let storekd = parseFloat(config.kd) || 0;
        let storesetpoint = parseFloat(config.setpoint) || 0;
        let storedeadband = parseFloat(config.deadband) || 0;
        let storeOutMin = config.outMin ? parseFloat(config.outMin) : null;
        let storeOutMax = config.outMax ? parseFloat(config.outMax) : null;
        let storemaxChange = parseFloat(config.maxChange) || 0;
        let storerun = !!config.run;  // convert to boolean

        // Integral constraint bounds - prevents integral wind-up
        // minInt/maxInt = output limits * (Kp * Ki) to keep integral gain in bounds
        let kpkiConst = storekp * storeki;
        let minInt = kpkiConst === 0 ? 0 : (storeOutMin || -Infinity) * kpkiConst;
        let maxInt = kpkiConst === 0 ? 0 : (storeOutMax || Infinity) * kpkiConst;
        let lastOutput = null;  // Track last output to avoid duplicate sends

        // ====================================================================
        // Main message handler - processes incoming input and context updates
        // ====================================================================
        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // ================================================================
            // Evaluate dynamic properties (Kp, Ki, Kd, setpoint, etc.)
            // These can be static config or dynamic (from msg or context)
            // ================================================================
            try {
                // Check busy lock - prevent concurrent processing since we're async
                if (node.isBusy) {
                    // Drop message if already processing (too fast)
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation phase
                node.isBusy = true;

                // Evaluate all configurable properties in parallel
                // Each can be static config (num) or dynamic (str expression, msg property, etc.)
                const evaluations = [];
                
                // Proportional gain - can be dynamic
                evaluations.push(
                    utils.requiresEvaluation(config.kpType) 
                        ? utils.evaluateNodeProperty(config.kp, config.kpType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.kp),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.kiType)
                        ? utils.evaluateNodeProperty(config.ki, config.kiType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.ki),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.kdType)
                        ? utils.evaluateNodeProperty(config.kd, config.kdType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.kd),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.setpointType)
                        ? utils.evaluateNodeProperty(config.setpoint, config.setpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.setpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.deadbandType)
                        ? utils.evaluateNodeProperty(config.deadband, config.deadbandType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.deadband),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.outMinType)
                        ? utils.evaluateNodeProperty(config.outMin, config.outMinType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.outMin),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.outMaxType)
                        ? utils.evaluateNodeProperty(config.outMax, config.outMaxType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.outMax),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.maxChangeType)
                        ? utils.evaluateNodeProperty(config.maxChange, config.maxChangeType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.maxChange),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.runType)
                        ? utils.evaluateNodeProperty(config.run, config.runType, node, msg)
                            .then(val => val === true)
                        : Promise.resolve(node.runtime.run),
                );

                const results = await Promise.all(evaluations);  

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.runtime.kp = results[0];
                if (!isNaN(results[1])) node.runtime.ki = results[1];
                if (!isNaN(results[2])) node.runtime.kd = results[2];

                if (!isNaN(results[4])) node.runtime.deadband = results[4];
                if (!isNaN(results[5])) node.runtime.outMin = results[5];
                if (!isNaN(results[6])) node.runtime.outMax = results[6];
                if (!isNaN(results[7])) node.runtime.maxChange = results[7];
                if (results[8] != null) node.runtime.run = results[8];  
                
                if (!isNaN(results[3])) {
                    node.runtime.setpoint = results[3];
                    // Sync raw value immediately so rate limiter has the correct target
                    node.runtime.setpointRaw = results[3]; 
                }
    
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // ================================================================
            // Configuration validation - ensure all values are valid numbers
            // ================================================================
            // Validate and sanitize all configuration values
            if (isNaN(node.runtime.kp) || !isFinite(node.runtime.kp)) node.runtime.kp = 0;
            if (isNaN(node.runtime.ki) || !isFinite(node.runtime.ki)) node.runtime.ki = 0;
            if (isNaN(node.runtime.kd) || !isFinite(node.runtime.kd)) node.runtime.kd = 0;
            if (isNaN(node.runtime.setpoint) || !isFinite(node.runtime.setpoint)) node.runtime.setpoint = 0;
            if (isNaN(node.runtime.setpointRaw) || !isFinite(node.runtime.setpointRaw)) node.runtime.setpointRaw = 0;
            if (isNaN(node.runtime.deadband) || !isFinite(node.runtime.deadband)) node.runtime.deadband = 0;
            if (isNaN(node.runtime.maxChange) || !isFinite(node.runtime.maxChange)) node.runtime.maxChange = 0;
            if (isNaN(node.runtime.setpointRateLimit) || !isFinite(node.runtime.setpointRateLimit)) node.runtime.setpointRateLimit = 0;
            if (node.runtime.outMin !== null && (isNaN(node.runtime.outMin) || !isFinite(node.runtime.outMin))) node.runtime.outMin = null;
            if (node.runtime.outMax !== null && (isNaN(node.runtime.outMax) || !isFinite(node.runtime.outMax))) node.runtime.outMax = null;
            
            // Validate config
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

            // ================================================================
            // Handle context updates - msg.context allows dynamic parameter changes
            // Supports: setpoint, kp, ki, kd, deadband, outMin, outMax, maxChange,
            //           run, directAction, dbBehavior, reset, tune
            // ================================================================
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
                if (["setpoint", "kp", "ki", "kd", "deadband", "outMin", "outMax", "maxChange", "setpointRateLimit"].includes(msg.context)) {
                    let value = parseFloat(msg.payload);
                    if (isNaN(value) || !isFinite(value)) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if ((msg.context === "deadband" || msg.context === "maxChange" || msg.context === "setpointRateLimit") && value < 0) {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                        if (done) done();
                        return;
                    }
                    if (msg.context === "setpoint") {
                        // Store raw setpoint value for rate limiting
                        node.runtime.setpointRaw = value;
                    } else {
                        node.runtime[msg.context] = value;
                    }
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
                    node.runtime.tuneData = { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 };
                    node.status({ fill: "green", shape: "dot", text: "reset" });
                    if (done) done();
                    return;
                } else if (msg.context === "tune") {
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        node.status({ fill: "red", shape: "ring", text: "invalid tune command" });
                        if (done) done();
                        return;
                    }
                    node.runtime.tuneMode = true;
                    node.runtime.tuneData = { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 };
                    node.runtime.errorSum = 0;
                    node.runtime.lastError = 0;
                    node.status({ fill: "yellow", shape: "dot", text: "tune: starting relay auto-tuning..." });
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

            // ================================================================
            // Read input value from configurable message property
            // Example: msg.data.temperature or msg.payload
            // If input is missing or invalid, output 0 (safe failsafe)
            // ================================================================
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            let input;
            
            if (inputValue === undefined || inputValue === null) {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                input = 0;  // Failsafe: output 0 instead of NaN
            } else {
                input = parseFloat(inputValue);
                if (isNaN(input) || !isFinite(input)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input property" });
                    input = 0;  // Failsafe: output 0 instead of NaN
                }
            }

            // ================================================================
            // Calculate time elapsed since last execution (interval in seconds)
            // This is critical: PID gains are time-dependent
            // ================================================================
            let currentTime = Date.now();
            let interval = (currentTime - node.runtime.lastTime) / 1000; // Convert to seconds
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

            // ================================================================
            // Early exit conditions - skip PID calculation if:
            // - Controller not running (run=false)
            // - interval <= 0: First execution, no time elapsed
            // - interval > 60: Time jump detected (clock adjustment, suspend/resume)
            // - Kp = 0: No proportional gain, no control possible
            // ================================================================
            if (!node.runtime.run || interval <= 0 || interval > 60 || node.runtime.kp === 0) {
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

            // ================================================================
            // Deadband check - zone around setpoint where no output is generated
            // This prevents oscillation when input is very close to target
            // ================================================================
            if (node.runtime.deadband !== 0 && input <= node.runtime.setpoint + node.runtime.deadband && input >= node.runtime.setpoint - node.runtime.deadband) {
                // Reset derivative term to prevent kick when exiting deadband
                // Without this, large derivative spike occurs on deadband exit
                node.runtime.lastDError = 0;
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

            // ================================================================
            // Update integral constraint limits when gains or output limits change
            // This rescales the accumulated error (errorSum) proportionally
            // ================================================================
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

            // ================================================================
            // Apply setpoint rate limiting to prevent integrator wind-up and thermal shock
            // Smoothly ramps setpoint changes at configured rate (units per second)
            // ================================================================
            if (node.runtime.setpointRateLimit > 0) {
                let setpointChange = node.runtime.setpointRaw - node.runtime.setpoint;
                let maxAllowedChange = node.runtime.setpointRateLimit * interval;
                
                if (Math.abs(setpointChange) > maxAllowedChange) {
                    // Ramp setpoint towards target at limited rate
                    node.runtime.setpoint += Math.sign(setpointChange) * maxAllowedChange;
                } else {
                    // Close enough to target, snap to it
                    node.runtime.setpoint = node.runtime.setpointRaw;
                }
            } else {
                // No rate limiting, use raw setpoint directly
                node.runtime.setpoint = node.runtime.setpointRaw;
            }

            // ================================================================
            // Calculate error - the basis of PID control
            // Reverse action (heating): error = setpoint - input
            //   - Temp below setpoint → positive error → positive output (heat)
            //   - Temp above setpoint → negative error → negative output (cool)
            // Direct action (cooling): error = input - setpoint
            //   - Temp above setpoint → positive error → positive output (cool)
            //   - Temp below setpoint → negative error → negative output (reduce cooling)
            // In both cases, output magnitude represents demand magnitude
            // ================================================================
            let error = node.runtime.directAction ? (input - node.runtime.setpoint) : (node.runtime.setpoint - input);

            // ================================================================
            // Relay Auto-Tuning (Improved Ziegler-Nichols)
            // Uses bang-bang relay control to find the critical oscillation point
            // More robust than manual Kp adjustment
            // ================================================================
            if (node.runtime.tuneMode) {
                // Initialize relay tuning on first call
                if (node.runtime.tuneData.startTime === null) {
                    node.runtime.tuneData.startTime = currentTime;
                    node.runtime.tuneData.relayOutput = 1;  // Start with output high
                    node.runtime.errorSum = 0;  // Reset integral during tuning
                    node.runtime.lastError = error;
                }

                // Apply relay control: output swings between min and max based on error sign
                if (error > node.runtime.deadband) {
                    node.runtime.tuneData.relayOutput = -1;  // Error positive: apply cooling
                } else if (error < -node.runtime.deadband) {
                    node.runtime.tuneData.relayOutput = 1;  // Error negative: apply heating
                }

                // Detect peaks and troughs in the error signal
                if (node.runtime.lastError > 0 && error <= 0) {  // Peak
                    if (node.runtime.tuneData.lastPeak !== null) {
                        node.runtime.tuneData.peaks.push({ type: 'peak', value: node.runtime.tuneData.lastPeak, time: currentTime });
                    }
                    node.runtime.tuneData.lastPeak = node.runtime.lastError;
                    node.runtime.tuneData.oscillationCount++;
                } else if (node.runtime.lastError < 0 && error >= 0) {  // Trough
                    if (node.runtime.tuneData.lastTrough !== null) {
                        node.runtime.tuneData.peaks.push({ type: 'trough', value: node.runtime.tuneData.lastTrough, time: currentTime });
                    }
                    node.runtime.tuneData.lastTrough = node.runtime.lastError;
                    node.runtime.tuneData.oscillationCount++;
                }

                // Use relay output as PID result during tuning
                let relayAmplitude = Math.abs((node.runtime.outMax || 100) - (node.runtime.outMin || 0)) / 2;
                node.runtime.result = node.runtime.tuneData.relayOutput > 0 ? relayAmplitude : -relayAmplitude;

                // Check if we have enough oscillations to calculate Tu and Ku
                if (node.runtime.tuneData.peaks.length >= 4) {
                    // Calculate ultimate period (Tu) from peak-to-peak distances
                    let periodSum = 0;
                    for (let i = 2; i < node.runtime.tuneData.peaks.length; i++) {
                        periodSum += (node.runtime.tuneData.peaks[i].time - node.runtime.tuneData.peaks[i-2].time) / 1000;
                    }
                    node.runtime.tuneData.Tu = (2 * periodSum) / (node.runtime.tuneData.peaks.length - 2);  // Average full period

                    // Calculate ultimate gain (Ku) from relay amplitude and peak error amplitude
                    let peakErrors = node.runtime.tuneData.peaks.map(p => Math.abs(p.value));
                    let avgPeakError = peakErrors.reduce((a, b) => a + b, 0) / peakErrors.length;
                    node.runtime.tuneData.Ku = relayAmplitude / (avgPeakError || 0.1);

                    // Apply Ziegler-Nichols for conservative "no overshoot" response
                    node.runtime.kp = 0.2 * node.runtime.tuneData.Ku;
                    node.runtime.ki = 0.4 * node.runtime.kp / node.runtime.tuneData.Tu;
                    node.runtime.kd = 0.066 * node.runtime.kp * node.runtime.tuneData.Tu;

                    node.runtime.tuneMode = false;
                    outputMsg.payload = 0;
                    outputMsg.tuneResult = {
                        method: 'relay-auto-tune',
                        Kp: node.runtime.kp,
                        Ki: node.runtime.ki,
                        Kd: node.runtime.kd,
                        Ku: node.runtime.tuneData.Ku,
                        Tu: node.runtime.tuneData.Tu,
                        oscillations: node.runtime.tuneData.oscillationCount
                    };
                    lastOutput = 0;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `tune: completed, Kp=${node.runtime.kp.toFixed(2)}, Ki=${node.runtime.ki.toFixed(2)}, Kd=${node.runtime.kd.toFixed(2)}`
                    });

                    send(outputMsg);
                    if (done) done();
                    return;
                } else {
                    // Still tuning - show progress
                    node.status({
                        fill: "yellow",
                        shape: "dot",
                        text: `tune: measuring oscillations (${node.runtime.tuneData.oscillationCount} half-cycles)...`
                    });
                }
            }

            // ================================================================
            // Integral Term (I in PID)
            // Accumulates error over time to eliminate steady-state error
            // ================================================================
            // Integral term with anti-windup to prevent excessive accumulation
            if (node.runtime.ki !== 0) {
                // Add this interval's error contribution to accumulated error
                node.runtime.errorSum += interval * error;
                // Clamp integral to prevent wind-up (integrator saturation)
                // Keeps errorSum within limits based on output range and gains
                node.runtime.errorSum = Math.min(Math.max(node.runtime.errorSum, minInt / (node.runtime.kp * node.runtime.ki || 1)), maxInt / (node.runtime.kp * node.runtime.ki || 1));
            }

            // ================================================================
            // Calculate the three PID terms
            // P term: proportional to current error
            // I term: proportional to accumulated error over time
            // D term: proportional to rate of change of error (filtered to prevent noise)
            // ================================================================
            // P term (proportional) - immediate response to error
            let pGain = node.runtime.kp * error;
            
            // I term (integral) - eliminates steady-state error
            // Note: Kp is NOT applied here (already in errorSum constraint calculation)
            let intGain = node.runtime.ki !== 0 ? node.runtime.kp * node.runtime.ki * node.runtime.errorSum : 0;
            
            // D term (derivative) - dampening, anticipates error changes
            // Raw derivative can be noisy, so we filter it (0.1 new + 0.9 old = low-pass filter)
            let dRaw = (error - node.runtime.lastError) / interval;  // Rate of change of error
            let dFiltered = node.runtime.kd !== 0 ? 0.1 * dRaw + 0.9 * node.runtime.lastDError : 0;  // Low-pass filtered
            let dGain = node.runtime.kd !== 0 ? node.runtime.kp * node.runtime.kd * dFiltered : 0;

            // Store current values for next iteration's derivative calculation
            node.runtime.lastError = error;
            node.runtime.lastDError = dFiltered;

            // ================================================================
            // Combine PID terms and apply output limits
            // ================================================================
            // Sum all three terms (P + I + D) to get raw output
            let pv = pGain + intGain + dGain;
            // Note: directAction flag determines error calculation sign:
            //   - false (reverse action): error = setpoint - input (for heating applications)
            //   - true (direct action): error = input - setpoint (for cooling applications)
            // Clamp output to min/max bounds (hard limits)
            pv = Math.min(Math.max(pv, node.runtime.outMin), node.runtime.outMax);

            // ================================================================
            // Rate-of-change limiting (maxChange) - prevents sudden jumps
            // Useful for preventing shock to equipment or actuators
            // maxChange = units per second (e.g., 10 = max 10 units/sec ramp)
            // ================================================================
            if (node.runtime.maxChange !== 0) {
                // Check how much output would change this interval
                if (node.runtime.result > pv) {
                    // Output would decrease - limit ramp down
                    node.runtime.result = (node.runtime.result - pv > node.runtime.maxChange) ? node.runtime.result - node.runtime.maxChange : pv;
                } else {
                    // Output would increase - limit ramp up
                    node.runtime.result = (pv - node.runtime.result > node.runtime.maxChange) ? node.runtime.result + node.runtime.maxChange : pv;
                }
            } else {
                // No rate limiting - use PID output directly
                node.runtime.result = pv;
            }
            
            // Re-apply hard output limits after rate-of-change limiting
            // Ensures final result never exceeds configured bounds regardless of maxChange ramp
            node.runtime.result = Math.min(Math.max(node.runtime.result, node.runtime.outMin), node.runtime.outMax);

            // Set output payload
            outputMsg.payload = node.runtime.result;
            
            // Safety check: ensure payload is never NaN
            if (isNaN(outputMsg.payload) || !isFinite(outputMsg.payload)) {
                outputMsg.payload = 0;
                node.status({ fill: "red", shape: "ring", text: "NaN detected, output forced to 0" });
            }
            
            // ================================================================
            // Include diagnostic information for debugging and monitoring
            // Shows breakdown of all three PID terms and current state
            // ================================================================
            outputMsg.diagnostics = { 
                pGain,                   // Proportional term contribution
                intGain,                 // Integral term contribution
                dGain,                   // Derivative term contribution
                error,                   // Current error value
                errorSum: node.runtime.errorSum,  // Accumulated integral error
                run: node.runtime.run,   // Controller enabled?
                directAction: node.runtime.directAction,  // Direct/Reverse action mode
                kp: node.runtime.kp,     // Proportional gain
                ki: node.runtime.ki,     // Integral gain
                kd: node.runtime.kd      // Derivative gain
            };

            // ================================================================
            // Update node status - show current state to user
            // ================================================================
            // Update status to show current input, output, and setpoint values
            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${input.toFixed(2)}, out: ${node.runtime.result.toFixed(2)}, setpoint: ${node.runtime.setpoint.toFixed(2)}`
            });
            
            // Track last output for comparison (optional, for flow logic)
            lastOutput = outputMsg.payload;

            // Send output message with payload and diagnostics
            send(outputMsg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("pid-block", PIDBlockNode);
};