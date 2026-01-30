module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function BldgBlocksJoinNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Get configuration from the UI
        node.targetCount = parseInt(config.count) || 4;
        
        // Parse excluded keys string into a Set for fast lookup
        // Split by comma, trim whitespace, and remove empty entries
        const exclusionString = config.excludedKeys || "";
        const excludedSet = new Set(
            exclusionString.split(',').map(s => s.trim()).filter(s => s.length > 0)
        );

        // --- INPUT HANDLER ---
        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Get current state from context
            let valueMap = node.context().get("valueMap") || {};
            
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

            // Calculate current unique key count
            const currentCount = Object.keys(valueMap).length;

            // Update status
            if (currentCount >= node.targetCount) {
                utils.setStatusOK(node, `${currentCount}/${node.targetCount} keys`);
            } else {
                utils.setStatusChanged(node, `${currentCount}/${node.targetCount} keys`);
            }

            // Save state back to context
            node.context().set("valueMap", valueMap);

            // Check if we hit the target
            if (currentCount >= node.targetCount) {
                // Clone the map to create the output message
                const outputMsg = RED.util.cloneMessage(valueMap);
                
                // Ensure we have a msgid
                if (!outputMsg._msgid) {
                    outputMsg._msgid = RED.util.generateId();
                }

                send(outputMsg);
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
