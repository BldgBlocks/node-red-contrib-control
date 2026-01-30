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
        // Initialize state - values that change during operation
        // ====================================================================
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";  // Where to read input value from msg
        node.dbBehavior = config.dbBehavior;  // "ReturnToZero" or "HoldLastResult" - what to do in deadband
        node.errorSum = 0;                     // Accumulated error for integral term (I in PID)
        node.lastError = 0;                    // Previous error value for derivative calculation
        node.lastDError = 0;                   // Filtered derivative of error (prevents noise spikes)
        node.result = 0;                       // Current output value
        node.lastTime = Date.now();            // Timestamp of last calculation for interval calculation
        node.setpoint = parseFloat(config.setpoint);     // Current setpoint value (may be rate-limited)
        node.setpointRaw = parseFloat(config.setpoint);  // Raw setpoint value (before rate limiting)
        node.tuneMode = false;                 // Auto-tuning mode active?
        node.tuneData = { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 };
        node.kp = parseFloat(config.kp);       // Proportional gain
        node.ki = parseFloat(config.ki);       // Integral gain
        node.kd = parseFloat(config.kd);       // Derivative gain
        node.setpointRateLimit = config.setpointRateLimit ? parseFloat(config.setpointRateLimit) : 0;  // Max setpoint change per second
        node.deadband = parseFloat(config.deadband);     // Zone around setpoint where no output
        node.outMin = config.outMin ? parseFloat(config.outMin) : null;  // Minimum output limit
        node.outMax = config.outMax ? parseFloat(config.outMax) : null;  // Maximum output limit
        node.maxChange = parseFloat(config.maxChange);   // Maximum change per second (rate limiting)
        node.run = !!config.run;               // Controller enabled/disabled
        node.directAction = !!config.directAction;  // true=cooling (temp↑→out↑), false=heating (temp↑→out↓)

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

        // =====================================================================
        // Main message handler - processes incoming input and context updates
        // ====================================================================
        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
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
                    utils.setStatusBusy(node, "busy - dropped msg");
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
                        : Promise.resolve(node.kp),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.kiType)
                        ? utils.evaluateNodeProperty(config.ki, config.kiType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.ki),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.kdType)
                        ? utils.evaluateNodeProperty(config.kd, config.kdType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.kd),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.setpointType)
                        ? utils.evaluateNodeProperty(config.setpoint, config.setpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.setpoint),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.deadbandType)
                        ? utils.evaluateNodeProperty(config.deadband, config.deadbandType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.deadband),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.outMinType)
                        ? utils.evaluateNodeProperty(config.outMin, config.outMinType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.outMin),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.outMaxType)
                        ? utils.evaluateNodeProperty(config.outMax, config.outMaxType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.outMax),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.maxChangeType)
                        ? utils.evaluateNodeProperty(config.maxChange, config.maxChangeType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.maxChange),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.runType)
                        ? utils.evaluateNodeProperty(config.run, config.runType, node, msg)
                            .then(val => val === true)
                        : Promise.resolve(node.run),
                );

                const results = await Promise.all(evaluations);  

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.kp = results[0];
                if (!isNaN(results[1])) node.ki = results[1];
                if (!isNaN(results[2])) node.kd = results[2];

                if (!isNaN(results[4])) node.deadband = results[4];
                if (!isNaN(results[5])) node.outMin = results[5];
                if (!isNaN(results[6])) node.outMax = results[6];
                if (!isNaN(results[7])) node.maxChange = results[7];
                if (results[8] != null) node.run = results[8];  
                
                if (!isNaN(results[3])) {
                    node.setpoint = results[3];
                    // Sync raw value immediately so rate limiter has the correct target
                    node.setpointRaw = results[3]; 
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
            if (isNaN(node.kp) || !isFinite(node.kp)) node.kp = 0;
            if (isNaN(node.ki) || !isFinite(node.ki)) node.ki = 0;
            if (isNaN(node.kd) || !isFinite(node.kd)) node.kd = 0;
            if (isNaN(node.setpoint) || !isFinite(node.setpoint)) node.setpoint = 0;
            if (isNaN(node.setpointRaw) || !isFinite(node.setpointRaw)) node.setpointRaw = 0;
            if (isNaN(node.deadband) || !isFinite(node.deadband)) node.deadband = 0;
            if (isNaN(node.maxChange) || !isFinite(node.maxChange)) node.maxChange = 0;
            if (isNaN(node.setpointRateLimit) || !isFinite(node.setpointRateLimit)) node.setpointRateLimit = 0;
            if (node.outMin !== null && (isNaN(node.outMin) || !isFinite(node.outMin))) node.outMin = null;
            if (node.outMax !== null && (isNaN(node.outMax) || !isFinite(node.outMax))) node.outMax = null;
            
            // Validate config
            if (node.deadband < 0 || node.maxChange < 0) {
                utils.setStatusError(node, "invalid deadband or maxChange");
                node.deadband = node.maxChange = 0;
            }
            if (node.outMin != null && node.outMax != null && node.outMax <= node.outMin) {
                utils.setStatusError(node, "invalid output range");
                node.outMin = node.outMax = null;
            }
            if (!["ReturnToZero", "HoldLastResult"].includes(node.dbBehavior)) {
                utils.setStatusError(node, "invalid dbBehavior");
                node.dbBehavior = "ReturnToZero";
            }

            // ================================================================
            // Handle context updates - msg.context allows dynamic parameter changes
            // Supports: setpoint, kp, ki, kd, deadband, outMin, outMax, maxChange,
            //           run, directAction, dbBehavior, reset, tune
            // ================================================================
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }
                if (typeof msg.context !== "string") {
                    utils.setStatusError(node, "invalid context");
                    if (done) done();
                    return;
                }
                if (["setpoint", "kp", "ki", "kd", "deadband", "outMin", "outMax", "maxChange", "setpointRateLimit"].includes(msg.context)) {
                    let value = parseFloat(msg.payload);
                    if (isNaN(value) || !isFinite(value)) {
                        utils.setStatusError(node, `invalid ${msg.context}`);
                        if (done) done();
                        return;
                    }
                    if ((msg.context === "deadband" || msg.context === "maxChange" || msg.context === "setpointRateLimit") && value < 0) {
                        utils.setStatusError(node, `invalid ${msg.context}`);
                        if (done) done();
                        return;
                    }
                    if (msg.context === "setpoint") {
                        // Store raw setpoint value for rate limiting
                        node.setpointRaw = value;
                    } else {
                        node[msg.context] = value;
                    }
                    if (msg.context === "outMin" || msg.context === "outMax") {
                        if (node.outMin != null && node.outMax != null && node.outMax <= node.outMin) {
                            utils.setStatusError(node, "invalid output range");
                            if (done) done();
                            return;
                        }
                    }
                    utils.setStatusOK(node, `${msg.context}: ${value.toFixed(2)}`);
                    if (done) done();
                    return;
                } else if (["run", "directAction"].includes(msg.context)) {
                    if (typeof msg.payload !== "boolean") {
                        utils.setStatusError(node, `invalid ${msg.context}`);
                        if (done) done();
                        return;
                    }
                    node[msg.context] = msg.payload;
                    utils.setStatusOK(node, `${msg.context}: ${msg.payload}`);
                    if (done) done();
                    return;
                } else if (msg.context === "dbBehavior") {
                    if (!["ReturnToZero", "HoldLastResult"].includes(msg.payload)) {
                        utils.setStatusError(node, "invalid dbBehavior");
                        if (done) done();
                        return;
                    }
                    node.dbBehavior = msg.payload;
                    utils.setStatusOK(node, `dbBehavior: ${msg.payload}`);
                    if (done) done();
                    return;
                } else if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        utils.setStatusError(node, "invalid reset");
                        if (done) done();
                        return;
                    }
                    node.errorSum = 0;
                    node.lastError = 0;
                    node.lastDError = 0;
                    node.result = 0;
                    node.tuneMode = false;
                    node.tuneData = { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 };
                    utils.setStatusOK(node, "reset");
                    if (done) done();
                    return;
                    if (done) done();
                    return;
                } else if (msg.context === "tune") {
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        utils.setStatusError(node, "invalid tune command");
                        if (done) done();
                        return;
                    }
                    node.tuneMode = true;
                    node.tuneData = { relayOutput: 1, peaks: [], lastPeak: null, lastTrough: null, oscillationCount: 0, startTime: null, Ku: 0, Tu: 0 };
                    node.errorSum = 0;
                    node.lastError = 0;
                    utils.setStatusBusy(node, "tune: starting relay auto-tuning...");
                    if (done) done();
                    return;
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
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
                inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            let input;
            
            if (inputValue === undefined || inputValue === null) {
                utils.setStatusError(node, "missing or invalid input property");
                input = 0;  // Failsafe: output 0 instead of NaN
            } else {
                input = parseFloat(inputValue);
                if (isNaN(input) || !isFinite(input)) {
                    utils.setStatusError(node, "invalid input property");
                    input = 0;  // Failsafe: output 0 instead of NaN
                }
            }

            // ================================================================
            // Calculate time elapsed since last execution (interval in seconds)
            // This is critical: PID gains are time-dependent
            // ================================================================
            let currentTime = Date.now();
            let interval = (currentTime - node.lastTime) / 1000; // Convert to seconds
            node.lastTime = currentTime;

            let outputMsg = { payload: 0 };
            outputMsg.diagnostics = { 
                setpoint: node.setpoint,
                interval,
                lastOutput,
                run: node.run, 
                directAction: node.directAction,
                kp: node.kp, 
                ki: node.ki, 
                kd: node.kd 
            };

            // ================================================================
            // Early exit conditions - skip PID calculation if:
            // - Controller not running (run=false)
            // - interval <= 0: First execution, no time elapsed
            // - interval > 60: Time jump detected (clock adjustment, suspend/resume)
            // - Kp = 0: No proportional gain, no control possible
            // ================================================================
            if (!node.run || interval <= 0 || interval > 60 || node.kp === 0) {
                if (lastOutput !== 0) {
                    lastOutput = 0;
                    utils.setStatusChanged(node, `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.setpoint.toFixed(2)}`);
                } else {
                    utils.setStatusUnchanged(node, `in: ${input.toFixed(2)}, out: 0.00, setpoint: ${node.setpoint.toFixed(2)}`);
                }
                send(outputMsg);
                if (done) done();
                return;
            }

            // ================================================================
            // Deadband check - zone around setpoint where no output is generated
            // This prevents oscillation when input is very close to target
            // ================================================================
            if (node.deadband !== 0 && input <= node.setpoint + node.deadband && input >= node.setpoint - node.deadband) {
                // Reset derivative term to prevent kick when exiting deadband
                // Without this, large derivative spike occurs on deadband exit
                node.lastDError = 0;
                outputMsg.payload = node.dbBehavior === "ReturnToZero" ? 0 : node.result;
                const outputChanged = !lastOutput || lastOutput !== outputMsg.payload;
                if (outputChanged) {
                    lastOutput = outputMsg.payload;
                    utils.setStatusChanged(node, `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.setpoint.toFixed(2)}`);
                    send(outputMsg);
                } else {
                    utils.setStatusUnchanged(node, `in: ${input.toFixed(2)}, out: ${outputMsg.payload.toFixed(2)}, setpoint: ${node.setpoint.toFixed(2)}`);
                }
                if (done) done();
                return;
            }

            // ================================================================
            // Update integral constraint limits when gains or output limits change
            // This rescales the accumulated error (errorSum) proportionally
            // ================================================================
            if (node.kp !== storekp || node.ki !== storeki || node.outMin !== storeOutMin || node.outMax !== storeOutMax) {
                if (node.kp !== storekp && node.kp !== 0 && storekp !== 0) {
                    node.errorSum = node.errorSum * storekp / node.kp;
                }
                if (node.ki !== storeki && node.ki !== 0 && storeki !== 0) {
                    node.errorSum = node.errorSum * storeki / node.ki;
                }
                kpkiConst = node.kp * node.ki;
                minInt = kpkiConst === 0 ? 0 : (node.outMin || -Infinity) * kpkiConst;
                maxInt = kpkiConst === 0 ? 0 : (node.outMax || Infinity) * kpkiConst;
                storekp = node.kp;
                storeki = node.ki;
                storeOutMin = node.outMin;
                storeOutMax = node.outMax;
            }

            // ================================================================
            // Apply setpoint rate limiting to prevent integrator wind-up and thermal shock
            // Smoothly ramps setpoint changes at configured rate (units per second)
            // ================================================================
            if (node.setpointRateLimit > 0) {
                let setpointChange = node.setpointRaw - node.setpoint;
                let maxAllowedChange = node.setpointRateLimit * interval;
                
                if (Math.abs(setpointChange) > maxAllowedChange) {
                    // Ramp setpoint towards target at limited rate
                    node.setpoint += Math.sign(setpointChange) * maxAllowedChange;
                } else {
                    // Close enough to target, snap to it
                    node.setpoint = node.setpointRaw;
                }
            } else {
                // No rate limiting, use raw setpoint directly
                node.setpoint = node.setpointRaw;
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
            let error = node.directAction ? (input - node.setpoint) : (node.setpoint - input);

            // ================================================================
            // Relay Auto-Tuning (Improved Ziegler-Nichols)
            // Uses bang-bang relay control to find the critical oscillation point
            // More robust than manual Kp adjustment
            // ================================================================
            if (node.tuneMode) {
                // Initialize relay tuning on first call
                if (node.tuneData.startTime === null) {
                    node.tuneData.startTime = currentTime;
                    node.tuneData.relayOutput = 1;  // Start with output high
                    node.errorSum = 0;  // Reset integral during tuning
                    node.lastError = error;
                }

                // Apply relay control: output swings between min and max based on error sign
                if (error > node.deadband) {
                    node.tuneData.relayOutput = -1;  // Error positive: apply cooling
                } else if (error < -node.deadband) {
                    node.tuneData.relayOutput = 1;  // Error negative: apply heating
                }

                // Detect peaks and troughs in the error signal
                if (node.lastError > 0 && error <= 0) {  // Peak
                    if (node.tuneData.lastPeak !== null) {
                        node.tuneData.peaks.push({ type: 'peak', value: node.tuneData.lastPeak, time: currentTime });
                    }
                    node.tuneData.lastPeak = node.lastError;
                    node.tuneData.oscillationCount++;
                } else if (node.lastError < 0 && error >= 0) {  // Trough
                    if (node.tuneData.lastTrough !== null) {
                        node.tuneData.peaks.push({ type: 'trough', value: node.tuneData.lastTrough, time: currentTime });
                    }
                    node.tuneData.lastTrough = node.lastError;
                    node.tuneData.oscillationCount++;
                }

                // Use relay output as PID result during tuning
                let relayAmplitude = Math.abs((node.outMax || 100) - (node.outMin || 0)) / 2;
                node.result = node.tuneData.relayOutput > 0 ? relayAmplitude : -relayAmplitude;

                // Check if we have enough oscillations to calculate Tu and Ku
                if (node.tuneData.peaks.length >= 4) {
                    // Calculate ultimate period (Tu) from peak-to-peak distances
                    let periodSum = 0;
                    for (let i = 2; i < node.tuneData.peaks.length; i++) {
                        periodSum += (node.tuneData.peaks[i].time - node.tuneData.peaks[i-2].time) / 1000;
                    }
                    node.tuneData.Tu = (2 * periodSum) / (node.tuneData.peaks.length - 2);  // Average full period

                    // Calculate ultimate gain (Ku) from relay amplitude and peak error amplitude
                    let peakErrors = node.tuneData.peaks.map(p => Math.abs(p.value));
                    let avgPeakError = peakErrors.reduce((a, b) => a + b, 0) / peakErrors.length;
                    node.tuneData.Ku = relayAmplitude / (avgPeakError || 0.1);

                    // Apply Ziegler-Nichols for conservative "no overshoot" response
                    node.kp = 0.2 * node.tuneData.Ku;
                    node.ki = 0.4 * node.kp / node.tuneData.Tu;
                    node.kd = 0.066 * node.kp * node.tuneData.Tu;

                    node.tuneMode = false;
                    outputMsg.payload = 0;
                    outputMsg.tuneResult = {
                        method: 'relay-auto-tune',
                        Kp: node.kp,
                        Ki: node.ki,
                        Kd: node.kd,
                        Ku: node.tuneData.Ku,
                        Tu: node.tuneData.Tu,
                        oscillations: node.tuneData.oscillationCount
                    };
                    lastOutput = 0;
                    utils.setStatusOK(node, `tune: completed, Kp=${node.kp.toFixed(2)}, Ki=${node.ki.toFixed(2)}, Kd=${node.kd.toFixed(2)}`);

                    send(outputMsg);
                    if (done) done();
                    return;
                } else {
                    // Still tuning - show progress
                    utils.setStatusBusy(node, `tune: measuring oscillations (${node.tuneData.oscillationCount} half-cycles)...`);
                }
            }

            // ================================================================
            // Integral Term (I in PID)
            // Accumulates error over time to eliminate steady-state error
            // ================================================================
            // Integral term with anti-windup to prevent excessive accumulation
            if (node.ki !== 0) {
                // Add this interval's error contribution to accumulated error
                node.errorSum += interval * error;
                // Clamp integral to prevent wind-up (integrator saturation)
                // Keeps errorSum within limits based on output range and gains
                node.errorSum = Math.min(Math.max(node.errorSum, minInt / (node.kp * node.ki || 1)), maxInt / (node.kp * node.ki || 1));
            }

            // ================================================================
            // Calculate the three PID terms
            // P term: proportional to current error
            // I term: proportional to accumulated error over time
            // D term: proportional to rate of change of error (filtered to prevent noise)
            // ================================================================
            // P term (proportional) - immediate response to error
            let pGain = node.kp * error;
            
            // I term (integral) - eliminates steady-state error
            // Note: Kp is NOT applied here (already in errorSum constraint calculation)
            let intGain = node.ki !== 0 ? node.kp * node.ki * node.errorSum : 0;
            
            // D term (derivative) - dampening, anticipates error changes
            // Raw derivative can be noisy, so we filter it (0.1 new + 0.9 old = low-pass filter)
            let dRaw = (error - node.lastError) / interval;  // Rate of change of error
            let dFiltered = node.kd !== 0 ? 0.1 * dRaw + 0.9 * node.lastDError : 0;  // Low-pass filtered
            let dGain = node.kd !== 0 ? node.kp * node.kd * dFiltered : 0;

            // Store current values for next iteration's derivative calculation
            node.lastError = error;
            node.lastDError = dFiltered;

            // ================================================================
            // Combine PID terms and apply output limits
            // ================================================================
            // Sum all three terms (P + I + D) to get raw output
            let pv = pGain + intGain + dGain;
            // Note: directAction flag determines error calculation sign:
            //   - false (reverse action): error = setpoint - input (for heating applications)
            //   - true (direct action): error = input - setpoint (for cooling applications)
            // Clamp output to min/max bounds (hard limits)
            pv = Math.min(Math.max(pv, node.outMin), node.outMax);

            // ================================================================
            // Rate-of-change limiting (maxChange) - prevents sudden jumps
            // Useful for preventing shock to equipment or actuators
            // maxChange = units per second (e.g., 10 = max 10 units/sec ramp)
            // ================================================================
            if (node.maxChange !== 0) {
                // Check how much output would change this interval
                if (node.result > pv) {
                    // Output would decrease - limit ramp down
                    node.result = (node.result - pv > node.maxChange) ? node.result - node.maxChange : pv;
                } else {
                    // Output would increase - limit ramp up
                    node.result = (pv - node.result > node.maxChange) ? node.result + node.maxChange : pv;
                }
            } else {
                // No rate limiting - use PID output directly
                node.result = pv;
            }
            
            // Re-apply hard output limits after rate-of-change limiting
            // Ensures final result never exceeds configured bounds regardless of maxChange ramp
            node.result = Math.min(Math.max(node.result, node.outMin), node.outMax);

            // Set output payload
            outputMsg.payload = node.result;
            
            // Safety check: ensure payload is never NaN
            if (isNaN(outputMsg.payload) || !isFinite(outputMsg.payload)) {
                outputMsg.payload = 0;
                utils.setStatusError(node, "NaN detected, output forced to 0");
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
                errorSum: node.errorSum,  // Accumulated integral error
                run: node.run,   // Controller enabled?
                directAction: node.directAction,  // Direct/Reverse action mode
                kp: node.kp,     // Proportional gain
                ki: node.ki,     // Integral gain
                kd: node.kd      // Derivative gain
            };

            // ================================================================
            // Update node status - show current state to user
            // ================================================================
            // Update status to show current input, output, and setpoint values
            utils.setStatusChanged(node, `in: ${input.toFixed(2)}, out: ${node.result.toFixed(2)}, setpoint: ${node.setpoint.toFixed(2)}`);
            
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