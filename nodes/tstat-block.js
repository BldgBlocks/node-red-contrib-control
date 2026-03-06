// ============================================================================
// Tstat Block - Thermostat Controller
// ============================================================================
// Controls heating/cooling calls based on temperature input and setpoints.
// Works as a companion to changeover-block: changeover selects the mode,
// tstat generates the actual heating/cooling call signals.
//
// Supports three algorithms:
//   - single:    one setpoint ± diff/2 defines on/off thresholds
//   - split:     separate heating/cooling setpoints with diff hysteresis
//   - specified: explicit on/off temperatures for heating and cooling
//
// Outputs (3 ports):
//   1. isHeating (boolean) - current mode passthrough
//   2. above (boolean) - cooling call active
//   3. below (boolean) - heating call active
//
// Anticipator adjusts turn-off points to prevent overshoot.
// ignoreAnticipatorCycles disables anticipator after mode changes.
// All configuration via typed inputs (editor, msg, flow, global).
// ============================================================================

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    const VALID_ALGORITHMS = ["single", "split", "specified"];

    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        // ====================================================================
        // Configuration — safe parseFloat that doesn't clobber zero
        // ====================================================================
        const num = (v, fallback) => { const n = parseFloat(v); return isNaN(n) ? fallback : n; };

        node.name = config.name;
        node.setpoint = num(config.setpoint, 70);
        node.heatingSetpoint = num(config.heatingSetpoint, 68);
        node.coolingSetpoint = num(config.coolingSetpoint, 74);
        node.coolingOn = num(config.coolingOn, 74);
        node.coolingOff = num(config.coolingOff, 72);
        node.heatingOff = num(config.heatingOff, 68);
        node.heatingOn = num(config.heatingOn, 66);
        node.diff = num(config.diff, 2);
        node.anticipator = num(config.anticipator, 0.5);
        node.ignoreAnticipatorCycles = Math.floor(num(config.ignoreAnticipatorCycles, 1));
        node.isHeating = config.isHeating === true || config.isHeating === "true";
        node.algorithm = VALID_ALGORITHMS.includes(config.algorithm) ? config.algorithm : "single";

        // Startup delay: suppress above/below calls until mode has settled
        node.startupDelay = Math.max(num(config.startupDelay, 30), 0);
        node.startupComplete = node.startupDelay === 0;
        node.startupTimer = null;
        if (!node.startupComplete) {
            utils.setStatusWarn(node, `startup delay: ${node.startupDelay}s`);
            node.startupTimer = setTimeout(() => {
                node.startupComplete = true;
                node.startupTimer = null;
                utils.setStatusOK(node, "startup delay complete");
            }, node.startupDelay * 1000);
        }

        // ====================================================================
        // Runtime state
        // ====================================================================
        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;
        let lastIsHeating = null;
        let cyclesSinceModeChange = 0;
        let modeChanged = false;

        // ====================================================================
        // Typed-input evaluation helpers
        // ====================================================================
        function evalNumeric(configValue, configType, fallback, msg) {
            return utils.evaluateNodeProperty(configValue, configType, node, msg)
                .then(val => { const n = parseFloat(val); return isNaN(n) ? fallback : n; })
                .catch(() => fallback);
        }

        function evalBool(configValue, configType, fallback, msg) {
            return utils.evaluateNodeProperty(configValue, configType, node, msg)
                .then(val => {
                    if (typeof val === "boolean") return val;
                    if (val === "true") return true;
                    if (val === "false") return false;
                    return fallback;
                })
                .catch(() => fallback);
        }

        function evalEnum(configValue, configType, allowed, fallback, msg) {
            return utils.evaluateNodeProperty(configValue, configType, node, msg)
                .then(val => allowed.includes(val) ? val : fallback)
                .catch(() => fallback);
        }

        // ====================================================================
        // Main input handler
        // ====================================================================
        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // ----------------------------------------------------------------
            // 1. Evaluate typed inputs (async phase)
            // ----------------------------------------------------------------
            if (node.isBusy) {
                utils.setStatusBusy(node, "busy - dropped msg");
                if (done) done();
                return;
            }
            node.isBusy = true;

            try {
                const results = await Promise.all([
                    evalNumeric(config.setpoint,                config.setpointType,                node.setpoint,                msg),  // 0
                    evalNumeric(config.heatingSetpoint,          config.heatingSetpointType,          node.heatingSetpoint,          msg),  // 1
                    evalNumeric(config.coolingSetpoint,          config.coolingSetpointType,          node.coolingSetpoint,          msg),  // 2
                    evalNumeric(config.coolingOn,                config.coolingOnType,                node.coolingOn,                msg),  // 3
                    evalNumeric(config.coolingOff,               config.coolingOffType,               node.coolingOff,               msg),  // 4
                    evalNumeric(config.heatingOff,               config.heatingOffType,               node.heatingOff,               msg),  // 5
                    evalNumeric(config.heatingOn,                config.heatingOnType,                node.heatingOn,                msg),  // 6
                    evalNumeric(config.diff,                     config.diffType,                     node.diff,                     msg),  // 7
                    evalNumeric(config.anticipator,              config.anticipatorType,              node.anticipator,              msg),  // 8
                    evalNumeric(config.ignoreAnticipatorCycles,  config.ignoreAnticipatorCyclesType,  node.ignoreAnticipatorCycles,  msg),  // 9
                    evalBool(config.isHeating,                   config.isHeatingType,                node.isHeating,                msg),  // 10
                    evalEnum(config.algorithm, config.algorithmType, VALID_ALGORITHMS, node.algorithm, msg),  // 11
                ]);

                node.setpoint                = results[0];
                node.heatingSetpoint         = results[1];
                node.coolingSetpoint         = results[2];
                node.coolingOn               = results[3];
                node.coolingOff              = results[4];
                node.heatingOff              = results[5];
                node.heatingOn               = results[6];
                node.diff                    = results[7];
                node.anticipator             = results[8];
                node.ignoreAnticipatorCycles  = Math.floor(results[9]);
                node.isHeating               = results[10];
                node.algorithm               = results[11];

            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                node.isBusy = false;
            }

            // ----------------------------------------------------------------
            // 2. Validate constraints
            // ----------------------------------------------------------------
            if (node.diff < 0.01) {
                utils.setStatusError(node, "diff must be >= 0.01");
                if (done) done();
                return;
            }

            // ----------------------------------------------------------------
            // 4. Read temperature from msg.payload
            // ----------------------------------------------------------------
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                utils.setStatusError(node, "invalid payload");
                if (done) done();
                return;
            }

            // ----------------------------------------------------------------
            // 4. Anticipator mode-change logic
            // ----------------------------------------------------------------
            if (lastIsHeating !== null && node.isHeating !== lastIsHeating) {
                modeChanged = true;
                cyclesSinceModeChange = 0;
            }
            lastIsHeating = node.isHeating;
            if ((below && !lastBelow) || (above && !lastAbove)) {
                cyclesSinceModeChange++;
            }

            let effectiveAnticipator = node.anticipator;
            if (modeChanged && node.ignoreAnticipatorCycles > 0 && cyclesSinceModeChange <= node.ignoreAnticipatorCycles) {
                effectiveAnticipator = 0;
            }
            if (cyclesSinceModeChange > node.ignoreAnticipatorCycles) {
                modeChanged = false;
            }

            lastAbove = above;
            lastBelow = below;

            // ----------------------------------------------------------------
            // 5. Thermostat logic — compute above/below calls
            // ----------------------------------------------------------------
            let activeSetpoint = 0;
            let onThreshold = 0;
            let offThreshold = 0;

            if (node.algorithm === "single") {
                const delta = node.diff / 2;
                activeSetpoint = node.setpoint;

                if (node.isHeating) {
                    onThreshold = node.setpoint - delta;
                    offThreshold = node.setpoint - effectiveAnticipator;
                    if (input < onThreshold) {
                        below = true;
                    } else if (below && input > offThreshold) {
                        below = false;
                    }
                    above = false;
                } else {
                    onThreshold = node.setpoint + delta;
                    offThreshold = node.setpoint + effectiveAnticipator;
                    if (input > onThreshold) {
                        above = true;
                    } else if (above && input < offThreshold) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "split") {
                if (node.isHeating) {
                    const delta = node.diff / 2;
                    activeSetpoint = node.heatingSetpoint;
                    onThreshold = node.heatingSetpoint - delta;
                    offThreshold = node.heatingSetpoint - effectiveAnticipator;
                    if (input < onThreshold) {
                        below = true;
                    } else if (below && input > offThreshold) {
                        below = false;
                    }
                    above = false;
                } else {
                    const delta = node.diff / 2;
                    activeSetpoint = node.coolingSetpoint;
                    onThreshold = node.coolingSetpoint + delta;
                    offThreshold = node.coolingSetpoint + effectiveAnticipator;
                    if (input > onThreshold) {
                        above = true;
                    } else if (above && input < offThreshold) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "specified") {
                if (node.isHeating) {
                    activeSetpoint = node.heatingOn;
                    onThreshold = node.heatingOn;
                    offThreshold = node.heatingOff - effectiveAnticipator;
                    if (input < onThreshold) {
                        below = true;
                    } else if (below && input > offThreshold) {
                        below = false;
                    }
                    above = false;
                } else {
                    activeSetpoint = node.coolingOn;
                    onThreshold = node.coolingOn;
                    offThreshold = node.coolingOff + effectiveAnticipator;
                    if (input > onThreshold) {
                        above = true;
                    } else if (above && input < offThreshold) {
                        above = false;
                    }
                    below = false;
                }
            }

            // ----------------------------------------------------------------
            // 6. Startup suppression
            // ----------------------------------------------------------------
            // Prevent call state from accumulating during startup.
            // Without this, above/below can latch ON while output is
            // suppressed, then emit a false call the moment startup ends.
            if (!node.startupComplete) {
                above = false;
                below = false;
            }
            const outputAbove = node.startupComplete ? above : false;
            const outputBelow = node.startupComplete ? below : false;

            // ----------------------------------------------------------------
            // 7. Build and send outputs
            // ----------------------------------------------------------------
            const statusInfo = {
                algorithm: node.algorithm,
                input,
                isHeating: node.isHeating,
                above: outputAbove,
                below: outputBelow,
                activeSetpoint,
                onThreshold,
                offThreshold,
                diff: node.diff,
                anticipator: node.anticipator,
                effectiveAnticipator,
                modeChanged,
                cyclesSinceModeChange
            };

            send([
                { payload: node.isHeating, status: statusInfo },
                { payload: outputAbove, status: statusInfo },
                { payload: outputBelow, status: statusInfo }
            ]);

            // ----------------------------------------------------------------
            // 8. Status display
            // ----------------------------------------------------------------
            const mode = node.isHeating ? "heat" : "cool";
            const call = node.isHeating ? outputBelow : outputAbove;
            const threshold = node.isHeating
                ? `<${onThreshold.toFixed(1)}`
                : `>${onThreshold.toFixed(1)}`;
            const suffix = !node.startupComplete ? " [startup]" : "";
            let thresholdText, hysteresisText;
            if (node.isHeating) {
                thresholdText = `<${onThreshold.toFixed(1)}`;
                if (outputBelow && input > onThreshold && input <= offThreshold) {
                    hysteresisText = ` (holding, off at >${offThreshold.toFixed(1)})`;
                } else if (outputBelow && input < onThreshold) {
                    hysteresisText = " (on)";
                } else if (!outputBelow && input > offThreshold) {
                    hysteresisText = " (off)";
                } else {
                    hysteresisText = "";
                }
            } else {
                thresholdText = `>${onThreshold.toFixed(1)}`;
                if (outputAbove && input < onThreshold && input >= offThreshold) {
                    hysteresisText = ` (holding, off at <${offThreshold.toFixed(1)})`;
                } else if (outputAbove && input > onThreshold) {
                    hysteresisText = " (on)";
                } else if (!outputAbove && input < offThreshold) {
                    hysteresisText = " (off)";
                } else {
                    hysteresisText = "";
                }
            }
            const text = `${input.toFixed(1)}° ${thresholdText} [${mode}] call:${call}${hysteresisText}${suffix}`;

            if (outputAbove === lastAbove && outputBelow === lastBelow) {
                utils.setStatusUnchanged(node, text);
            } else {
                utils.setStatusChanged(node, text);
            }

            if (done) done();
        });

        // ====================================================================
        // Cleanup
        // ====================================================================
        node.on("close", function(done) {
            if (node.startupTimer) {
                clearTimeout(node.startupTimer);
                node.startupTimer = null;
            }
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);
};
