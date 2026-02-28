// ============================================================================
// Changeover Block - HVAC Heating/Cooling Mode Selector
// ============================================================================
// Determines whether an HVAC system should be in heating or cooling mode
// based on temperature input and setpoint configuration.
//
// Supports three algorithms:
//   - single:    one setpoint ± deadband/2 defines heating/cooling thresholds
//   - split:     separate heating/cooling setpoints with extent buffer
//   - specified: explicit heatingOn/coolingOn trigger temperatures
//
// Operation modes:
//   - auto: temperature-driven switching with swap timer to prevent cycling
//   - heat: locked to heating regardless of temperature
//   - cool: locked to cooling regardless of temperature
//
// All configuration is via typed inputs (editor, msg, flow, global).
// ============================================================================

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    const VALID_MODES = ["auto", "heat", "cool"];
    const VALID_ALGORITHMS = ["single", "split", "specified"];
    const MIN_SWAP_TIME = 60; // seconds

    function ChangeoverBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Configuration — static defaults parsed from editor config
        // ====================================================================
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";

        // Use helper to avoid || clobbering legitimate zero values
        const num = (v, fallback) => { const n = parseFloat(v); return isNaN(n) ? fallback : n; };

        node.setpoint = num(config.setpoint, 70);
        node.heatingSetpoint = num(config.heatingSetpoint, 68);
        node.coolingSetpoint = num(config.coolingSetpoint, 74);
        node.heatingOn = num(config.heatingOn, 66);
        node.coolingOn = num(config.coolingOn, 74);
        node.deadband = num(config.deadband, 2);
        node.extent = num(config.extent, 1);
        node.swapTime = num(config.swapTime, 300);
        node.minTempSetpoint = num(config.minTempSetpoint, 55);
        node.maxTempSetpoint = num(config.maxTempSetpoint, 90);
        node.initWindow = num(config.initWindow, 10);

        // Enum typed inputs: when type is dynamic (msg/flow/global), config value
        // holds the property PATH, not a valid enum value — default safely.
        node.algorithm = VALID_ALGORITHMS.includes(config.algorithm) ? config.algorithm : "single";
        node.operationMode = VALID_MODES.includes(config.operationMode) ? config.operationMode : "auto";

        // ====================================================================
        // Runtime state
        // ====================================================================
        node.currentMode = node.operationMode === "cool" ? "cooling" : "heating";
        node.lastTemperature = null;
        node.lastModeChange = 0;
        node.isBusy = false;

        let initComplete = false;
        let conditionStartTime = null;
        let pendingMode = null;
        const initStartTime = Date.now() / 1000;

        // ====================================================================
        // Typed-input evaluation helpers
        // ====================================================================
        function evalNumeric(configValue, configType, fallback, msg) {
            return utils.evaluateNodeProperty(configValue, configType, node, msg)
                .then(val => { const n = parseFloat(val); return isNaN(n) ? fallback : n; })
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
            // 1. Evaluate typed inputs (async phase — acquire busy lock)
            // ----------------------------------------------------------------
            if (node.isBusy) {
                utils.setStatusBusy(node, "busy - dropped msg");
                if (done) done();
                return;
            }
            node.isBusy = true;

            try {
                const results = await Promise.all([
                    evalNumeric(config.setpoint,         config.setpointType,         node.setpoint,         msg),  // 0
                    evalNumeric(config.heatingSetpoint,   config.heatingSetpointType,  node.heatingSetpoint,  msg),  // 1
                    evalNumeric(config.coolingSetpoint,   config.coolingSetpointType,  node.coolingSetpoint,  msg),  // 2
                    evalNumeric(config.heatingOn,         config.heatingOnType,        node.heatingOn,        msg),  // 3
                    evalNumeric(config.coolingOn,         config.coolingOnType,        node.coolingOn,        msg),  // 4
                    evalNumeric(config.deadband,          config.deadbandType,         node.deadband,         msg),  // 5
                    evalNumeric(config.extent,            config.extentType,           node.extent,           msg),  // 6
                    evalNumeric(config.swapTime,          config.swapTimeType,         node.swapTime,         msg),  // 7
                    evalNumeric(config.minTempSetpoint,   config.minTempSetpointType,  node.minTempSetpoint,  msg),  // 8
                    evalNumeric(config.maxTempSetpoint,   config.maxTempSetpointType,  node.maxTempSetpoint,  msg),  // 9
                    evalEnum(config.algorithm,      config.algorithmType,     VALID_ALGORITHMS, node.algorithm,     msg),  // 10
                    evalEnum(config.operationMode,  config.operationModeType, VALID_MODES,      node.operationMode, msg),  // 11
                ]);

                node.setpoint         = results[0];
                node.heatingSetpoint  = results[1];
                node.coolingSetpoint  = results[2];
                node.heatingOn        = results[3];
                node.coolingOn        = results[4];
                node.deadband         = results[5];
                node.extent           = results[6];
                node.swapTime         = results[7];
                node.minTempSetpoint  = results[8];
                node.maxTempSetpoint  = results[9];
                node.algorithm        = results[10];
                node.operationMode    = results[11];

            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                node.isBusy = false;
            }

            // ----------------------------------------------------------------
            // 2. Enforce constraints
            // ----------------------------------------------------------------
            if (node.swapTime < MIN_SWAP_TIME) {
                node.swapTime = MIN_SWAP_TIME;
            }
            if (node.deadband <= 0) {
                utils.setStatusError(node, "deadband must be > 0");
                if (done) done();
                return;
            }
            if (node.extent < 0) {
                utils.setStatusError(node, "extent must be >= 0");
                if (done) done();
                return;
            }
            if (node.maxTempSetpoint <= node.minTempSetpoint) {
                utils.setStatusError(node, "maxTempSetpoint must be > minTempSetpoint");
                if (done) done();
                return;
            }
            if (node.algorithm === "split" && node.coolingSetpoint <= node.heatingSetpoint) {
                utils.setStatusError(node, "coolingSetpoint must be > heatingSetpoint");
                if (done) done();
                return;
            }
            if (node.algorithm === "specified" && node.coolingOn <= node.heatingOn) {
                utils.setStatusError(node, "coolingOn must be > heatingOn");
                if (done) done();
                return;
            }

            // ----------------------------------------------------------------
            // 3. Lock currentMode for explicit heat/cool operation modes
            // ----------------------------------------------------------------
            if (node.operationMode === "heat") {
                node.currentMode = "heating";
                conditionStartTime = null;
                pendingMode = null;
            } else if (node.operationMode === "cool") {
                node.currentMode = "cooling";
                conditionStartTime = null;
                pendingMode = null;
            }

            // ----------------------------------------------------------------
            // 4. Read temperature from msg
            // ----------------------------------------------------------------
            let input;
            try {
                input = parseFloat(RED.util.getMessageProperty(msg, node.inputProperty));
            } catch (e) {
                input = NaN;
            }
            if (isNaN(input)) {
                utils.setStatusError(node, "missing or invalid temperature");
                if (done) done();
                return;
            }
            node.lastTemperature = input;

            // ----------------------------------------------------------------
            // 5. Init window — wait for sensors to stabilize
            // ----------------------------------------------------------------
            const now = Date.now() / 1000;
            if (!initComplete) {
                if (now - initStartTime >= node.initWindow) {
                    initComplete = true;
                    evaluateInitialMode();
                } else {
                    updateStatus();
                    if (done) done();
                    return;
                }
            }

            // ----------------------------------------------------------------
            // 6. Evaluate mode (auto switching with swap timer)
            // ----------------------------------------------------------------
            evaluateState();

            // ----------------------------------------------------------------
            // 7. Build and send output
            // ----------------------------------------------------------------
            send(buildOutputs(msg));
            updateStatus();
            if (done) done();
        });

        // ====================================================================
        // Calculate thresholds for the current algorithm
        // ====================================================================
        function getThresholds() {
            switch (node.algorithm) {
                case "single":
                    return {
                        heating: node.setpoint - node.deadband / 2,
                        cooling: node.setpoint + node.deadband / 2
                    };
                case "split":
                    return {
                        heating: node.heatingSetpoint - node.extent,
                        cooling: node.coolingSetpoint + node.extent
                    };
                case "specified":
                    return {
                        heating: node.heatingOn,
                        cooling: node.coolingOn
                    };
                default:
                    return {
                        heating: node.setpoint - node.deadband / 2,
                        cooling: node.setpoint + node.deadband / 2
                    };
            }
        }

        // ====================================================================
        // Initial mode — set immediately without swap timer
        // ====================================================================
        function evaluateInitialMode() {
            if (node.lastTemperature === null) return;
            if (node.operationMode !== "auto") return; // already locked

            const { heating, cooling } = getThresholds();
            if (node.lastTemperature < heating) {
                node.currentMode = "heating";
            } else if (node.lastTemperature > cooling) {
                node.currentMode = "cooling";
            }
            node.lastModeChange = Date.now() / 1000;
        }

        // ====================================================================
        // Auto-mode state evaluation with swap timer
        // ====================================================================
        function evaluateState() {
            if (!initComplete) return;
            if (node.operationMode !== "auto") return; // locked modes handled in step 3
            if (node.lastTemperature === null) return;

            const now = Date.now() / 1000;
            const { heating, cooling } = getThresholds();

            // Determine what mode temperature demands
            let desiredMode = node.currentMode;
            if (node.lastTemperature < heating) {
                desiredMode = "heating";
            } else if (node.lastTemperature > cooling) {
                desiredMode = "cooling";
            }

            if (desiredMode !== node.currentMode) {
                // Temperature demands a mode change — apply swap timer
                if (pendingMode !== desiredMode) {
                    // New pending direction — start the countdown
                    conditionStartTime = now;
                    pendingMode = desiredMode;
                } else if (conditionStartTime && now - conditionStartTime >= node.swapTime) {
                    // Countdown expired — execute the swap
                    node.currentMode = desiredMode;
                    node.lastModeChange = now;
                    conditionStartTime = null;
                    pendingMode = null;
                }
                // else: still counting down — do nothing
            } else {
                // Temperature no longer demands a change — cancel any pending swap
                conditionStartTime = null;
                pendingMode = null;
            }
        }

        // ====================================================================
        // Build output message
        // ====================================================================
        function buildOutputs(msg) {
            const isHeating = node.currentMode === "heating";
            const { heating: effectiveHeating, cooling: effectiveCooling } = getThresholds();

            // Preserve all original message properties (e.g., singleSetpoint, splitHeatingSetpoint)
            // and add/overwrite changeover-specific fields
            msg.payload = node.lastTemperature;
            msg.isHeating = isHeating;
            msg.status = {
                mode: node.currentMode,
                operationMode: node.operationMode,
                isHeating,
                heatingSetpoint: effectiveHeating,
                coolingSetpoint: effectiveCooling,
                temperature: node.lastTemperature
            };

            return [msg];
        }

        // ====================================================================
        // Node status display
        // ====================================================================
        function updateStatus() {
            const now = Date.now() / 1000;
            const isHeating = node.currentMode === "heating";

            if (!initComplete) {
                const remaining = Math.max(0, node.initWindow - (now - initStartTime));
                utils.setStatusBusy(node, `init ${remaining.toFixed(0)}s [${node.operationMode}] ${node.currentMode}`);
                return;
            }

            const temp = node.lastTemperature !== null ? node.lastTemperature.toFixed(1) : "?";
            const { heating, cooling } = getThresholds();
            let thresholdText, hysteresisText;
            if (isHeating) {
                thresholdText = `<${cooling.toFixed(1)}`;
                if (node.lastTemperature !== null && node.lastTemperature < cooling) {
                    hysteresisText = " (on)";
                } else if (node.lastTemperature !== null && node.lastTemperature >= heating && node.lastTemperature < cooling) {
                    hysteresisText = ` (holding, swap at >${heating.toFixed(1)})`;
                } else if (node.lastTemperature !== null && node.lastTemperature >= cooling) {
                    hysteresisText = " (off)";
                } else {
                    hysteresisText = "";
                }
            } else {
                thresholdText = `>${heating.toFixed(1)}`;
                if (node.lastTemperature !== null && node.lastTemperature > heating) {
                    hysteresisText = " (on)";
                } else if (node.lastTemperature !== null && node.lastTemperature <= cooling && node.lastTemperature > heating) {
                    hysteresisText = ` (holding, swap at <${cooling.toFixed(1)})`;
                } else if (node.lastTemperature !== null && node.lastTemperature <= heating) {
                    hysteresisText = " (off)";
                } else {
                    hysteresisText = "";
                }
            }
            let text = `${temp}° ${thresholdText} [${node.operationMode}] ${node.currentMode}${hysteresisText}`;

            if (pendingMode && conditionStartTime) {
                const remaining = Math.max(0, node.swapTime - (now - conditionStartTime));
                text += ` → ${pendingMode} ${remaining.toFixed(0)}s`;
            }

            if (now - node.lastModeChange < 1) {
                utils.setStatusChanged(node, text);
            } else {
                utils.setStatusUnchanged(node, text);
            }
        }

        // ====================================================================
        // Cleanup
        // ====================================================================
        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("changeover-block", ChangeoverBlockNode);
};