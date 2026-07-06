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
    const VALID_OPERATION_MODES = ["auto", "heat", "cool", "off"];
    const STATE_HEATING = "heating";
    const STATE_COOLING = "cooling";
    const STATE_OFF = "off";

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
        node.operationMode = VALID_OPERATION_MODES.includes(config.operationMode) ? config.operationMode : "auto";
        node.heartbeatTimeoutSec = Math.max(num(config.heartbeatTimeoutSec, 0), 0);
        node.heartbeatTimer = null;
        node.lastPayloadTs = null;
        node.failsafeOff = false;

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
        let lastInput = null;
        let runtimeState = STATE_OFF;
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

        function computeThresholds(anticipatorValue) {
            if (node.algorithm === "single") {
                const delta = node.diff / 2;
                return {
                    heatOn: node.setpoint - delta,
                    heatOff: node.setpoint - anticipatorValue,
                    coolOn: node.setpoint + delta,
                    coolOff: node.setpoint + anticipatorValue
                };
            }

            if (node.algorithm === "split") {
                const delta = node.diff / 2;
                return {
                    heatOn: node.heatingSetpoint - delta,
                    heatOff: node.heatingSetpoint - anticipatorValue,
                    coolOn: node.coolingSetpoint + delta,
                    coolOff: node.coolingSetpoint + anticipatorValue
                };
            }

            return {
                heatOn: node.heatingOn,
                heatOff: node.heatingOff - anticipatorValue,
                coolOn: node.coolingOn,
                coolOff: node.coolingOff + anticipatorValue
            };
        }

        function resolveRuntimeMode(modeValue, isHeatingValue) {
            if (modeValue === "heat") {
                return { operationMode: "heat", isHeating: true };
            }
            if (modeValue === "cool") {
                return { operationMode: "cool", isHeating: false };
            }
            if (modeValue === "off") {
                return { operationMode: "off", isHeating: false };
            }
            return { operationMode: "auto", isHeating: isHeatingValue };
        }

        function resolveControlState(operationMode, isHeatingValue, failsafeOff) {
            if (failsafeOff || operationMode === "off") {
                return STATE_OFF;
            }
            if (operationMode === "heat") {
                return STATE_HEATING;
            }
            if (operationMode === "cool") {
                return STATE_COOLING;
            }
            return isHeatingValue ? STATE_HEATING : STATE_COOLING;
        }

        runtimeState = resolveControlState(node.operationMode, node.isHeating, node.failsafeOff);

        function clearHeartbeatTimer() {
            if (node.heartbeatTimer) {
                clearTimeout(node.heartbeatTimer);
                node.heartbeatTimer = null;
            }
        }

        function triggerHeartbeatFailsafe() {
            node.heartbeatTimer = null;
            const previousState = runtimeState;
            const previousAbove = above;
            const previousBelow = below;

            if (node.heartbeatTimeoutSec <= 0) return;
            if (previousState === STATE_OFF && !above && !below) return;

            node.failsafeOff = true;
            runtimeState = resolveControlState(node.operationMode, node.isHeating, node.failsafeOff);

            above = false;
            below = false;
            lastAbove = false;
            lastBelow = false;
            lastIsHeating = null;
            modeChanged = false;
            cyclesSinceModeChange = 0;

            const statusInput = lastInput;
            const nowSec = Date.now() / 1000;
            const staleAgeSec = node.lastPayloadTs ? Math.max(0, nowSec - node.lastPayloadTs) : null;
            const effectiveThresholds = computeThresholds(0);

            const statusInfo = {
                algorithm: node.algorithm,
                input: statusInput,
                mode: runtimeState,
                operationMode: node.operationMode,
                isHeating: false,
                above: false,
                below: false,
                activeSetpoint: null,
                onThreshold: null,
                offThreshold: null,
                diff: node.diff,
                anticipator: node.anticipator,
                effectiveAnticipator: 0,
                heatOn: effectiveThresholds.heatOn,
                heatOff: effectiveThresholds.heatOff,
                coolOn: effectiveThresholds.coolOn,
                coolOff: effectiveThresholds.coolOff,
                modeChanged: true,
                cyclesSinceModeChange: 0,
                failsafeOff: true,
                staleAgeSec,
                heartbeatTimeoutSec: node.heartbeatTimeoutSec
            };

            const comfortInfo = {
                source: "tstat",
                mode: STATE_OFF,
                temperature: statusInput,
                heatingThreshold: effectiveThresholds.heatOn,
                coolingThreshold: effectiveThresholds.coolOn,
                callActive: false,
                callMode: "off"
            };

            node.send([
                { payload: false, status: statusInfo, comfort: comfortInfo },
                { payload: false, status: statusInfo, comfort: comfortInfo },
                { payload: false, status: statusInfo, comfort: comfortInfo }
            ]);

            const fmt = (value) => (typeof value === "number" ? value.toFixed(1) : "?");
            const staleText = typeof staleAgeSec === "number" ? staleAgeSec.toFixed(0) : "?";
            const text = `OFF ${fmt(statusInput)} stale ${staleText}s timeout ${node.heartbeatTimeoutSec.toFixed(0)}s`;
            if (previousState === runtimeState && previousAbove === false && previousBelow === false) {
                utils.setStatusUnchanged(node, text);
            } else {
                utils.setStatusChanged(node, text);
            }
        }

        function armHeartbeatTimer() {
            if (node.heartbeatTimeoutSec <= 0) return;
            clearHeartbeatTimer();
            node.heartbeatTimer = setTimeout(triggerHeartbeatFailsafe, node.heartbeatTimeoutSec * 1000);
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
                    evalEnum(config.operationMode, config.operationModeType, VALID_OPERATION_MODES, node.operationMode, msg),  // 12
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
                node.ignoreAnticipatorCycles = Math.max(0, Math.floor(results[9]));
                node.isHeating               = results[10];
                node.algorithm               = results[11];
                const runtimeMode = resolveRuntimeMode(results[12], node.isHeating);
                node.operationMode = runtimeMode.operationMode;
                node.isHeating = runtimeMode.isHeating;

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

            const previousAbove = above;
            const previousBelow = below;
            const previousState = runtimeState;
            const previousFailsafeOff = node.failsafeOff;

            // ----------------------------------------------------------------
            // 4. Read temperature from msg.payload
            // ----------------------------------------------------------------
            let input = null;
            const hasPayload = msg.hasOwnProperty("payload");
            if (hasPayload) {
                input = parseFloat(msg.payload);
                if (isNaN(input)) {
                    utils.setStatusError(node, "invalid payload");
                    if (done) done();
                    return;
                }
                lastInput = input;
                node.lastPayloadTs = Date.now() / 1000;
                node.failsafeOff = false;
                armHeartbeatTimer();
            } else if (node.operationMode !== "off") {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            } else {
                input = lastInput;
            }

            // ----------------------------------------------------------------
            // 4. Anticipator mode-change logic
            // ----------------------------------------------------------------
            let effectiveAnticipator = node.anticipator;
            let effectiveThresholds = computeThresholds(effectiveAnticipator);
            let activeSetpoint = null;
            let onThreshold = null;
            let offThreshold = null;
            const runState = resolveControlState(node.operationMode, node.isHeating, node.failsafeOff);
            const isOffState = runState === STATE_OFF;
            const isHeatingState = runState === STATE_HEATING;

            if (isOffState) {
                above = false;
                below = false;
                lastAbove = false;
                lastBelow = false;
                lastIsHeating = null;
                modeChanged = false;
                cyclesSinceModeChange = 0;
                effectiveAnticipator = 0;
                effectiveThresholds = computeThresholds(0);
            } else {
                if (previousState !== runState) {
                    modeChanged = true;
                    cyclesSinceModeChange = 0;
                    above = false;
                    below = false;
                    lastAbove = false;
                    lastBelow = false;
                } else if (lastIsHeating !== null && isHeatingState !== lastIsHeating) {
                    modeChanged = true;
                    cyclesSinceModeChange = 0;
                }
                lastIsHeating = isHeatingState;
                if ((below && !lastBelow) || (above && !lastAbove)) {
                    cyclesSinceModeChange++;
                }

                if (modeChanged && node.ignoreAnticipatorCycles > 0 && cyclesSinceModeChange <= node.ignoreAnticipatorCycles) {
                    effectiveAnticipator = 0;
                }
                if (cyclesSinceModeChange > node.ignoreAnticipatorCycles) {
                    modeChanged = false;
                }

                lastAbove = above;
                lastBelow = below;
                effectiveThresholds = computeThresholds(effectiveAnticipator);

                // ------------------------------------------------------------
                // 5. Thermostat logic — compute above/below calls
                // ------------------------------------------------------------
                if (node.algorithm === "single") {
                    activeSetpoint = node.setpoint;

                    if (isHeatingState) {
                        onThreshold = effectiveThresholds.heatOn;
                        offThreshold = node.setpoint - effectiveAnticipator;
                        if (input < onThreshold) {
                            below = true;
                        } else if (below && input > offThreshold) {
                            below = false;
                        }
                        above = false;
                    } else {
                        onThreshold = effectiveThresholds.coolOn;
                        offThreshold = node.setpoint + effectiveAnticipator;
                        if (input > onThreshold) {
                            above = true;
                        } else if (above && input < offThreshold) {
                            above = false;
                        }
                        below = false;
                    }
                } else if (node.algorithm === "split") {
                    if (isHeatingState) {
                        activeSetpoint = node.heatingSetpoint;
                        onThreshold = effectiveThresholds.heatOn;
                        offThreshold = node.heatingSetpoint - effectiveAnticipator;
                        if (input < onThreshold) {
                            below = true;
                        } else if (below && input > offThreshold) {
                            below = false;
                        }
                        above = false;
                    } else {
                        activeSetpoint = node.coolingSetpoint;
                        onThreshold = effectiveThresholds.coolOn;
                        offThreshold = node.coolingSetpoint + effectiveAnticipator;
                        if (input > onThreshold) {
                            above = true;
                        } else if (above && input < offThreshold) {
                            above = false;
                        }
                        below = false;
                    }
                } else if (node.algorithm === "specified") {
                    if (isHeatingState) {
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
            }
            runtimeState = runState;

            // ----------------------------------------------------------------
            // 6. Startup suppression
            // ----------------------------------------------------------------
            // Prevent call state from accumulating during startup.
            // Without this, above/below can latch ON while output is
            // suppressed, then emit a false call the moment startup ends.
            if (!node.startupComplete && !isOffState) {
                above = false;
                below = false;
            }
            const outputAbove = isOffState ? false : (node.startupComplete ? above : false);
            const outputBelow = isOffState ? false : (node.startupComplete ? below : false);
            const outputIsHeating = runtimeState === STATE_HEATING;

            // ----------------------------------------------------------------
            // 7. Build and send outputs
            // ----------------------------------------------------------------
            const operationState = runtimeState;
            const statusInput = input !== null ? input : lastInput;
            const staleAgeSec = node.lastPayloadTs ? Math.max(0, (Date.now() / 1000) - node.lastPayloadTs) : null;
            const statusInfo = {
                algorithm: node.algorithm,
                input: statusInput,
                mode: operationState,
                operationMode: node.operationMode,
                isHeating: outputIsHeating,
                above: outputAbove,
                below: outputBelow,
                activeSetpoint,
                onThreshold,
                offThreshold,
                diff: node.diff,
                anticipator: node.anticipator,
                effectiveAnticipator,
                heatOn: effectiveThresholds.heatOn,
                heatOff: effectiveThresholds.heatOff,
                coolOn: effectiveThresholds.coolOn,
                coolOff: effectiveThresholds.coolOff,
                modeChanged,
                cyclesSinceModeChange,
                failsafeOff: node.failsafeOff,
                staleAgeSec,
                heartbeatTimeoutSec: node.heartbeatTimeoutSec
            };

            const comfortInfo = {
                source: "tstat",
                mode: operationState,
                temperature: statusInput,
                heatingThreshold: effectiveThresholds.heatOn,
                coolingThreshold: effectiveThresholds.coolOn,
                callActive: outputAbove || outputBelow,
                callMode: isOffState ? "off" : outputBelow ? "heating" : outputAbove ? "cooling" : "idle"
            };

            send([
                { payload: outputIsHeating, status: statusInfo, comfort: comfortInfo },
                { payload: outputAbove, status: statusInfo, comfort: comfortInfo },
                { payload: outputBelow, status: statusInfo, comfort: comfortInfo }
            ]);

            // ----------------------------------------------------------------
            // 8. Status display
            // ----------------------------------------------------------------
            const fmt = (value) => (typeof value === "number" ? value.toFixed(1) : "?");
            const suffix = (!node.startupComplete && !isOffState) ? " [startup]" : "";
            let text;
            if (isOffState) {
                if (node.failsafeOff) {
                    const staleText = typeof staleAgeSec === "number" ? staleAgeSec.toFixed(0) : "?";
                    text = `OFF ${fmt(statusInput)} stale ${staleText}s timeout ${node.heartbeatTimeoutSec.toFixed(0)}s`;
                } else {
                    text = `OFF ${fmt(statusInput)} calls disabled`;
                }
            } else {
                const mode = outputIsHeating ? "H" : "C";
                const heatOff = statusInfo.heatOff;
                const coolOff = statusInfo.coolOff;
                text = `${mode} ${fmt(statusInput)} h+${fmt(statusInfo.heatOn)} h-${fmt(heatOff)} c+${fmt(statusInfo.coolOn)} c-${fmt(coolOff)}${suffix}`;
            }

            if (
                outputAbove === previousAbove &&
                outputBelow === previousBelow &&
                runtimeState === previousState &&
                node.failsafeOff === previousFailsafeOff
            ) {
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
            clearHeartbeatTimer();
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);
};
