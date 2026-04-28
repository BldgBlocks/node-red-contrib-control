module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function GlobalSetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        const parsed = RED.util.parseContextStore(config.path);
        node.varName = parsed.key;
        node.storeName = parsed.store;
        node.inputProperty = config.property;        
        node.defaultValue = config.defaultValue;
        node.writePriority = config.writePriority;
        node.type = config.defaultValueType;
        node.showStatus = config.showStatus !== false;
        node.isBusy = false;
        
        if(!isNaN(node.defaultValue) && node.defaultValue !== "") node.defaultValue = Number(node.defaultValue);
        if(node.defaultValue === "true") node.defaultValue = true;
        if(node.defaultValue === "false") node.defaultValue = false;

        // Helper to generate the data structure
        function buildDefaultState() {
            return {
                payload: node.defaultValue,
                value: node.defaultValue,
                defaultValue: node.defaultValue,
                activePriority: "default",
                fallback: null,
                units: null,
                priority: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null, 11: null, 12: null, 13: null, 14: null, 15: null, 16: null },
                metadata: {
                    sourceId: node.id,
                    lastSet: new Date().toISOString(),
                    name: node.name || config.path,
                    path: node.varName,
                    store: node.storeName || 'default',
                    type: typeof(node.defaultValue)
                }
            };
        }

        function formatStatusValue(value, units = "") {
            let display = value;
            if (display === null) display = "null";
            else if (display === undefined) display = "undefined";
            else if (typeof display === "object") display = JSON.stringify(display);
            else display = String(display);

            if (display.length > 64) {
                display = display.substring(0, 64) + "...";
            }

            return `${display}${units || ""}`;
        }

        function buildStatusText(verb, writeSlotLabel, inputValue, activeLabel, activeValue, units = "") {
            if (!node.showStatus) {
                return `${verb}: ${writeSlotLabel} > active: ${activeLabel}`;
            }
            return `${verb}: ${writeSlotLabel}:${formatStatusValue(inputValue, units)} > active: ${activeLabel}:${formatStatusValue(activeValue, units)}`;
        }

        function buildReloadStatusText(activeLabel, activeValue, units = "") {
            if (!node.showStatus) {
                return `reload: ${activeLabel}`;
            }
            return `reload: ${activeLabel}:${formatStatusValue(activeValue, units)}`;
        }

        // --- ASYNC INITIALIZATION (IIFE) ---
        // This runs in background immediately after deployment
        (async function initialize() {
            if (!node.varName) {
                utils.setStatusError(node, "no variable defined");
                return;
            }
            try {
                // Check if data exists
                let state = await utils.getGlobalState(node, node.varName, node.storeName);
                if (!state || typeof state !== 'object' || !state.priority) {
                    // If not, set default
                    state = buildDefaultState();
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    if (node.showStatus) {
                        utils.setStatusOK(node, `initialized: default:${formatStatusValue(node.defaultValue)}`);
                    } else {
                        utils.setStatusOK(node, "initialized");
                    }
                } else {
                    if (node.showStatus) {
                        utils.setStatusOK(node, `loaded: ${formatStatusValue(state.value, state.units)}`);
                    } else {
                        utils.setStatusOK(node, "loaded");
                    }
                }
                
                // Send properly formed state object downstream after full initialization
                // Allows network-register and other downstream nodes to register on startup
                // Use setTimeout with delay to allow getter nodes time to establish their event listeners
                initTimer = setTimeout(() => {
                    initTimer = null;
                    // Emit event so getter nodes with 'always' update mode receive initial value
                    RED.events.emit("bldgblocks:global:value-changed", {
                        key: node.varName,
                        store: node.storeName,
                        data: state
                    });
                    node.send(state);
                }, 500);
            } catch (err) {
                // Silently fail or log if init fails (DB down on boot?)
                node.error(`Init Error: ${err.message}`);
                utils.setStatusError(node, "Init Error");
            }
        })();

        // --- INPUT HANDLER ---
        node.on('input', async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            let prefix = '';

            try {
                // Basic Validation
                if (!msg) return utils.sendError(node, msg, done, "invalid message");
                
                if (node.isBusy) {
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done(); 
                    return;
                }
                node.isBusy = true;

                // Resolve write priority — three sources, in order of precedence:
                //   1. msg.priority (number 1-16) — explicit per-message override
                //   2. msg.context  ("priority1"–"priority16", "fallback", "reload") — tagged-input pattern
                //   3. Configured writePriority (dropdown / msg / flow typed-input)
                // Use local variable — never mutate node.writePriority so the config default is preserved across messages
                let activePrioritySlot = null;
                let isFallbackWrite = false;
                
                try {
                    if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                        // Check for special contexts first
                        const ctx = msg.context;
                        if (ctx === "fallback") {
                            isFallbackWrite = true;
                        } else if (ctx === "reload") {
                            // Handled separately below
                            activePrioritySlot = "reload";
                        } else {
                            // Check for priority context
                            const priorityMatch = /^priority([1-9]|1[0-6])$/.exec(ctx);
                            if (priorityMatch) {
                                activePrioritySlot = priorityMatch[1];
                            }
                            // Unknown contexts leave activePrioritySlot null → falls to config
                        }
                    }
                    
                    if (msg.hasOwnProperty("priority") && (typeof msg.priority === "number" || typeof msg.priority === "string")) {
                        // Source 1: msg.priority (direct number 1-16) — skip objects (e.g. priority array from state)
                        const mp = msg.priority;
                        const p = parseInt(mp, 10);
                        if (isNaN(p) || p < 1 || p > 16) {
                            node.isBusy = false;
                            return utils.sendError(node, msg, done, `Invalid msg.priority: ${mp} (must be 1-16)`);
                        }
                        activePrioritySlot = String(p);
                        isFallbackWrite = false; // msg.priority overrides fallback context
                    }

                    // Source 3: Fall back to configured writePriority only if no message override matched
                    if (!isFallbackWrite && activePrioritySlot === null) {
                        let configuredSlot;
                        if (utils.requiresEvaluation(config.writePriorityType)) {
                            configuredSlot = await utils.evaluateNodeProperty(config.writePriority, config.writePriorityType, node, msg);
                        } else {
                            configuredSlot = config.writePriority;
                        }
                        // Allow "fallback" as a configured value
                        if (configuredSlot === "fallback") {
                            isFallbackWrite = true;
                        } else {
                            // Validate configured priority (must be 1-16)
                            const cp = parseInt(configuredSlot, 10);
                            if (isNaN(cp) || cp < 1 || cp > 16) {
                                node.isBusy = false;
                                return utils.sendError(node, msg, done, `Invalid configured writePriority: ${configuredSlot} (must be 1-16 or fallback)`);
                            }
                            activePrioritySlot = String(cp);
                        }
                    }
                } catch (err) {
                    throw new Error(`Property Eval Error: ${err.message}`);
                } finally {
                    node.isBusy = false;
                }

                // Get State (Async)
                let state = await utils.getGlobalState(node, node.varName, node.storeName);
                if (!state || typeof state !== 'object' || !state.priority) {
                    // Fallback if data is missing (e.g., if message arrives before init finishes)
                    state = buildDefaultState();
                }

                // Handle Reload
                if (activePrioritySlot === "reload") {
                    RED.events.emit("bldgblocks:global:value-changed", { key: node.varName, store: node.storeName, data: state });
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    
                    const activeLabel = state.activePriority === 'default' ? 'default' : (state.activePriority === 'fallback' ? 'fallback' : `P${state.activePriority}`);
                    const statusText = buildReloadStatusText(activeLabel, state.value, state.units);
                    
                    return utils.sendSuccess(node, { ...state }, done, statusText, null, "dot");
                }

                // Get Input Value
                let inputValue;
                try {
                    inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
                } catch (err) {
                    inputValue = undefined;
                }
                if (inputValue === undefined) {
                    return utils.sendError(node, msg, done, `msg.${node.inputProperty} not found or invalid property path`);
                }

                // Update State: either fallback or priority slot
                if (isFallbackWrite) {
                    state.fallback = inputValue === null || inputValue === "null" ? null : inputValue;
                } else {
                    const priority = parseInt(activePrioritySlot, 10);
                    if (isNaN(priority) || priority < 1 || priority > 16) {
                        return utils.sendError(node, msg, done, `Invalid priority: ${activePrioritySlot}`);
                    }
                    if (inputValue !== undefined) {
                        state.priority[activePrioritySlot] = inputValue;
                    }
                }

                // Calculate Winner (includes priorities 1-16, then fallback, then default)
                const { value, priority } = utils.getHighestPriority(state);

                // Check for change
                if (value === state.value && priority === state.activePriority) {
                    // Ensure payload stays in sync with value
                    state.payload = state.value;
                    // Persist even when output unchanged — the priority/fallback array itself changed
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    if (node.storeName !== 'default') {
                        await utils.setGlobalState(node, node.varName, 'default', state);
                    }
                    const writeSlotLabel = isFallbackWrite ? 'fallback' : `P${activePrioritySlot}`;
                    const activeLabel = state.activePriority === 'default' ? 'default' : (state.activePriority === 'fallback' ? 'fallback' : `P${state.activePriority}`);
                    const noChangeText = buildStatusText("no change", writeSlotLabel, inputValue, activeLabel, state.value, state.units);
                    utils.setStatusUnchanged(node, noChangeText);
                    // Pass message through even if no context change
                    send({ ...state });
                    if (done) done();
                    return;
                }

                // Update Values
                state.payload = value;
                state.value = value;
                state.activePriority = priority;

                state.metadata.sourceId = node.id;
                state.metadata.lastSet = new Date().toISOString();
                state.metadata.name = node.name || config.path;
                state.metadata.path = node.varName; 
                state.metadata.store = node.storeName || 'default';
                state.metadata.type = typeof(value) || node.type;

                // Capture Units
                let capturedUnits = null;
                if (msg.units !== undefined) {
                    capturedUnits = msg.units;
                } else if (inputValue !== null && typeof inputValue === 'object' && inputValue.units) {
                    capturedUnits = inputValue.units;
                }
                state.units = capturedUnits;

                // Save (Async) and Emit
                await utils.setGlobalState(node, node.varName, node.storeName, state);
                // *** REQUIRE DEFAULT STORE ***
                // Require default store to keep values in memory for polled getter nodes so they are not constantly re-reading from DB
                // to avoid hammering edge devices with repeated reads. Writes are only on change. On event (reactive) sends the data in the event. 
                if (node.storeName !== 'default') {
                    await utils.setGlobalState(node, node.varName, 'default', state);
                }

                const writeSlotLabel = isFallbackWrite ? 'fallback' : `P${activePrioritySlot}`;
                const activeLabel = state.activePriority === 'default' ? 'default' : (state.activePriority === 'fallback' ? 'fallback' : `P${state.activePriority}`);
                const statusText = buildStatusText("write", writeSlotLabel, inputValue, activeLabel, state.value, state.units);

                RED.events.emit("bldgblocks:global:value-changed", {
                    key: node.varName,
                    store: node.storeName,
                    data: state
                });
                
                utils.sendSuccess(node, { ...state }, done, statusText, null, "dot");

            } catch (err) {
                node.error(err);
                utils.sendError(node, msg, done, `Internal Error: ${err.message}`);
            }
        });

        node.on('close', function(removed, done) {
            if (initTimer) { clearTimeout(initTimer); initTimer = null; }
            if (removed && node.varName) {
                // Callback style safe for close
                node.context().global.set(node.varName, undefined, node.storeName, function() {
                    done();
                });
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("global-setter", GlobalSetterNode);

    // --- Admin endpoint: Clear all priority slots for a given setter node ---
    RED.httpAdmin.post('/global-setter/:id/clear-priorities', RED.auth.needsPermission('global-setter.write'), async function(req, res) {
        const targetNode = RED.nodes.getNode(req.params.id);
        if (!targetNode) {
            return res.status(404).json({ error: "Node not found" });
        }
        try {
            let state = await utils.getGlobalState(targetNode, targetNode.varName, targetNode.storeName);
            if (!state || typeof state !== 'object' || !state.priority) {
                return res.status(200).json({ message: "No state to clear" });
            }
            // Clear all 16 priority slots
            for (let i = 1; i <= 16; i++) {
                state.priority[i] = null;
            }
            // Recalculate winner (will fall back to default)
            const { value, priority } = utils.getHighestPriority(state);
            state.payload = value;
            state.value = value;
            state.activePriority = priority;
            state.metadata.lastSet = new Date().toISOString();
            state.metadata.sourceId = targetNode.id;

            await utils.setGlobalState(targetNode, targetNode.varName, targetNode.storeName, state);
            if (targetNode.storeName !== 'default') {
                await utils.setGlobalState(targetNode, targetNode.varName, 'default', state);
            }

            RED.events.emit("bldgblocks:global:value-changed", {
                key: targetNode.varName,
                store: targetNode.storeName,
                data: state
            });
            const activeLabel = state.activePriority === 'default' ? 'default' : (state.activePriority === 'fallback' ? 'fallback' : `P${state.activePriority}`);
            let clearedStatus = `cleared: active: ${activeLabel}`;
            if (targetNode.showStatus !== false) {
                let activeValue = state.value;
                if (activeValue === null) activeValue = "null";
                else if (activeValue === undefined) activeValue = "undefined";
                else if (typeof activeValue === "object") activeValue = JSON.stringify(activeValue);
                else activeValue = String(activeValue);
                if (activeValue.length > 64) {
                    activeValue = activeValue.substring(0, 64) + "...";
                }
                clearedStatus = `cleared: active: ${activeLabel}:${activeValue}${state.units || ''}`;
            }
            utils.setStatusOK(targetNode, clearedStatus);
            targetNode.send({ ...state });

            res.status(200).json({ message: "Priorities cleared", value: state.value, activePriority: state.activePriority });
        } catch (err) {
            targetNode.error(`Clear priorities error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
}
