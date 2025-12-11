module.exports = function(RED) {
    function GlobalSetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        const parsed = RED.util.parseContextStore(config.path);
        
        node.varName = parsed.key;
        node.storeName = parsed.store;
        node.inputProperty = config.property;

        node.on('input', function(msg) {
            if (node.varName) {
                // READ from the configured property
                const valueToStore = RED.util.getMessageProperty(msg, node.inputProperty);

                if (valueToStore !== undefined) {
                    const globalContext = node.context().global;

                    // 1. Try to find units in the standard location (msg.units)
                    // 2. If not found, check if the input property itself is an object containing .units
                    let capturedUnits = msg.units; 
                    
                    // Optional: Deep check if msg.payload was an object that contained units
                    if (!capturedUnits && typeof valueToStore === 'object' && valueToStore !== null && valueToStore.units) {
                         capturedUnits = valueToStore.units;
                    }
                    
                    // Create wrapper with simplified metadata
                    const storedObject = {
                        value: valueToStore,
                        topic: node.varName,
                        units: capturedUnits,
                        meta: {
                            sourceId: node.id,
                            sourceName: node.name || config.path,
                            sourcePath: node.varName,
                            lastSet: new Date().toISOString()
                        }
                    };
                    
                    node.status({ fill: "blue", shape: "dot", text: `Set: ${storedObject.value}` });
                    globalContext.set(node.varName, storedObject, node.storeName);
                }
            }

            node.send(msg);
        });

        // CLEANUP
        node.on('close', function(removed, done) {
            // Do NOT prune if Node-RED is simply restarting or deploying.
            if (removed && node.varName) {
                const globalContext = node.context().global;
                globalContext.set(node.varName, undefined, node.storeName); 
            }
            done();
        });
    }
    RED.nodes.registerType("global-setter", GlobalSetterNode);
}
