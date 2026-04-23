module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function BldgBlocksJoinNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get configuration from the UI
        node.targetCount = parseInt(config.count) || 4;
        node.outputMode = config.outputMode === "trigger" ? "trigger" : "immediate";
        node.triggerContext = "trigger";
        
        // Parse excluded keys string into a Set for fast lookup
        // Split by comma, trim whitespace, and remove empty entries
        const exclusionString = config.excludedKeys || "";
        const excludedSet = new Set(
            exclusionString.split(',').map(s => s.trim()).filter(s => s.length > 0)
        );

        function buildStatusText(currentCount) {
            if (node.outputMode === "trigger" && currentCount >= node.targetCount) {
                return `ready: ${currentCount}/${node.targetCount}`;
            }

            return `${currentCount}/${node.targetCount} keys`;
        }

        function emitJoinedMessage(valueMap, send) {
            const outputMsg = RED.util.cloneMessage(valueMap);

            if (!outputMsg._msgid) {
                outputMsg._msgid = RED.util.generateId();
            }

            send(outputMsg);
        }

        // --- INPUT HANDLER ---
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) {
                    done();
                }
                return;
            }

            // Get current state from context
            let valueMap = node.context().get("valueMap") || {};
            const isTriggerMessage = node.outputMode === "trigger" && msg.context === node.triggerContext;

            if (!isTriggerMessage) {
                // Add properties from incoming message to the state
                Object.keys(msg).forEach(key => {
                    // Logic:
                    // 1. Value must exist (not undefined/null)
                    // 2. Key must NOT start with '_' (internal Node-RED props)
                    // 3. Key must NOT be in the user-defined excluded list
                    if (
                        msg[key] !== undefined &&
                        !key.startsWith('_') &&
                        !excludedSet.has(key)
                    ) {
                        valueMap[key] = msg[key];
                    }
                });

                // Save state back to context
                node.context().set("valueMap", valueMap);
            }
            
            // Calculate current unique key count
            const currentCount = Object.keys(valueMap).length;

            if (isTriggerMessage) {
                if (currentCount >= node.targetCount) {
                    utils.setStatusChanged(node, `triggered: ${currentCount}/${node.targetCount}`);
                    emitJoinedMessage(valueMap, send);
                } else {
                    utils.setStatusWarn(node, `waiting: ${currentCount}/${node.targetCount}`);
                }
            } else if (node.outputMode === "trigger") {
                if (currentCount >= node.targetCount) {
                    utils.setStatusOK(node, buildStatusText(currentCount));
                } else {
                    utils.setStatusChanged(node, buildStatusText(currentCount));
                }
            } else if (currentCount >= node.targetCount) {
                utils.setStatusOK(node, buildStatusText(currentCount));
                emitJoinedMessage(valueMap, send);
            } else {
                utils.setStatusChanged(node, buildStatusText(currentCount));
            }

            if (done) {
                done();
            }
        });

        node.on('close', function(removed, done) {
            if (removed) {
                node.context().set("valueMap", undefined);
            }
            done();
        });
    }
    RED.nodes.registerType("bldgblocks-join", BldgBlocksJoinNode);
}
