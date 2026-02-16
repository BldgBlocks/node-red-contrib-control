// ============================================================================
// Call Status Block - Equipment Call/Status Monitor
// ============================================================================
// Monitors call and status signals to detect equipment faults, communication
// losses, and synchronization errors.
//
// State machine: IDLE → WAITING_FOR_STATUS → RUNNING → STATUS_LOST
//
// Both "call" and "status" are typed inputs — they can come from msg properties,
// flow variables, global variables, or static boolean values.
//
// On every incoming message:
//   1. Evaluate call value from typed input
//   2. Evaluate status value from typed input
//   3. Process state transitions and alarm conditions
//
// Alarm conditions:
//   - No status received within statusTimeout after call activates
//   - Status lost during active call (goes false or heartbeat expires)
//   - Status remains active after call deactivates (equipment stuck)
//   - Status active without any call (unexpected equipment activity)
// ============================================================================

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ====================================================================
        // Configuration — safe parse helpers
        // ====================================================================
        const num = (v, fallback) => { const n = parseFloat(v); return isNaN(n) ? fallback : n; };

        node.name = config.name;
        node.isBusy = false;

        node.config = {
            statusTimeout: Math.max(num(config.statusTimeout, 30), 0.01),
            heartbeatTimeout: Math.max(num(config.heartbeatTimeout, 0), 0),  // 0 = disabled
            clearDelay: Math.max(num(config.clearDelay, 10), 0),
            debounce: Math.max(num(config.debounce, 0), 0),  // ms, 0 = disabled
            runLostStatus: config.runLostStatus === true,
            noStatusOnRun: config.noStatusOnRun !== false,
            statusWithoutCall: config.statusWithoutCall !== false,
            runLostStatusMessage: config.runLostStatusMessage || "Status lost during run",
            noStatusOnRunMessage: config.noStatusOnRunMessage || "No status received during run",
            statusWithoutCallMessage: config.statusWithoutCallMessage || "Status active without call"
        };

        // ====================================================================
        // Runtime state
        // ====================================================================
        node.requestedState = false;      // What we want equipment to do (call)
        node.actualState = false;         // What equipment is actually doing (status)
        node.alarm = false;
        node.alarmMessage = "";
        node.lastStatusTime = null;
        node.neverReceivedStatus = true;

        // ====================================================================
        // Timer management
        // ====================================================================
        node.initialStatusTimer = null;   // Timeout waiting for first status response
        node.heartbeatTimer = null;       // Continuous heartbeat verification timer
        node.statusLostTimer = null;      // Hysteresis timer for status lost alarm
        node.inactiveStatusTimer = null;  // Timer to verify status goes inactive
        node.clearTimer = null;           // Timer to clear state after call ends
        node.debounceTimer = null;        // Debounce status flicker

        // ====================================================================
        // State machine
        // ====================================================================
        const STATES = {
            IDLE: "IDLE",
            WAITING_FOR_STATUS: "WAITING_FOR_STATUS",
            RUNNING: "RUNNING",
            STATUS_LOST: "STATUS_LOST"
        };

        function getCurrentState() {
            if (!node.requestedState) {
                return STATES.IDLE;
            }
            if (node.requestedState && node.neverReceivedStatus) {
                return STATES.WAITING_FOR_STATUS;
            }
            if (node.requestedState && node.actualState) {
                return STATES.RUNNING;
            }
            if (node.requestedState && !node.actualState && !node.neverReceivedStatus) {
                return STATES.STATUS_LOST;
            }
            return STATES.IDLE;
        }

        // ====================================================================
        // Typed-input evaluation helpers
        // ====================================================================
        function evalBool(configValue, configType, fallback, msg) {
            return utils.evaluateNodeProperty(configValue, configType, node, msg)
                .then(val => {
                    if (typeof val === "boolean") return val;
                    if (val === "true" || val === 1) return true;
                    if (val === "false" || val === 0) return false;
                    return fallback;
                })
                .catch(() => fallback);
        }

        // ====================================================================
        // Output builder
        // ====================================================================
        function buildOutput() {
            return {
                payload: node.requestedState,
                status: {
                    call: node.requestedState,
                    status: node.actualState,
                    alarm: node.alarm,
                    alarmMessage: node.alarmMessage
                },
                diagnostics: {
                    state: getCurrentState(),
                    initialTimeout: !!node.initialStatusTimer,
                    heartbeatActive: !!node.heartbeatTimer,
                    neverReceivedStatus: node.neverReceivedStatus,
                    lastStatusTime: node.lastStatusTime,
                    timeSinceLastStatus: node.lastStatusTime ? Date.now() - node.lastStatusTime : null
                }
            };
        }

        // ====================================================================
        // Status display
        // ====================================================================
        function updateNodeStatus() {
            const state = getCurrentState();
            let text;

            if (node.alarm) {
                text = `ALARM: ${node.alarmMessage} | call:${node.requestedState} status:${node.actualState}`;
                utils.setStatusError(node, text);
            } else if (state === STATES.WAITING_FOR_STATUS) {
                text = `call:ON status:WAITING | initial timeout`;
                utils.setStatusBusy(node, text);
            } else if (node.requestedState && node.actualState && node.heartbeatTimer) {
                text = `call:ON status:ON | running heartbeat:${node.config.heartbeatTimeout}s`;
                utils.setStatusOK(node, text);
            } else if (node.requestedState && node.actualState) {
                text = `call:ON status:ON | running`;
                utils.setStatusOK(node, text);
            } else if (!node.requestedState && node.actualState) {
                text = `call:OFF status:ON | waiting for deactivation`;
                utils.setStatusWarn(node, text);
            } else if (node.requestedState && !node.actualState && !node.neverReceivedStatus) {
                text = `call:ON status:OFF | status lost`;
                utils.setStatusWarn(node, text);
            } else if (!node.requestedState && !node.actualState) {
                text = `call:OFF status:OFF | idle`;
                utils.setStatusUnchanged(node, text);
            } else {
                text = `call:OFF status:OFF | idle`;
                utils.setStatusUnchanged(node, text);
            }
        }

        // ====================================================================
        // Timer management
        // ====================================================================
        function clearAllTimers() {
            if (node.initialStatusTimer) { clearTimeout(node.initialStatusTimer); node.initialStatusTimer = null; }
            if (node.heartbeatTimer) { clearTimeout(node.heartbeatTimer); node.heartbeatTimer = null; }
            if (node.statusLostTimer) { clearTimeout(node.statusLostTimer); node.statusLostTimer = null; }
            if (node.inactiveStatusTimer) { clearTimeout(node.inactiveStatusTimer); node.inactiveStatusTimer = null; }
            if (node.clearTimer) { clearTimeout(node.clearTimer); node.clearTimer = null; }
            if (node.debounceTimer) { clearTimeout(node.debounceTimer); node.debounceTimer = null; }
        }

        // ====================================================================
        // Heartbeat monitoring — continuous status freshness check
        // ====================================================================
        function startHeartbeatMonitoring(send) {
            if (!node.config.heartbeatTimeout || node.config.heartbeatTimeout <= 0) {
                return;  // Heartbeat monitoring disabled
            }

            if (node.heartbeatTimer) {
                clearTimeout(node.heartbeatTimer);
            }

            node.heartbeatTimer = setTimeout(() => {
                node.heartbeatTimer = null;

                // Only alarm if call is still active
                if (!node.requestedState) return;

                const timeSinceLastUpdate = node.lastStatusTime
                    ? Date.now() - node.lastStatusTime
                    : Infinity;

                if (timeSinceLastUpdate > node.config.heartbeatTimeout * 1000) {
                    // Status hasn't been refreshed within heartbeat window
                    if (node.config.runLostStatus) {
                        node.alarm = true;
                        node.alarmMessage = node.config.runLostStatusMessage;
                        send(buildOutput());
                        updateNodeStatus();
                    }
                } else {
                    // Status was refreshed recently, schedule next check
                    startHeartbeatMonitoring(send);
                }
            }, node.config.heartbeatTimeout * 1000);
        }

        // ====================================================================
        // Inactive status monitoring — verify equipment deactivates
        // ====================================================================
        function startInactiveStatusMonitoring(send) {
            if (node.inactiveStatusTimer) {
                clearTimeout(node.inactiveStatusTimer);
            }

            node.inactiveStatusTimer = setTimeout(() => {
                node.inactiveStatusTimer = null;
                if (!node.requestedState && node.actualState) {
                    node.alarm = true;
                    node.alarmMessage = "Status not clearing after call deactivated";
                    send(buildOutput());
                    updateNodeStatus();
                }
            }, (node.config.clearDelay + 1) * 1000);
        }

        // ====================================================================
        // Process call state change
        // ====================================================================
        function processCallChange(newCall, send) {
            if (newCall === node.requestedState) {
                return false;  // No change
            }

            node.requestedState = newCall;

            if (node.requestedState) {
                // === Call activated ===
                node.neverReceivedStatus = true;
                node.alarm = false;
                node.alarmMessage = "";

                // Clear timers from previous cycle
                clearAllTimers();

                // Start timeout waiting for initial status response
                if (node.config.noStatusOnRun) {
                    node.initialStatusTimer = setTimeout(() => {
                        node.initialStatusTimer = null;
                        if (node.neverReceivedStatus && node.requestedState) {
                            node.alarm = true;
                            node.alarmMessage = node.config.noStatusOnRunMessage;
                            send(buildOutput());
                            updateNodeStatus();
                        }
                    }, node.config.statusTimeout * 1000);
                }
            } else {
                // === Call deactivated ===
                if (node.initialStatusTimer) { clearTimeout(node.initialStatusTimer); node.initialStatusTimer = null; }
                if (node.heartbeatTimer) { clearTimeout(node.heartbeatTimer); node.heartbeatTimer = null; }
                if (node.statusLostTimer) { clearTimeout(node.statusLostTimer); node.statusLostTimer = null; }

                // Monitor that status goes inactive
                if (node.actualState) {
                    startInactiveStatusMonitoring(send);
                }

                // Schedule clear of state after delay
                if (node.config.clearDelay > 0) {
                    node.clearTimer = setTimeout(() => {
                        node.clearTimer = null;
                        node.actualState = false;
                        node.alarm = false;
                        node.alarmMessage = "";
                        node.neverReceivedStatus = true;
                        send(buildOutput());
                        updateNodeStatus();
                    }, node.config.clearDelay * 1000);
                } else {
                    node.actualState = false;
                    node.alarm = false;
                    node.alarmMessage = "";
                    node.neverReceivedStatus = true;
                }
            }

            return true;  // State changed
        }

        // ====================================================================
        // Process status update (after debounce, if applicable)
        // ====================================================================
        function processStatusChange(newStatus, send) {
            node.actualState = newStatus;

            // Clear status lost hysteresis on status going true
            if (node.statusLostTimer && newStatus === true) {
                clearTimeout(node.statusLostTimer);
                node.statusLostTimer = null;
            }

            // If call active and status true → running, start heartbeat
            if (node.requestedState && newStatus) {
                node.alarm = false;
                node.alarmMessage = "";
                startHeartbeatMonitoring(send);
            }

            // If call active and status went false → status lost alarm
            if (node.requestedState && !newStatus && node.config.runLostStatus) {
                node.statusLostTimer = setTimeout(() => {
                    node.statusLostTimer = null;
                    if (node.requestedState && !node.actualState) {
                        node.alarm = true;
                        node.alarmMessage = node.config.runLostStatusMessage;
                        send(buildOutput());
                        updateNodeStatus();
                    }
                }, 100);  // 100ms hysteresis
            }

            // If call inactive and status goes false → all clear
            if (!node.requestedState && !newStatus) {
                if (node.inactiveStatusTimer) {
                    clearTimeout(node.inactiveStatusTimer);
                    node.inactiveStatusTimer = null;
                }
                node.alarm = false;
                node.alarmMessage = "";
            }

            // If status active without call and no clearTimer running → unexpected
            if (!node.requestedState && newStatus && !node.clearTimer && node.config.statusWithoutCall) {
                node.statusLostTimer = setTimeout(() => {
                    node.statusLostTimer = null;
                    if (node.actualState && !node.requestedState) {
                        node.alarm = true;
                        node.alarmMessage = node.config.statusWithoutCallMessage;
                        send(buildOutput());
                        updateNodeStatus();
                    }
                }, 100);  // 100ms hysteresis
            }

            return true;
        }

        // ====================================================================
        // Process status with heartbeat refresh and optional debounce
        //
        // CRITICAL: lastStatusTime must be updated on EVERY status=true receipt,
        // even if the value hasn't changed. Without this, heartbeat monitoring
        // would alarm despite equipment continuously reporting status=true.
        //
        // neverReceivedStatus is only cleared when status=true is received,
        // not when status=false comes in (false doesn't confirm equipment ran).
        // ====================================================================
        function processStatus(newStatus, send) {
            // Only mark as "received" and update timestamp when status is true
            // A false status doesn't confirm the equipment responded
            if (newStatus === true) {
                node.lastStatusTime = Date.now();
                node.neverReceivedStatus = false;

                // Clear initial timeout — we received a positive status response
                if (node.initialStatusTimer) {
                    clearTimeout(node.initialStatusTimer);
                    node.initialStatusTimer = null;
                }
            }

            // If value hasn't changed (or reverted back), cancel any pending
            // debounce and just refresh heartbeat timer (no output)
            if (newStatus === node.actualState) {
                // Cancel pending debounce — the transient change reverted
                if (node.debounceTimer) {
                    clearTimeout(node.debounceTimer);
                    node.debounceTimer = null;
                }

                // CRITICAL: If alarm is active and we receive status=true with
                // call active, clear the alarm. The heartbeat timer sets alarm
                // without changing actualState, so we must recover here.
                if (node.alarm && newStatus && node.requestedState) {
                    node.alarm = false;
                    node.alarmMessage = "";
                    startHeartbeatMonitoring(send);
                    return true;  // Changed (alarm cleared) — caller should send
                }

                if (node.requestedState && node.actualState && node.config.heartbeatTimeout > 0) {
                    startHeartbeatMonitoring(send);
                }
                return false;  // No change — caller decides whether to send
            }

            // Value changed — apply debounce if configured
            if (node.config.debounce > 0) {
                if (node.debounceTimer) {
                    clearTimeout(node.debounceTimer);
                }
                node.debounceTimer = setTimeout(() => {
                    node.debounceTimer = null;
                    processStatusChange(newStatus, send);
                    send(buildOutput());
                    updateNodeStatus();
                }, node.config.debounce);
                return false;  // Will send after debounce
            } else {
                // No debounce — process immediately
                processStatusChange(newStatus, send);
                return true;  // Changed — caller should send
            }
        }

        // ====================================================================
        // Reset all state
        // ====================================================================
        function resetState(send) {
            clearAllTimers();
            node.requestedState = false;
            node.actualState = false;
            node.alarm = false;
            node.alarmMessage = "";
            node.lastStatusTime = null;
            node.neverReceivedStatus = true;
            utils.setStatusOK(node, "state reset");
            send(buildOutput());
        }

        // ====================================================================
        // Initial status
        // ====================================================================
        utils.setStatusUnchanged(node, "call:OFF status:OFF | idle");

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

            // Handle reset context (project convention)
            if (msg.hasOwnProperty("context") && msg.context === "reset") {
                if (msg.payload === true) {
                    resetState(send);
                } else {
                    utils.setStatusError(node, "invalid reset");
                }
                if (done) done();
                return;
            }

            // ----------------------------------------------------------------
            // 1. Evaluate typed inputs (async phase — acquire busy lock)
            // ----------------------------------------------------------------
            if (node.isBusy) {
                utils.setStatusBusy(node);
                if (done) done();
                return;
            }
            node.isBusy = true;

            let callValue, statusValue;
            try {
                const results = await Promise.all([
                    evalBool(config.callValue, config.callValueType, node.requestedState, msg),
                    evalBool(config.statusValue, config.statusValueType, node.actualState, msg),
                ]);
                callValue = results[0];
                statusValue = results[1];
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                utils.setStatusError(node, `eval error: ${err.message}`);
                if (done) done();
                return;
            } finally {
                node.isBusy = false;
            }

            // ----------------------------------------------------------------
            // 2. Process call and status values
            // ----------------------------------------------------------------

            // Track whether call is being deactivated (before processCallChange modifies state)
            const callJustDeactivated = !callValue && node.requestedState;

            // Process call first (may start/stop timers that status needs)
            processCallChange(callValue, send);

            // Process status (handles heartbeat refresh, debounce, alarms)
            // Skip status processing if call was just deactivated with clearDelay=0
            // (state was already fully cleared by processCallChange)
            if (!(callJustDeactivated && node.config.clearDelay === 0)) {
                processStatus(statusValue, send);
            }

            // Always send current state output on every message
            send(buildOutput());
            updateNodeStatus();
            if (done) done();
        });

        // ====================================================================
        // Cleanup
        // ====================================================================
        node.on("close", function(done) {
            clearAllTimers();
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);
};
