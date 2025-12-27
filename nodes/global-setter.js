
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
        
        // Cast default value logic
        if(!isNaN(node.defaultValue) && node.defaultValue !== "") node.defaultValue = Number(node.defaultValue);
        if(node.defaultValue === "true") node.defaultValue = true;
        if(node.defaultValue === "false") node.defaultValue = false;

        // --- HELPER: Calculate Winner ---
        function calculateWinner(state) {
            for (let i = 1; i <= 16; i++) {
                if (state.priority[i] !== undefined && state.priority[i] !== null) {
                    return { value: state.priority[i], priority: `${i}` };
                }
            }
            return { value: state.defaultValue, priority: "default" };
        }

        function getState() {
            if (!node.varName) {
                node.status({ fill: "red", shape: "ring", text: "no variable defined" });
                return null;
            }
            let state = {};
            state = node.context().global.get(node.varName, node.storeName);
            if (!state || typeof state !== 'object' || !state.priority) {
                state = {
                    payload: node.defaultValue,
                    value: node.defaultValue,
                    defaultValue: node.defaultValue,
                    activePriority: "default",
                    units: null,
                    priority: {
                        1: null,
                        2: null,
                        3: null,
                        4: null,
                        5: null,
                        6: null,
                        7: null,
                        8: null,
                        9: null,
                        10: null,
                        11: null,
                        12: null,
                        13: null,
                        14: null,
                        15: null,
                        16: null,
                    },
                    metadata: {
                        sourceId: node.id,
                        lastSet: new Date().toISOString(),
                        name: node.name || config.path,
                        path: node.varName,
                        store: node.storeName || 'default',
                        type: typeof(value)
                    }
                };
            }
            return state;
        }

        node.isBusy = false;

        node.on('input', async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            let prefix = '';
            let valPretty = '';

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }  

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.writePriorityType) 
                        ? utils.evaluateNodeProperty( config.writePriority, config.writePriorityType, node, msg )
                        : Promise.resolve(node.writePriority),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                node.writePriority = results[0];
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Get existing state or initialize new
            let state = {};
            state = getState();
            if (!state) {
                if (done) done();
                return;
            }

            if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                if (msg.context === "reload") {
                    // Fire Event
                    RED.events.emit("bldgblocks-global-update", {
                        key: node.varName,
                        store: node.storeName,
                        data: state
                    });
                    
                    // Send flow
                    node.context().global.set(node.varName, state, node.storeName);
                    prefix = state.activePriority === 'default' ? '' : 'P';
                    valPretty = typeof state.value === "number" ? state.value.toFixed(2) : state.value;
                    node.status({ fill: "green", shape: "dot", text: `reload: ${prefix}${state.activePriority}:${valPretty}${state.units}` });
                    node.send({ ...state });
                    if (done) done();
                    return;
                }
            }

            // Guard against missing input property
            if (msg.hasOwnProperty(node.inputProperty) === false) {
                node.status({ fill: "red", shape: "ring", text: `msg.${node.inputProperty} not found` });
                if (done) done();
                return;
            }

            const inputValue = RED.util.getMessageProperty(msg, node.inputProperty);

            // Update Default, can not be set null
            if (node.writePriority === 'default') {
                state.defaultValue = inputValue === null || inputValue === "null" ? node.defaultValue : inputValue;
            } else {
                const priority = parseInt(node.writePriority, 10);
                if (isNaN(priority) || priority < 1 || priority > 16) {
                    node.status({ fill: "red", shape: "ring", text: `Invalid priority: ${node.writePriority}` });
                    if (done) done();
                    return;
                }
                
                if (inputValue !== undefined) {
                    state.priority[node.writePriority] = inputValue;
                }
            }
            
            // Ensure defaultValue always has a value
            if (state.defaultValue === null || state.defaultValue === "null" || state.defaultValue === undefined) {
                state.defaultValue = node.defaultValue;
            }

            // Calculate Winner
            const { value, priority } = calculateWinner(state);
            if (value === state.value && priority === state.activePriority) {
                // No change, exit early
                prefix = `${node.writePriority === 'default' ? '' : 'P'}`;
                valPretty = typeof state.value === "number" ? state.value.toFixed(2) : state.value;
                node.status({ fill: "green", shape: "dot", text: `no change: ${prefix}${node.writePriority}:${valPretty}${state.units}` });
                if (done) done();
                return;
            }
            state.payload = value;
            state.value = value;
            state.activePriority = priority;

            // Update Metadata
            state.metadata.sourceId = node.id;
            state.metadata.lastSet = new Date().toISOString();
            state.metadata.name = node.name || config.path;
            state.metadata.path = node.varName; 
            state.metadata.store = node.storeName || 'default';
            state.metadata.type = typeof(value);

            // Units logic
            let capturedUnits = null;
            if (msg.units !== undefined) {
                capturedUnits = msg.units;
            } else if (inputValue !== null && typeof inputValue === 'object' && inputValue.units) {
                    capturedUnits = inputValue.units;
            }

            state.units = capturedUnits;

            // Save & Emit
            node.context().global.set(node.varName, state, node.storeName);
            prefix = `${node.writePriority === 'default' ? '' : 'P'}`;
            const statePrefix = `${state.activePriority === 'default' ? '' : 'P'}`;
            const inputValDisplay = typeof inputValue === "number" ? inputValue.toFixed(2) : inputValue;
            valPretty = typeof state.value === "number" ? state.value.toFixed(2) : state.value;
            node.status({ fill: "blue", shape: "dot", text: `write: ${prefix}${node.writePriority}:${inputValDisplay}${state.units} > active: ${statePrefix}${state.activePriority}:${valPretty}${state.units}` });

            // Fire Event
            RED.events.emit("bldgblocks-global-update", {
                key: node.varName,
                store: node.storeName,
                data: state
            });
            
            // Send copy
            node.send({ ...state });
            if (done) done();
        });

        node.on('close', function(removed, done) {
            if (removed && node.varName) {
                RED.events.removeAllListeners("bldgblocks-global-update");
                node.context().global.set(node.varName, undefined, node.storeName); 
            }
            done();
        });
    }
    RED.nodes.registerType("global-setter", GlobalSetterNode);
}
