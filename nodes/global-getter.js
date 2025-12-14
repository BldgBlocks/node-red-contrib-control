module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload";
        node.updates = config.updates;
        node.detail = config.detail;

        let setterNode = null;
        let retryInterval = null;
        let updateListener = null;
        let retryCount = 0;
        const retryDelays = [0, 100, 500, 1000, 2000, 4000, 8000, 16000];
        const maxRetries = retryDelays.length - 1;
        
        // --- HELPER: Process Wrapper and Send Msg ---
        function sendValue(storedObject, msgToReuse) {
            const msg = msgToReuse || {}; 

            if (storedObject !== undefined && storedObject !== null) {
                
                // CHECK: Is this our Wrapper Format? (Created by Global Setter)
                if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value')) {
                    
                    // 1. Separate the Value from everything else (Rest operator)
                    // 'attributes' will contain: priority, units, metadata, topic, etc.
                    const { value, ...attributes } = storedObject;

                    // 2. Set the Main Output (e.g. msg.payload = 75)
                    RED.util.setMessageProperty(msg, node.outputProperty, value);

                    // 3. Merge all attributes onto the msg root
                    // This automatically handles priority, units, metadata, and any future fields
                    if (node.detail === "getObject") {
                        Object.assign(msg, attributes);
                    }

                } else {
                    // Handle Legacy/Raw values (not created by your Setter)
                    RED.util.setMessageProperty(msg, node.outputProperty, storedObject);
                    msg.metadata = { path: setterNode ? setterNode.varName : "unknown", legacy: true };
                }
                
                // Visual Status
                const valDisplay = RED.util.getMessageProperty(msg, node.outputProperty);
                node.status({ fill: "blue", shape: "dot", text: `get: ${valDisplay}` });
                
                node.send(msg);

            } else {
                node.status({ fill: "red", shape: "ring", text: "global variable undefined" });
            }
        }

        // --- HELPER: Manage Event Subscription ---
        function establishListener() {
            setterNode = RED.nodes.getNode(node.targetNodeId);
            
            if (setterNode && setterNode.varName && node.updates === 'always') {
                if (updateListener) {
                    // Remove existing listener if we're retrying
                    RED.events.removeListener("bldgblocks-global-update", updateListener);
                }
                
                updateListener = function(evt) {
                    if (evt.key === setterNode.varName && evt.store === setterNode.storeName) {
                        sendValue(evt.data, {}); 
                    }
                };
                
                RED.events.on("bldgblocks-global-update", updateListener);
                
                // Clear retry interval once successful
                if (retryInterval) {
                    clearInterval(retryInterval);
                    retryInterval = null;
                }
                
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                return true;
            }
            return false;
        }

        // --- HANDLE MANUAL INPUT ---
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

        // --- HANDLE REACTIVE UPDATES ---
        if (node.updates === 'always') {
            // Try immediately
            if (!establishListener()) { 
                retryInterval = setInterval(() => {
                    if (establishListener() || retryCount >= maxRetries) {
                        clearInterval(retryInterval);
                        retryInterval = null;
                        if (retryCount >= maxRetries) {
                            node.error("Failed to connect to setter node after multiple attempts");
                            node.status({ fill: "red", shape: "ring", text: "Connection failed" });
                        }
                    }
                    retryCount++;
                }, retryDelays[Math.min(retryCount, maxRetries - 1)]);
            }
        }

        // --- CLEANUP ---
        node.on('close', function(removed, done) {
            if (retryInterval) {
                clearInterval(retryInterval);
            }
            if (removed && updateListener) {
                RED.events.removeListener("bldgblocks-global-update", updateListener);
            }
            done();
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
