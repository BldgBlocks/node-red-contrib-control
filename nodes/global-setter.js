module.exports = function(RED) {
    function GlobalSetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        const parsed = RED.util.parseContextStore(config.path);
        
        node.varName = parsed.key;
        node.storeName = parsed.store;
        node.inputProperty = config.property || "payload"; // Default

        node.on('input', function(msg) {
            if (node.varName) {
                // READ from the configured property (e.g., msg.setpoint)
                const valueToStore = RED.util.getMessageProperty(msg, node.inputProperty);

                if (valueToStore !== undefined) {
                    const globalContext = node.context().global;
                    
                    // Create wrapper with simplified metadata
                    const storedObject = {
                        value: valueToStore,
                        meta: {
                            sourceId: node.id,
                            sourceName: node.name || config.path,
                            path: node.varName, // Added Path
                            topic: msg.topic,
                            ts: Date.now()
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
            if (node.varName) {
                const globalContext = node.context().global;
                globalContext.set(node.varName, undefined, node.storeName); 
            }
            done();
        });
    }
    RED.nodes.registerType("global-setter", GlobalSetterNode);
}
