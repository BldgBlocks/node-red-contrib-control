module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function NetworkRegisterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.registry = RED.nodes.getNode(config.registry);
        node.pointId = parseInt(config.pointId);
        node.writable = !!config.writable;
        node.isRegistered = false;

        // Initial Registration
        if (node.registry && !isNaN(node.pointId)) {
            const success = node.registry.register(node.pointId, {
                nodeId: node.id, 
                writable: node.writable,
                path: "not ready",
                store: "not ready"
            });

            if (success) {
                node.isRegistered = true;
                node.status({ fill: "yellow", shape: "ring", text: `ID: ${node.pointId} (Waiting)` });
            } else {
                node.error(`Point ID ${node.pointId} is already in use.`);
                node.status({ fill: "red", shape: "dot", text: "ID Conflict" });
            }
        }

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Pre-flight
                if (!node.isRegistered) return utils.sendError(node, null, done, "Node not registered");
                if (!msg || typeof msg !== "object") return utils.sendError(node, null, done, "Invalid msg object");
                if (!node.registry) return utils.sendError(node, msg, done, "Registry config missing", node.pointId);

                // Validate Fields
                if (!msg.activePriority || !msg.metadata?.path || !msg.metadata?.store) {
                     return utils.sendError(node, msg, done, "Missing required fields (metadata.path/store, activePriority)", node.pointId);
                }

                // Logic & State Update
                let pointData = node.registry.lookup(node.pointId);

                const incoming = {
                    writable: node.writable,
                    path: msg.metadata.path,
                    store: msg.metadata.store
                };

                const needsUpdate = !pointData 
                    || pointData.nodeId !== node.id 
                    || pointData.writable !== incoming.writable 
                    || pointData.path !== incoming.path 
                    || pointData.store !== incoming.store;

                if (needsUpdate) {
                    node.registry.register(node.pointId, {
                        nodeId: node.id, 
                        writable: node.writable,
                        path: incoming.path,
                        store: incoming.store
                    });
                    
                    pointData = node.registry.lookup(node.pointId);
                    const currentStore = pointData.store || "default";

                    // Async Get
                    const globalData = await utils.getGlobalState(node, pointData.path, currentStore);

                    if (!globalData || Object.keys(globalData).length === 0) { 
                        return utils.sendError(node, msg, done, `Global missing: (${currentStore})::${pointData.path}`, node.pointId);
                    }

                    const networkObject = { 
                        ...globalData, 
                        network: {
                            registry: node.registry.name,
                            pointId: node.pointId,
                            writable: node.writable
                        }
                    };
                    
                    // Async Set
                    await utils.setGlobalState(node, pointData.path, currentStore, networkObject);

                    const statusText = `Registered: (${currentStore})::${pointData.path}::${node.pointId}`;
                    return utils.sendSuccess(node, networkObject, done, statusText, node.pointId, "dot");
                }

                // Passthrough
                const prefix = msg.activePriority === 'default' ? '' : 'P';
                const statusText = `Passthrough: ${prefix}${msg.activePriority}:${msg.value}${msg.units}`;
                utils.sendSuccess(node, msg, done, statusText, node.pointId, "ring");

            } catch (err) {
                node.error(err);
                utils.sendError(node, msg, done, `Internal Error: ${err.message}`, node.pointId);
            }
        });

        node.on('close', function(removed, done) {
            if (removed && node.registry && node.isRegistered) {
                node.registry.unregister(node.pointId, node.pointId);
            }
            done();
        });
    }
    RED.nodes.registerType("network-register", NetworkRegisterNode);
}
