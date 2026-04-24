module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

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

        function shouldExcludePath(path) {
            for (const excludedPath of excludedSet) {
                if (path === excludedPath || path.startsWith(`${excludedPath}.`)) {
                    return true;
                }
            }

            return false;
        }

        function flattenObjectToLeafMap(source, target, options = {}, parentPath = "") {
            if (!source || typeof source !== "object") {
                return;
            }

            Object.keys(source).forEach(key => {
                if (!parentPath && key.startsWith("_")) {
                    return;
                }

                const path = parentPath ? `${parentPath}.${key}` : key;

                if (options.applyExclusions && shouldExcludePath(path)) {
                    return;
                }

                const value = source[key];

                if (value === undefined) {
                    return;
                }

                if (isPlainObject(value)) {
                    const childKeys = Object.keys(value);

                    if (childKeys.length === 0) {
                        target[path] = {};
                        return;
                    }

                    flattenObjectToLeafMap(value, target, options, path);
                    return;
                }

                target[path] = RED.util.cloneMessage(value);
            });
        }

        function getFlatValueMap() {
            const storedValueMap = node.context().get("valueMap") || {};

            if (Object.keys(storedValueMap).some(key => key.includes("."))) {
                return storedValueMap;
            }

            const flattenedValueMap = {};
            flattenObjectToLeafMap(storedValueMap, flattenedValueMap);
            return flattenedValueMap;
        }

        function buildStatusText(currentCount) {
            if (node.outputMode === "trigger" && currentCount >= node.targetCount) {
                return `ready: ${currentCount}/${node.targetCount}`;
            }

            return `${currentCount}/${node.targetCount} keys`;
        }

        function emitJoinedMessage(valueMap, send) {
            const outputMsg = {};

            Object.keys(valueMap).forEach(path => {
                RED.util.setMessageProperty(outputMsg, path, RED.util.cloneMessage(valueMap[path]), true);
            });

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
            let valueMap = getFlatValueMap();
            const isTriggerMessage = node.outputMode === "trigger" && msg.context === node.triggerContext;

            if (!isTriggerMessage) {
                const updatedValueMap = { ...valueMap };
                flattenObjectToLeafMap(msg, updatedValueMap, { applyExclusions: true });
                valueMap = updatedValueMap;

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
