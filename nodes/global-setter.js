
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

        node.isBusy = false;

        node.on('input', async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

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

            let state = {};
            if (node.varName) {
                const inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
                const globalContext = node.context().global;

                // Get existing state or initialize new
                state = globalContext.get(node.varName, node.storeName);
                if (!state || typeof state !== 'object' || !state.priority) {
                    state = {
                        value: null,
                        defaultValue: node.defaultValue,
                        activePriority: "default",
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
                        metadata: {}
                    };
                }

                // Update Default, can not be set null
                if (node.writePriority === 'default') {
                    state.defaultValue = inputValue !== null ? inputValue : node.defaultValue;
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
                if (state.defaultValue === null || state.defaultValue === undefined) {
                    state.defaultValue = node.defaultValue;
                }

                // Calculate Winner
                const { value, priority } = calculateWinner(state);
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
                let capturedUnits = msg.units; 
                if (!capturedUnits && typeof inputValue === 'object' && inputValue !== null && inputValue.units) {
                     capturedUnits = inputValue.units;
                }
                if(capturedUnits) state.units = capturedUnits;

                // Save & Emit
                globalContext.set(node.varName, state, node.storeName);
                
                node.status({ fill: "blue", shape: "dot", text: `write: ${node.writePriority === 'default' ? 'default' : 'P' + node.writePriority}:${inputValue}${state.units} > active: ${state.activePriority === 'default' ? 'default' : 'P' + state.activePriority}:${state.value}${state.units}` });

                // Fire Event
                RED.events.emit("bldgblocks-global-update", {
                    key: node.varName,
                    store: node.storeName,
                    data: state
                });
            }
            
            // Send copy
            node.send({ ...state });
            if (done) done();
        });

        node.on('close', function(removed, done) {
            if (removed && node.varName) {
                RED.events.removeAllListeners("bldgblocks-global-update");
                const globalContext = node.context().global;
                globalContext.set(node.varName, undefined, node.storeName); 
            }
            done();
        });
    }
    RED.nodes.registerType("global-setter", GlobalSetterNode);
}
