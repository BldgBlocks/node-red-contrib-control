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
                node.status({ fill: "red", shape: "ring", text: "no variable defined" });
                return;
            }
            try {
                // Check if data exists
                let state = await utils.getGlobalState(node, node.varName, node.storeName);
                if (!state || typeof state !== 'object' || !state.priority) {
                    // If not, set default
                    const newState = buildDefaultState();
                    await utils.setGlobalState(node, node.varName, node.storeName, newState);
                    node.status({ fill: "grey", shape: "dot", text: `initialized: default:${node.defaultValue}` });
                }
            } catch (err) {
                // Silently fail or log if init fails (DB down on boot?)
                node.error(`Init Error: ${err.message}`);
                node.status({ fill: "red", shape: "dot", text: "Init Error" });
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
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }
                node.isBusy = true;

                // Evaluate Dynamic Properties (Exact same logic as before)
                try {
                    const evaluations = [];
                    evaluations.push(
                        utils.requiresEvaluation(config.writePriorityType) 
                            ? utils.evaluateNodeProperty(config.writePriority, config.writePriorityType, node, msg)
                            : Promise.resolve(node.writePriority)
                    );
                    const results = await Promise.all(evaluations);   
                    node.writePriority = results[0];
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
                    RED.events.emit("bldgblocks-global-update", { key: node.varName, store: node.storeName, data: state });
                    await utils.setGlobalState(node, node.varName, node.storeName, state);
                    
                    prefix = state.activePriority === 'default' ? '' : 'P';
                    const statusText = `reload: ${prefix}${state.activePriority}:${state.value}${state.units}`;
                    
                    return utils.sendSuccess(node, { ...state }, done, statusText, null, "dot");
                }

                // Get Input Value
                const inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
                if (inputValue === undefined) {
                    return utils.sendError(node, msg, done, `msg.${node.inputProperty} not found`);
                }

                // Update State
                if (node.writePriority === 'default') {
                    state.defaultValue = inputValue === null || inputValue === "null" ? node.defaultValue : inputValue;
                } else {
                    const priority = parseInt(node.writePriority, 10);
                    if (isNaN(priority) || priority < 1 || priority > 16) {
                        return utils.sendError(node, msg, done, `Invalid priority: ${node.writePriority}`);
                    }
                    if (inputValue !== undefined) {
                        state.priority[node.writePriority] = inputValue;
                    }
                }
                
                if (state.defaultValue === null || state.defaultValue === "null" || state.defaultValue === undefined) {
                    state.defaultValue = node.defaultValue;
                }

                // Calculate Winner
                const { value, priority } = utils.getHighestPriority(state);

                // Check for change
                if (value === state.value && priority === state.activePriority) {
                    prefix = `${node.writePriority === 'default' ? '' : 'P'}`;
                    const noChangeText = `no change: ${prefix}${node.writePriority}:${state.value}${state.units}`;
                    node.status({ fill: "green", shape: "dot", text: noChangeText });
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

                prefix = `${node.writePriority === 'default' ? '' : 'P'}`;
                const statePrefix = `${state.activePriority === 'default' ? '' : 'P'}`;
                const statusText = `write: ${prefix}${node.writePriority}:${inputValue}${state.units} > active: ${statePrefix}${state.activePriority}:${state.value}${state.units}`;

                RED.events.emit("bldgblocks-global-update", {
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
            if (removed && node.varName) {
                RED.events.removeAllListeners("bldgblocks-global-update");
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
}
