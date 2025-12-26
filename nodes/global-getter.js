module.exports = function(RED) {
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload";
        node.updates = config.updates;
        node.detail = config.detail;
        
        let setterNode = null;
        let retryAction = null;
        let healthCheckAction = null;
        let updateListener = null;
        let retryCount = 0;
        const retryDelays = [0, 100, 500, 1000, 2000, 4000, 8000, 16000];
        const maxRetries = retryDelays.length - 1;
        
        // --- Process Wrapper and Send Msg ---
        function sendValue(storedObject, msgToReuse) {
            const msg = msgToReuse || {}; 

            if (storedObject !== undefined && storedObject !== null) {
                
                // CHECK: Is this our Wrapper Format? (Created by Global Setter)
                if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value')) {
                    
                    // Separate the Value from everything else (Rest operator)
                    // 'attributes' will contain: priority, units, metadata, topic, etc.
                    const { value, ...attributes } = storedObject;

                    // Set the Main Output (e.g. msg.payload = 75)
                    RED.util.setMessageProperty(msg, node.outputProperty, value);

                    // Merge all attributes onto the msg root
                    // This automatically handles priority, units, metadata, and any future fields
                    if (node.detail === "getObject") {
                        Object.assign(msg, attributes);
                    }

                } else {
                    // Handle Legacy/Raw values (not created by your Setter)
                    RED.util.setMessageProperty(msg, node.outputProperty, storedObject);
                    msg.metadata = { path: setterNode ? setterNode.varName : "unknown", legacy: true };
                }
                
                // Update Status
                let valDisplay = RED.util.getMessageProperty(msg, node.outputProperty);
                valDisplay = typeof valDisplay === "number" ? valDisplay.toFixed(2) : valDisplay;
                node.status({ fill: "blue", shape: "dot", text: `get: ${valDisplay}` });
                
                node.send(msg);

            } else {
                node.status({ fill: "red", shape: "ring", text: "global variable undefined" });
            }
        }

        // --- Manage Event Subscription ---
        function establishListener() {
            // Look for source node
            setterNode = RED.nodes.getNode(node.targetNodeId);
            
            // If found, subscribe
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
                if (retryAction) {
                    clearInterval(retryAction);
                    retryAction = null;
                }
                
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                return true;
            }
            return false;
        }

        // --- Maintain event subscription ---
        function startHealthCheck() {
            const healthCheckAction = () => {
                const listeners = RED.events.listeners("bldgblocks-global-update");
                const hasOurListener = listeners.includes(updateListener);
                
                if (!hasOurListener) {
                    node.warn("Event listener lost, reconnecting...");
                    if (establishListener()) {
                        node.status({ fill: "green", shape: "dot", text: "Reconnected" });
                    }
                }
                
                // Schedule next health check regardless of outcome
                setTimeout(healthCheckAction, 30000);
            };
            // Inital start
            setTimeout(healthCheckAction, 30000);
        }

        function subscribeWithRetry() {
            // Recursive retry
            retryAction = () => {
                if (retryCount >= maxRetries) {
                    node.error("Failed to connect to setter node after multiple attempts");
                    node.status({ fill: "red", shape: "ring", text: "Connection failed" });
                    return;
                }
                
                if (establishListener()) {
                    retryCount = 0;
                    return; // Success
                }
                
                retryCount++;
                setTimeout(retryAction, retryDelays[Math.min(retryCount, maxRetries - 1)]);
            };
            
            setTimeout(retryAction, retryDelays[0]);
        }

        // --- HANDLE MANUAL INPUT ---
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            setterNode ??= RED.nodes.getNode(node.targetNodeId);

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
            subscribeWithRetry();
            startHealthCheck();        
        }

        // --- CLEANUP ---
        node.on('close', function(removed, done) {
            if (healthCheckAction) {
                clearInterval(healthCheckAction);
            }
            if (retryAction) {
                clearInterval(retryAction);
            }
            if (removed && updateListener) {
                RED.events.removeListener("bldgblocks-global-update", updateListener);
            }
            done();
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
