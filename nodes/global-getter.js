module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload";

        node.on('input', function(msg) {
            const setterNode = RED.nodes.getNode(node.targetNodeId);

            if (setterNode && setterNode.varName) {
                const globalContext = node.context().global;
                const storedObject = globalContext.get(setterNode.varName, setterNode.storeName);
                
                if (storedObject !== undefined) {
                    let val = storedObject;
                    let units = null;
                    let meta = {};

                    // CHECK: Is this wrapper format?
                    if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value') && storedObject.hasOwnProperty('meta')) {
                        // Yes: Unwrap it
                        val = storedObject.value;
                        units = storedObject.units;
                        meta = storedObject.meta;
                    } else {
                        // Legacy/Raw: Metadata is limited
                        meta = { path: setterNode.varName, legacy: true };
                    }
                    
                    RED.util.setMessageProperty(msg, node.outputProperty, val);
                    
                    msg.topic = setterNode.varName;
                    
                    msg.units = units;

                    msg.metadata = meta; 
                    
                    node.status({ fill: "blue", shape: "dot", text: `Get: ${val}` });
                    node.send(msg);
                } else {
                    node.status({ fill: "red", shape: "ring", text: "Global variable undefined" });
                }
            } else {
                node.warn("Source node not found or not configured.");
                node.status({ fill: "red", shape: "ring", text: "Source node not found" });
            }
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
