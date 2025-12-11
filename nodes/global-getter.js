module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload"; // Default

        node.on('input', function(msg) {
            const setterNode = RED.nodes.getNode(node.targetNodeId);

            if (setterNode && setterNode.varName) {
                const globalContext = node.context().global;
                const storedObject = globalContext.get(setterNode.varName, setterNode.storeName);
                
                if (storedObject !== undefined) {
                    let val = storedObject;
                    let meta = {};

                    // CHECK: Is this our wrapper format?
                    if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value') && storedObject.hasOwnProperty('meta')) {
                        // Yes: Unwrap it
                        val = storedObject.value;
                        meta = storedObject.meta;
                    } else {
                        // Legacy/Raw: Metadata is limited
                        meta = { path: setterNode.varName, legacy: true };
                    }
                    
                    // WRITE to the configured property (e.g., msg.payload)
                    RED.util.setMessageProperty(msg, node.outputProperty, val);
                    
                    // WRITE metadata (renamed from globalMetadata)
                    msg.metadata = meta; 
                    
                    node.send(msg);
                }
            } else {
                node.warn("Source node not found or not configured.");
                node.status({ fill: "red", shape: "ring", text: "Source node not found" });
            }
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
