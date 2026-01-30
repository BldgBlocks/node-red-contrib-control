module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function GlobalGetterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.targetNodeId = config.targetNode;
        node.outputProperty = config.outputProperty || "payload";
        node.dropdownPath = config.dropdownPath || "";
        node.updates = config.updates;
        node.detail = config.detail;
        
        let setterNode = null;
        let retryAction = null;
        let healthCheckAction = null;
        let updateListener = null;
        let retryCount = 0;
        const retryDelays = [0, 100, 500, 1000, 2000, 4000, 8000, 16000];
        const maxRetries = retryDelays.length - 1;
        
        // --- Output Helper ---
        function sendValue(storedObject, msgToReuse, done) {
            const msg = RED.util.cloneMessage(msgToReuse) || {};

            if (storedObject !== undefined && storedObject !== null) {
                // Check if this is our custom wrapper object
                if (storedObject && typeof storedObject === 'object' && storedObject.hasOwnProperty('value')) {                    
                    if (node.detail === "getObject") {
                        Object.assign(msg, storedObject);
                    }
                    if (config.outputPropertyType === "flow" || config.outputPropertyType === "dropdown") {
                        if (config.outputProperty === "sourceToFlow") {
                            node.context().flow.set(node.dropdownPath, storedObject.value);
                        } else {
                            node.context().flow.set(node.outputProperty, storedObject.value);
                        }
                    } else {
                        RED.util.setMessageProperty(msg, node.outputProperty, storedObject.value);
                    }
                } else {
                    // Legacy/Raw values
                    if (config.outputPropertyType === "flow" || config.outputPropertyType === "dropdown") {
                        if (config.outputProperty === "sourceToFlow") {
                            node.context().flow.set(node.dropdownPath, storedObject);
                        } else {
                            node.context().flow.set(node.outputProperty, storedObject);
                        }
                    } else {
                        RED.util.setMessageProperty(msg, node.outputProperty, storedObject);
                    }
                    msg.metadata = { path: setterNode ? setterNode.varName : "unknown", legacy: true };
                }
                
                let valDisplay = storedObject.value;
                if (valDisplay === null) valDisplay = "null";
                else if (valDisplay === undefined) valDisplay = "undefined";
                else if (typeof valDisplay === "object") valDisplay = JSON.stringify(valDisplay);
                else valDisplay = typeof valDisplay === "number" ? valDisplay : valDisplay;
                
                utils.sendSuccess(node, msg, done, `get: ${valDisplay}`, null, "dot");
            } else {
                utils.sendError(node, msg, done, "global variable undefined");
            }
        }

        // --- Connection Logic ---
        function establishListener() {
            setterNode = RED.nodes.getNode(node.targetNodeId);
            
            if (setterNode && setterNode.varName && node.updates === 'always') {
                if (updateListener) {
                    RED.events.removeListener("bldgblocks-global-update", updateListener);
                }
                
                updateListener = function(evt) {
                    if (evt.key === setterNode.varName && evt.store === setterNode.storeName) {
                        // Event Trigger: Pass null for done, as it's not a node input
                        sendValue(evt.data, {}, null); 
                    }
                };
                
                RED.events.on("bldgblocks-global-update", updateListener);
                
                if (retryAction) {
                    clearInterval(retryAction);
                    retryAction = null;
                }
                
                utils.setStatusOK(node, "Connected");
                return true;
            }
            return false;
        }

        function startHealthCheck() {
            const check = () => {
                const listeners = RED.events.listeners("bldgblocks-global-update");
                const hasOurListener = listeners.includes(updateListener);
                if (!hasOurListener) {
                    node.warn("Event listener lost, reconnecting...");
                    if (establishListener()) {
                        utils.setStatusOK(node, "Reconnected");
                    }
                }
                setTimeout(check, 30000);
            };
            setTimeout(check, 30000);
        }

        function subscribeWithRetry() {
            retryAction = () => {
                if (retryCount >= maxRetries) {
                    utils.sendError(node, null, null, "Connection failed");
                    return;
                }
                if (establishListener()) {
                    retryCount = 0;
                    return; 
                }
                retryCount++;
                setTimeout(retryAction, retryDelays[Math.min(retryCount, maxRetries - 1)]);
            };
            setTimeout(retryAction, retryDelays[0]);
        }

        // --- INPUT HANDLER ---
        node.on('input', async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            try {
                setterNode ??= RED.nodes.getNode(node.targetNodeId);

                if (setterNode && setterNode.varName) {
                    // Async Get - required default store to keep values in memory for polled getter nodes. 
                    // 'persistant' for cross reboot storage.
                    let storedObject = await utils.getGlobalState(node, setterNode.varName, 'default');
                    if (!storedObject) {
                        // Fallback to persistant store if not found in default. Should not happen normally.
                        storedObject = await utils.getGlobalState(node, setterNode.varName, setterNode.storeName);
                    }
                    sendValue(storedObject, msg, done);
                } else {
                    node.warn("Source node not found or not configured.");
                    utils.sendError(node, msg, done, "Source node not found");
                }
            } catch (err) {
                node.error(err);
                utils.sendError(node, msg, done, `Internal Error: ${err.message}`);
            }
        });

        // --- INIT ---
        if (node.updates === 'always') {
            subscribeWithRetry();
            startHealthCheck();        
        }

        node.on('close', function(removed, done) {
            if (healthCheckAction) clearInterval(healthCheckAction);
            if (retryAction) clearInterval(retryAction);
            if (removed && updateListener) {
                RED.events.removeListener("bldgblocks-global-update", updateListener);
            }
            done();
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
