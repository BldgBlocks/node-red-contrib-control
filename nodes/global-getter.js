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
        node.showStatus = config.showStatus !== false;
        
        let setterNode = null;
        let retryTimeout = null;
        let healthCheckTimeout = null;
        let updateListener = null;
        let retryCount = 0;
        let closed = false;
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
                
                if (node.showStatus) {
                    let valDisplay = storedObject && storedObject.hasOwnProperty('value') ? storedObject.value : storedObject;
                    if (valDisplay === null) valDisplay = "null";
                    else if (valDisplay === undefined) valDisplay = "undefined";
                    else if (typeof valDisplay === "object") valDisplay = JSON.stringify(valDisplay);
                    else valDisplay = String(valDisplay);

                    // Trim to 64 characters with ellipsis
                    if (valDisplay.length > 64) {
                        valDisplay = valDisplay.substring(0, 64) + "...";
                    }

                    utils.sendSuccess(node, msg, done, `get: ${valDisplay}`, null, "dot");
                } else {
                    utils.sendSuccess(node, msg, done, "get", null, "dot");
                }
            } else {
                utils.sendError(node, msg, done, "global variable undefined");
            }
        }

        // --- Connection Logic ---
        function establishListener() {
            setterNode = RED.nodes.getNode(node.targetNodeId);
            
            if (setterNode && setterNode.varName && node.updates === 'always') {
                if (updateListener) {
                    RED.events.removeListener("bldgblocks:global:value-changed", updateListener);
                }
                
                updateListener = function(evt) {
                    if (evt.key === setterNode.varName && evt.store === setterNode.storeName) {
                        // Event Trigger: Pass null for done, as it's not a node input
                        sendValue(evt.data, {}, null); 
                    }
                };
                
                RED.events.on("bldgblocks:global:value-changed", updateListener);
                
                if (retryTimeout) {
                    clearTimeout(retryTimeout);
                    retryTimeout = null;
                }
                
                utils.setStatusOK(node, "Connected");
                return true;
            }
            return false;
        }

        function startHealthCheck() {
            const check = () => {
                if (closed) return;
                if (!updateListener) {
                    healthCheckTimeout = setTimeout(check, 30000);
                    return;
                }
                const listeners = RED.events.listeners("bldgblocks:global:value-changed");
                const hasOurListener = listeners.includes(updateListener);
                if (!hasOurListener) {
                    node.warn("Event listener lost, reconnecting...");
                    if (establishListener()) {
                        utils.setStatusOK(node, "Reconnected");
                    }
                }
                healthCheckTimeout = setTimeout(check, 30000);
            };
            healthCheckTimeout = setTimeout(check, 30000);
        }

        function subscribeWithRetry() {
            function attempt() {
                if (closed) return;
                if (retryCount >= maxRetries) {
                    utils.sendError(node, null, null, "Connection failed");
                    return;
                }
                if (establishListener()) {
                    retryCount = 0;
                    return; 
                }
                retryCount++;
                retryTimeout = setTimeout(attempt, retryDelays[Math.min(retryCount, maxRetries - 1)]);
            }
            retryTimeout = setTimeout(attempt, retryDelays[0]);
        }

        // --- INPUT HANDLER ---
        node.on('input', async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            try {
                setterNode ??= RED.nodes.getNode(node.targetNodeId);

                if (setterNode && setterNode.varName) {
                    // Async Get - required default store to keep values in memory for polled getter nodes. 
                    // 'persistent' for cross reboot storage.
                    let storedObject = await utils.getGlobalState(node, setterNode.varName, 'default');
                    if (!storedObject) {
                        // Fallback to persistent store if not found in default. Should not happen normally.
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
            closed = true;
            if (healthCheckTimeout) {
                clearTimeout(healthCheckTimeout);
                healthCheckTimeout = null;
            }
            if (retryTimeout) {
                clearTimeout(retryTimeout);
                retryTimeout = null;
            }
            if (updateListener) {
                RED.events.removeListener("bldgblocks:global:value-changed", updateListener);
                updateListener = null;
            }
            done();
        });
    }
    RED.nodes.registerType("global-getter", GlobalGetterNode);
}
