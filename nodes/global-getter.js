module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;

        node.on('input', function(msg) {
            const setterNode = RED.nodes.getNode(node.targetNodeId);

            if (setterNode && setterNode.varName) {
                const globalContext = node.context().global;
                
                // Retrieve the wrapper object
                const storedObject = globalContext.get(setterNode.varName, setterNode.storeName);
                
                if (storedObject !== undefined) {
                    // CHECK: Is this our wrapper format?
                    if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value') && storedObject.hasOwnProperty('meta')) {
                        // Yes: Unwrap it
                        msg.payload = storedObject.value;
                        msg.globalMetadata = storedObject.meta; // Expose the ID/Metadata here
                    } else {
                        // No: It's legacy/raw data, just pass it through
                        msg.payload = storedObject;
                    }
                    
                    msg.topic = setterNode.varName; 
                    
                    node.status({ fill: "blue", shape: "dot", text: `Get: ${msg.payload}` });
                    node.send(msg);
                } else {
                    // Variable exists in config but not in memory yet
                    // Optional: warn or just do nothing
                }
            } else {
                node.warn("Source node not found or not configured.");
                node.status({ fill: "red", shape: "ring", text: "Source node not found" });
            }
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}