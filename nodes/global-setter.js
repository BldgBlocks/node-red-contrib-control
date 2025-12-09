module.exports = function(RED) {
    function GlobalSetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        const parsed = RED.util.parseContextStore(config.path);
        
        node.varName = parsed.key;
        node.storeName = parsed.store;

        node.on('input', function(msg) {
            if (node.varName) {
                const globalContext = node.context().global;
                
                // Create a clean wrapper object to store in global context
                const storedObject = {
                    value: msg.payload,
                    meta: {
                        sourceId: node.id,
                        sourceName: node.name || config.path,
                        topic: msg.topic,
                        ts: Date.now()
                    }
                };
                
                globalContext.set(node.varName, storedObject, node.storeName);
            }

            node.status({ fill: "blue", shape: "dot", text: `Set: ${msg.payload}` });
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
