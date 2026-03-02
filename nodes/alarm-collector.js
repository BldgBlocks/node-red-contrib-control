module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AlarmCollectorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize configuration
        node.name = config.name || "alarm-collector";
        node.alarmConfigId = config.alarmConfig;
        node.inputMode = config.inputMode || "value";
        node.inputField = config.inputField || "payload";
        node.alarmWhenTrue = config.alarmWhenTrue !== false;
        node.highThreshold = parseFloat(config.highThreshold) || 85;
        node.lowThreshold = parseFloat(config.lowThreshold) || 68;
        node.compareMode = config.compareMode || "either";
        node.hysteresisTime = parseInt(config.hysteresisTime) || 500;
        node.hysteresisMagnitude = parseFloat(config.hysteresisMagnitude) || 2;
        node.priority = config.priority || "normal";
        node.topic = config.topic || "Alarms_Default";
        node.title = config.title || "Alarm";
        node.message = config.message || "Condition active";
        node.messageType = config.messageType || "str";
        node.tags = config.tags || "";
        node.units = config.units || "";

        // Get reference to alarm-config node
        node.alarmConfig = RED.nodes.getNode(node.alarmConfigId);
        if (!node.alarmConfig) {
            utils.setStatusWarn(node, "Alarm registry not configured");
        }

        // Getter pattern: optional target global-setter node selection
        node.sourceNodeId = config.sourceNode || null;
        node.sourceNodeType = config.sourceNodeType || "wired";
        let setterNode = null;
        if (node.sourceNodeType === "setter" && node.sourceNodeId) {
            setterNode = RED.nodes.getNode(node.sourceNodeId);
        }

        // Runtime state
        node.currentValue = null;
        node.alarmState = false;
        node.lastEmittedState = null;
        node.hysteresisTimer = null;
        node.conditionMet = false;
        node.valueChangedListener = null;

        // Register with alarm-config at startup so the registry knows about this collector
        if (node.alarmConfig) {
            node.alarmConfig.register(node.id, {
                name: node.name,
                severity: node.priority,
                status: 'cleared',
                title: node.title,
                message: node.message,
                topic: node.topic,
                value: null,
                timestamp: new Date().toISOString()
            });
        }

        utils.setStatusOK(node, `idle`);

        // ====================================================================
        // Helper: Evaluate alarm condition and emit event if state changed
        // ====================================================================
        function evaluateAndEmit(inputValue) {
            // Evaluate alarm condition based on input mode
            let conditionNowMet = false;
            let numericValue = null;

            if (node.inputMode === "boolean") {
                // Boolean mode: compare directly with alarmWhenTrue
                conditionNowMet = (inputValue === node.alarmWhenTrue);
                node.currentValue = inputValue;
            } else {
                // Value mode: parse as numeric and check thresholds
                numericValue = inputValue;
                if (typeof inputValue === 'object' && inputValue !== null && inputValue.value !== undefined) {
                    numericValue = inputValue.value;
                }
                numericValue = parseFloat(numericValue);
                
                if (isNaN(numericValue)) {
                    utils.setStatusError(node, "Invalid numeric input");
                    return;
                }
                
                node.currentValue = numericValue;

                // Check thresholds
                if (node.compareMode === "either") {
                    conditionNowMet = (numericValue > node.highThreshold) || (numericValue < node.lowThreshold);
                } else if (node.compareMode === "high-only") {
                    conditionNowMet = (numericValue > node.highThreshold);
                } else if (node.compareMode === "low-only") {
                    conditionNowMet = (numericValue < node.lowThreshold);
                }
            }

            // Time-based hysteresis logic
            if (conditionNowMet && !node.conditionMet) {
                // Condition just became true - start hysteresis timer
                node.conditionMet = true;
                
                if (node.hysteresisTimer) clearTimeout(node.hysteresisTimer);

                node.hysteresisTimer = setTimeout(() => {
                    if (node.conditionMet && node.alarmState === false) {
                        // Condition stayed true for hysteresisTime ms
                        node.alarmState = true;
                        emitAlarmEvent("false → true");
                    }
                    node.hysteresisTimer = null;
                }, node.hysteresisTime);

            } else if (!conditionNowMet && node.conditionMet) {
                // Condition just became false - cancel pending timer
                node.conditionMet = false;
                
                if (node.hysteresisTimer) {
                    clearTimeout(node.hysteresisTimer);
                    node.hysteresisTimer = null;
                }

                // Check magnitude hysteresis before clearing
                let shouldClear = true;
                if (node.inputMode === "value" && node.alarmState === true) {
                    if (node.compareMode === "either" || node.compareMode === "high-only") {
                        const clearThreshold = node.highThreshold - node.hysteresisMagnitude;
                        if (numericValue > clearThreshold) {
                            shouldClear = false;
                        }
                    }
                    if (node.compareMode === "either" || node.compareMode === "low-only") {
                        const clearThreshold = node.lowThreshold + node.hysteresisMagnitude;
                        if (numericValue < clearThreshold) {
                            shouldClear = false;
                        }
                    }
                }

                if (shouldClear && node.alarmState === true) {
                    node.alarmState = false;
                    emitAlarmEvent("true → false");
                }

            } else if (!conditionNowMet && !node.conditionMet && node.alarmState === true) {
                // Condition was already cleared on a prior update but alarm is
                // still active (magnitude hysteresis kept it open).  Re-evaluate
                // magnitude hysteresis on every subsequent update so the alarm
                // can clear once the value moves outside the hysteresis band.
                let shouldClear = true;
                if (node.inputMode === "value") {
                    if (node.compareMode === "either" || node.compareMode === "high-only") {
                        const clearThreshold = node.highThreshold - node.hysteresisMagnitude;
                        if (numericValue > clearThreshold) {
                            shouldClear = false;
                        }
                    }
                    if (node.compareMode === "either" || node.compareMode === "low-only") {
                        const clearThreshold = node.lowThreshold + node.hysteresisMagnitude;
                        if (numericValue < clearThreshold) {
                            shouldClear = false;
                        }
                    }
                }

                if (shouldClear) {
                    node.alarmState = false;
                    emitAlarmEvent("true → false");
                }
            }

            // Update status display
            let statusText;
            if (node.inputMode === "boolean") {
                statusText = `${inputValue ? "true" : "false"}`;
            } else {
                statusText = `${numericValue.toFixed(2)} ${node.units}`;
            }

            if (node.alarmState) {
                utils.setStatusError(node, statusText + " [ALARM]");
            } else if (node.conditionMet) {
                utils.setStatusWarn(node, statusText + " (hysteresis)");
            } else {
                utils.setStatusOK(node, statusText);
            }
        }

        // ====================================================================
        // Emit alarm event (only on state transition)
        // ====================================================================
        function emitAlarmEvent(transition) {
            if (node.lastEmittedState === node.alarmState) {
                return;
            }

            node.lastEmittedState = node.alarmState;

            const eventData = {
                nodeId: node.id,
                nodeName: node.name,
                value: node.currentValue,
                highThreshold: node.inputMode === "value" ? node.highThreshold : undefined,
                lowThreshold: node.inputMode === "value" ? node.lowThreshold : undefined,
                compareMode: node.inputMode === "value" ? node.compareMode : undefined,
                state: node.alarmState,
                priority: node.priority,
                topic: node.topic,
                title: node.title,
                message: node.message,
                tags: node.tags,
                units: node.units,
                timestamp: new Date().toISOString(),
                transition: transition
            };

            // Register/update alarm in registry
            if (node.alarmConfig) {
                node.alarmConfig.register(node.id, {
                    name: node.name,
                    severity: node.priority,
                    status: node.alarmState ? 'active' : 'cleared',
                    title: node.title,
                    message: node.message,
                    topic: node.topic,
                    value: node.currentValue,
                    timestamp: new Date().toISOString()
                });
            }

            // Emit to fixed event - service listens here
            RED.events.emit("bldgblocks:alarms:state-change", eventData);
        }

        // ====================================================================
        // Setup listeners based on mode (wired or target node)
        // ====================================================================

        // If target global-setter selected, listen to value changes (same as global-getter)
        if (setterNode && setterNode.varName) {
            node.valueChangedListener = function(evt) {
                if (evt.key === setterNode.varName && evt.store === setterNode.storeName) {
                    // Extract value from the global data object
                    let val = evt.data;
                    if (val && typeof val === 'object' && val.hasOwnProperty('value')) {
                        val = val.value;
                    }
                    if (val !== undefined && val !== null) {
                        evaluateAndEmit(val);
                    }
                }
            };

            RED.events.on("bldgblocks:global:value-changed", node.valueChangedListener);
            utils.setStatusOK(node, `monitoring ${setterNode.varName}`);
        }

        // Wired input handler
        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // If using target node, ignore wired input
            if (setterNode) {
                if (done) done();
                return;
            }

            // Get input value from configured msg property using evaluateNodeProperty
            try {
                let inputValue = await utils.evaluateNodeProperty(node.inputField, node.inputFieldType || "msg", node, msg);
                
                if (inputValue === undefined || inputValue === null) {
                    utils.setStatusError(node, `missing field: ${node.inputField}`);
                    if (done) done();
                    return;
                }

                // Evaluate based on input mode
                if (node.inputMode === "boolean") {
                    inputValue = Boolean(inputValue);
                } else {
                    inputValue = parseFloat(inputValue);
                    if (isNaN(inputValue)) {
                        utils.setStatusError(node, "invalid numeric input");
                        if (done) done();
                        return;
                    }
                }

                // Resolve message dynamically if configured as msg property
                if (node.messageType === "msg") {
                    try {
                        const resolved = await utils.evaluateNodeProperty(config.message, "msg", node, msg);
                        if (resolved !== undefined && resolved !== null) {
                            node.message = String(resolved);
                        }
                    } catch (e) {
                        // Keep existing message on error
                    }
                }

                evaluateAndEmit(inputValue);
            } catch (err) {
                utils.setStatusError(node, `Error reading input: ${err.message}`);
                node.error(err);
            }
            
            if (done) done();
        });

        node.on("close", function(done) {
            // Cleanup timers
            if (node.hysteresisTimer) {
                clearTimeout(node.hysteresisTimer);
                node.hysteresisTimer = null;
            }

            // Unregister alarm from registry
            if (node.alarmConfig) {
                node.alarmConfig.unregister(node.id);
            }

            // Remove global value-changed listener
            if (node.valueChangedListener) {
                RED.events.off("bldgblocks:global:value-changed", node.valueChangedListener);
                node.valueChangedListener = null;
            }

            done();
        });
    }

    RED.nodes.registerType("alarm-collector", AlarmCollectorNode);
};
