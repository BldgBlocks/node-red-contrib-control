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
                    utils.setStatusOK(node, `initialized: default:${node.defaultValue}`);
                } else {
                    utils.setStatusOK(node, `loaded: ${state.value}`);
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
                //   1. msg.priority (number 1-16 or "default") — explicit per-message override
                //   2. msg.context  ("priority1"–"priority16" or "default") — tagged-input pattern (matches priority-block)
                //   3. Configured writePriority (dropdown / msg / flow typed-input)
                // Use local variable — never mutate node.writePriority so the config default is preserved across messages
                let activePrioritySlot = null;
                try {
                    if (msg.hasOwnProperty("priority") && (typeof msg.priority === "number" || typeof msg.priority === "string")) {
                        // Source 1: msg.priority (direct number or "default") — skip objects (e.g. priority array from state)
                        const mp = msg.priority;
                        if (mp === "default") {
                            activePrioritySlot = "default";
                        } else {
                            const p = parseInt(mp, 10);
                            if (isNaN(p) || p < 1 || p > 16) {
                                node.isBusy = false;
                                return utils.sendError(node, msg, done, `Invalid msg.priority: ${mp}`);
                            }
                            activePrioritySlot = String(p);
                        }
                    } else if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                        // Source 2: msg.context tagged-input ("priority8", "default", etc.)
                        // "reload" is handled separately below — skip it here
                        const ctx = msg.context;
                        const priorityMatch = /^priority([1-9]|1[0-6])$/.exec(ctx);
                        if (priorityMatch) {
                            activePrioritySlot = priorityMatch[1];
                        } else if (ctx === "default") {
                            activePrioritySlot = "default";
                        }
                        // Other contexts (e.g. "reload") leave activePrioritySlot null → falls to config
                    }

                    // Source 3: Fall back to configured typed-input when no message override matched
                    if (activePrioritySlot === null) {
                        if (utils.requiresEvaluation(config.writePriorityType)) {
                            activePrioritySlot = await utils.evaluateNodeProperty(config.writePriority, config.writePriorityType, node, msg);
                        } else {
                            activePrioritySlot = config.writePriority;
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
                if (msg.context === "reload") {
                    RED.events.emit("bldgblocks:global:value-changed", { key: node.varName, store: node.storeName, data: state });
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    
                    prefix = state.activePriority === 'default' ? '' : 'P';
                    const statusText = `reload: ${prefix}${state.activePriority}:${state.value}${state.units || ''}`;
                    
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

                // Update State
                if (activePrioritySlot === 'default') {
                    state.defaultValue = inputValue === null || inputValue === "null" ? node.defaultValue : inputValue;
                } else {
                    const priority = parseInt(activePrioritySlot, 10);
                    if (isNaN(priority) || priority < 1 || priority > 16) {
                        return utils.sendError(node, msg, done, `Invalid priority: ${activePrioritySlot}`);
                    }
                    if (inputValue !== undefined) {
                        state.priority[activePrioritySlot] = inputValue;
                    }
                }
                
                if (state.defaultValue === null || state.defaultValue === "null" || state.defaultValue === undefined) {
                    state.defaultValue = node.defaultValue;
                }

                // Calculate Winner
                const { value, priority } = utils.getHighestPriority(state);

                // Check for change
                if (value === state.value && priority === state.activePriority) {
                    // Ensure payload stays in sync with value
                    state.payload = state.value;
                    // Persist even when output unchanged — the priority array itself changed
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    if (node.storeName !== 'default') {
                        await utils.setGlobalState(node, node.varName, 'default', state);
                    }
                    prefix = `${activePrioritySlot === 'default' ? '' : 'P'}`;
                    const statePrefix = `${state.activePriority === 'default' ? '' : 'P'}`;
                    const noChangeText = `no change: ${prefix}${activePrioritySlot}:${inputValue} > active: ${statePrefix}${state.activePriority}:${state.value}${state.units || ''}`;
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

                prefix = `${activePrioritySlot === 'default' ? '' : 'P'}`;
                const statePrefix = `${state.activePriority === 'default' ? '' : 'P'}`;
                const statusText = `write: ${prefix}${activePrioritySlot}:${inputValue}${state.units || ''} > active: ${statePrefix}${state.activePriority}:${state.value}${state.units || ''}`;

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
            utils.setStatusOK(targetNode, `cleared: default:${state.value}`);
            targetNode.send({ ...state });

            res.status(200).json({ message: "Priorities cleared", value: state.value, activePriority: state.activePriority });
        } catch (err) {
            targetNode.error(`Clear priorities error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });
}
