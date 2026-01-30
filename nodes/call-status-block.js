module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // State management
        node.requestedState = false;      // What we want equipment to do (call)
        node.actualState = false;         // What equipment is actually doing (status)
        node.alarm = false;
        node.alarmMessage = "";
        node.lastStatusTime = null;
        node.neverReceivedStatus = true;  // Track if status arrived during this call
        
        // Timer management
        node.initialStatusTimer = null;   // Initial timeout waiting for first status response
        node.heartbeatTimer = null;       // Continuous heartbeat verification timer
        node.statusLostTimer = null;      // Hysteresis timer for status lost alarm
        node.inactiveStatusTimer = null;  // Timer to verify status goes inactive when call=false
        node.clearTimer = null;           // Timer to clear state after call ends
        node.debounceTimer = null;        // Debounce status flicker

        // State machine states
        const STATES = {
            IDLE: "IDLE",
            WAITING_FOR_STATUS: "WAITING_FOR_STATUS",
            RUNNING: "RUNNING",
            STATUS_LOST: "STATUS_LOST",
            SHUTDOWN: "SHUTDOWN"
        };

        // Configuration with defaults and validation
        node.config = {
            inputProperty: config.inputProperty || "payload",
            statusInputProperty: config.statusInputProperty || "status",
            statusTimeout: Math.max(parseFloat(config.statusTimeout) || 30, 0.01),
            heartbeatTimeout: Math.max(parseFloat(config.heartbeatTimeout) || 30, 0),  // 0 = disabled
            clearDelay: Math.max(parseFloat(config.clearDelay) || 10, 0),
            debounce: Math.max(parseFloat(config.debounce) || 100, 0),  // ms
            runLostStatus: config.runLostStatus === true,
            noStatusOnRun: config.noStatusOnRun === true,
            runLostStatusMessage: config.runLostStatusMessage || "Status lost during run",
            noStatusOnRunMessage: config.noStatusOnRunMessage || "No status received during run"
        };

        /**
         * Get the current state machine state
         */
        function getCurrentState() {
            if (!node.requestedState) {
                return STATES.IDLE;
            }
            if (node.requestedState && node.neverReceivedStatus && node.initialStatusTimer) {
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

        /**
         * Build the output message
         */
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

        /**
         * Update node status indicator
         */
        function updateNodeStatus() {
            const state = getCurrentState();
            const timeSince = node.lastStatusTime ? Math.round((Date.now() - node.lastStatusTime) / 1000) : '-';
            let text;

            if (node.alarm) {
                text = `${state} | ALARM: ${node.alarmMessage}`;
                utils.setStatusError(node, text);
            } else if (node.heartbeatTimer && node.requestedState && node.actualState) {
                text = `${state} | call:ON status:ON heartbeat:${timeSince}s | monitoring`;
                utils.setStatusBusy(node, text);
            } else if (node.inactiveStatusTimer && !node.requestedState && node.actualState) {
                text = `${state} | call:OFF status:ON | waiting for deactivation`;
                utils.setStatusBusy(node, text);
            } else if (node.initialStatusTimer) {
                text = `${state} | call:ON status:WAITING | initial timeout`;
                utils.setStatusBusy(node, text);
            } else if (node.requestedState && node.actualState) {
                text = `${state} | call:ON status:ON heartbeat:${timeSince}s | running`;
                utils.setStatusOK(node, text);
            } else if (node.requestedState && !node.actualState) {
                text = `${state} | call:ON status:OFF | off`;
                utils.setStatusUnchanged(node, text);
            } else if (!node.requestedState && !node.actualState) {
                text = `${state} | call:OFF status:OFF | idle`;
                utils.setStatusUnchanged(node, text);
            } else {
                text = `${state} | call:${node.requestedState} status:${node.actualState}`;
                utils.setStatusUnchanged(node, text);
            }
        }

        /**
         * Clear all timers
         */
        function clearAllTimers() {
            if (node.initialStatusTimer) {
                clearTimeout(node.initialStatusTimer);
                node.initialStatusTimer = null;
            }
            if (node.heartbeatTimer) {
                clearTimeout(node.heartbeatTimer);
                node.heartbeatTimer = null;
            }
            if (node.statusLostTimer) {
                clearTimeout(node.statusLostTimer);
                node.statusLostTimer = null;
            }
            if (node.inactiveStatusTimer) {
                clearTimeout(node.inactiveStatusTimer);
                node.inactiveStatusTimer = null;
            }
            if (node.clearTimer) {
                clearTimeout(node.clearTimer);
                node.clearTimer = null;
            }
            if (node.debounceTimer) {
                clearTimeout(node.debounceTimer);
                node.debounceTimer = null;
            }
        }

        /**
         * Start heartbeat verification timer
         */
        function startHeartbeatMonitoring(send) {
            if (!node.config.heartbeatTimeout || node.config.heartbeatTimeout <= 0) {
                return;  // Heartbeat monitoring disabled
            }

            if (node.heartbeatTimer) {
                clearTimeout(node.heartbeatTimer);
            }

            node.heartbeatTimer = setTimeout(() => {
                // Check if status has been updated within the heartbeat window
                const timeSinceLastUpdate = node.lastStatusTime ? Date.now() - node.lastStatusTime : Infinity;
                
                if (node.requestedState && node.actualState && timeSinceLastUpdate > node.config.heartbeatTimeout * 1000) {
                    // Status hasn't been updated within heartbeat window - arm the alarm
                    if (!node.statusLostTimer && node.config.runLostStatus) {
                        // Start hysteresis timer before alarming
                        node.statusLostTimer = setTimeout(() => {
                            if (node.requestedState && !node.actualState && node.lastStatusTime && 
                                (Date.now() - node.lastStatusTime > node.config.heartbeatTimeout * 1000)) {
                                node.alarm = true;
                                node.alarmMessage = node.config.runLostStatusMessage;
                                send(buildOutput());
                                updateNodeStatus();
                            }
                            node.statusLostTimer = null;
                        }, 500);  // 500ms hysteresis
                    }
                }

                // Restart heartbeat timer
                node.heartbeatTimer = null;
                startHeartbeatMonitoring(send);
            }, node.config.heartbeatTimeout * 1000);
        }

        /**
         * Start timer to verify status goes inactive when call is inactive
         */
        function startInactiveStatusMonitoring(send) {
            if (node.inactiveStatusTimer) {
                clearTimeout(node.inactiveStatusTimer);
            }

            // When call=false but status=true, monitor with hysteresis
            node.inactiveStatusTimer = setTimeout(() => {
                if (!node.requestedState && node.actualState) {
                    // Status should have gone false by now
                    if (!node.statusLostTimer) {
                        node.statusLostTimer = setTimeout(() => {
                            if (!node.requestedState && node.actualState) {
                                node.alarm = true;
                                node.alarmMessage = "Status not clearing after call deactivated";
                                send(buildOutput());
                                updateNodeStatus();
                            }
                            node.statusLostTimer = null;
                        }, 500);  // 500ms hysteresis
                    }
                }
                node.inactiveStatusTimer = null;
            }, (node.config.clearDelay + 1) * 1000);  // Check after clear delay passes
        }

        /**
         * Check alarm conditions and set alarm state
         */
        function checkAlarmConditions() {
            // Condition 1: Status active without a call (with hysteresis)
            if (node.actualState && !node.requestedState) {
                if (!node.statusLostTimer) {
                    node.statusLostTimer = setTimeout(() => {
                        if (node.actualState && !node.requestedState) {
                            node.alarm = true;
                            node.alarmMessage = "Status active without call";
                        }
                        node.statusLostTimer = null;
                    }, 500);  // 500ms hysteresis to prevent false alarms
                }
                return;
            }

            // Condition 2: Status lost during active call (checked by heartbeat/status update)
            // This is handled by heartbeat monitoring and status timeout handlers

            // If no conditions met and no timers running, clear alarm
            if (!node.heartbeatTimer && !node.statusLostTimer && !node.inactiveStatusTimer && !node.initialStatusTimer) {
                node.alarm = false;
                node.alarmMessage = "";
            }
        }

        /**
         * Process a requested state (call) change
         */
        function processRequestedState(value, send) {
            const { valid, value: boolValue, error } = utils.validateBoolean(value);
            
            if (!valid) {
                utils.setStatusError(node, error || "invalid requested state");
                return;
            }

            // No change
            if (boolValue === node.requestedState) {
                utils.setStatusUnchanged(node, "no change");
                return;
            }

            node.requestedState = boolValue;

            if (node.requestedState) {
                // Call activated - expect status to arrive and be maintained
                node.neverReceivedStatus = true;
                node.alarm = false;
                node.alarmMessage = "";

                // Clear any existing timers
                clearAllTimers();

                // Set timeout waiting for initial status response
                if (node.config.noStatusOnRun) {
                    node.initialStatusTimer = setTimeout(() => {
                        if (node.neverReceivedStatus && node.requestedState) {
                            node.alarm = true;
                            node.alarmMessage = node.config.noStatusOnRunMessage;
                            send(buildOutput());
                            updateNodeStatus();
                        }
                        node.initialStatusTimer = null;
                    }, node.config.statusTimeout * 1000);
                }
            } else {
                // Call deactivated - start monitoring for status to go false
                if (node.initialStatusTimer) {
                    clearTimeout(node.initialStatusTimer);
                    node.initialStatusTimer = null;
                }
                if (node.heartbeatTimer) {
                    clearTimeout(node.heartbeatTimer);
                    node.heartbeatTimer = null;
                }

                // Monitor that status goes inactive
                if (node.actualState) {
                    startInactiveStatusMonitoring(send);
                }

                if (node.config.clearDelay > 0) {
                    node.clearTimer = setTimeout(() => {
                        node.actualState = false;
                        node.alarm = false;
                        node.alarmMessage = "";
                        node.neverReceivedStatus = true;
                        send(buildOutput());
                        updateNodeStatus();
                        node.clearTimer = null;
                    }, node.config.clearDelay * 1000);
                } else {
                    // No delay, clear immediately
                    node.actualState = false;
                    node.alarm = false;
                    node.alarmMessage = "";
                    node.neverReceivedStatus = true;
                }
            }

            checkAlarmConditions();
            send(buildOutput());
            updateNodeStatus();
        }

        /**
         * Process a status update with debounce
         */
        function processStatus(value, send) {
            const { valid, value: boolValue, error } = utils.validateBoolean(value);
            
            if (!valid) {
                utils.setStatusError(node, error || "invalid status");
                return;
            }

            // Debounce rapid status changes
            if (node.debounceTimer) {
                clearTimeout(node.debounceTimer);
            }

            node.debounceTimer = setTimeout(() => {
                // Check if status actually changed
                if (boolValue === node.actualState) {
                    utils.setStatusUnchanged(node, "status unchanged");
                    node.debounceTimer = null;
                    return;
                }

                node.actualState = boolValue;
                node.lastStatusTime = Date.now();
                node.neverReceivedStatus = false;

                // Clear initial timeout if we finally got status
                if (node.initialStatusTimer) {
                    clearTimeout(node.initialStatusTimer);
                    node.initialStatusTimer = null;
                }

                // Clear status lost hysteresis timer on successful update
                if (node.statusLostTimer && boolValue === true) {
                    clearTimeout(node.statusLostTimer);
                    node.statusLostTimer = null;
                }

                // If call is active and status is true, start heartbeat monitoring
                if (node.requestedState && boolValue) {
                    startHeartbeatMonitoring(send);
                }

                // If call is inactive and status goes false, clear inactiveStatusTimer
                if (!node.requestedState && !boolValue && node.inactiveStatusTimer) {
                    clearTimeout(node.inactiveStatusTimer);
                    node.inactiveStatusTimer = null;
                    node.alarm = false;
                    node.alarmMessage = "";
                }

                // Re-evaluate alarm conditions
                checkAlarmConditions();
                send(buildOutput());
                updateNodeStatus();
                node.debounceTimer = null;
            }, node.config.debounce);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate message exists
            if (!msg || typeof msg !== 'object') {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            try {
                // ===== STATUS UPDATE (Dedicated Property Priority) =====
                // 1. Check dedicated status property first (msg.status)
                if (msg.hasOwnProperty(node.config.statusInputProperty) && 
                    typeof msg[node.config.statusInputProperty] === 'boolean') {
                    processStatus(msg[node.config.statusInputProperty], send);
                    if (done) done();
                    return;
                }

                // 2. Fallback to context tagging (msg.context === "status")
                if (msg.hasOwnProperty("context") && msg.context === "status") {
                    processStatus(msg.payload, send);
                    if (done) done();
                    return;
                }

                // ===== REQUESTED STATE (Call) =====
                // Check configured input property
                if (msg.hasOwnProperty(node.config.inputProperty)) {
                    processRequestedState(msg[node.config.inputProperty], send);
                    if (done) done();
                    return;
                }

                // Default: no recognized command
                utils.setStatusWarn(node, "unrecognized input");
                if (done) done();

            } catch (err) {
                node.error(`Error processing message: ${err.message}`);
                utils.setStatusError(node, `error: ${err.message}`);
                if (done) done();
            }
        });

        node.on("close", function(done) {
            clearAllTimers();
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);
};
