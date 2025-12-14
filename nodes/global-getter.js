module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload";
        node.updates = config.updates;

        const setterNode = RED.nodes.getNode(node.targetNodeId);
        
        // --- HELPER: Process Wrapper and Send Msg ---
        function sendValue(storedObject, msgToReuse) {
            const msg = msgToReuse || {}; 

            if (storedObject !== undefined) {
                
                // CHECK: Is this our Wrapper Format? (Created by Global Setter)
                if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value')) {
                    
                    // 1. Separate the Value from everything else (Rest operator)
                    // 'attributes' will contain: priority, units, metadata, topic, etc.
                    const { value, ...attributes } = storedObject;

                    // 2. Set the Main Output (e.g. msg.payload = 75)
                    RED.util.setMessageProperty(msg, node.outputProperty, value);

                    // 3. Merge all attributes onto the msg root
                    // This automatically handles priority, units, metadata, and any future fields
                    Object.assign(msg, attributes);

                } else {
                    // Handle Legacy/Raw values (not created by your Setter)
                    RED.util.setMessageProperty(msg, node.outputProperty, storedObject);
                    msg.metadata = { path: setterNode ? setterNode.varName : "unknown", legacy: true };
                }
                
                // Visual Status
                const valDisplay = RED.util.getMessageProperty(msg, node.outputProperty);
                node.status({ fill: "blue", shape: "dot", text: `Get: ${valDisplay}` });
                
                node.send(msg);

            } else {
                node.status({ fill: "red", shape: "ring", text: "global variable undefined" });
            }
        }

        // --- 1. HANDLE MANUAL INPUT ---
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (setterNode && setterNode.varName) {
                const globalContext = node.context().global;
                const storedObject = globalContext.get(setterNode.varName, setterNode.storeName);
                sendValue(storedObject, msg);
            } else {
                node.warn("Source node not found or not configured.");
                node.status({ fill: "red", shape: "ring", text: "Source node not found" });
            }
            
            if (done) done();
        });

        // --- 2. HANDLE REACTIVE UPDATES ---
        let updateListener = null;

        if (node.updates === 'always' && setterNode && setterNode.varName) {
            updateListener = function(evt) {
                if (evt.key === setterNode.varName && evt.store === setterNode.storeName) {
                    // Pass data directly from event
                    sendValue(evt.data, {}); 
                }
            };
            RED.events.on("bldgblocks-global-update", updateListener);
        }

        // --- CLEANUP ---
        node.on('close', function() {
            if (updateListener) {
                RED.events.removeListener("bldgblocks-global-update", updateListener);
            }
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
