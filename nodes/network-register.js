module.exports = function(RED) {
    function NetworkRegisterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Config
        node.registry = RED.nodes.getNode(config.registry);
        node.pointId = parseInt(config.pointId);
        node.writable = !!config.writable;
        node.store = config.store;
        node.isRegistered = false;

        // Initial Registration
        if (node.registry && !isNaN(node.pointId)) {
            const success = node.registry.register(node.pointId, {
                nodeId: node.id,
                writable: node.writable,
                path: null,
                store: node.store
            });

            if (success) {
                node.isRegistered = true;
                node.status({ fill: "blue", shape: "ring", text: `ID: ${node.pointId} (Waiting)` });
            } else {
                node.error(`Point ID ${node.pointId} is already in use.`);
                node.status({ fill: "red", shape: "dot", text: "ID Conflict" });
            }
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            

            // Nothing to do. Return.
            if (!node.isRegistered) {
                node.status({ fill: "red", shape: "ring", text: `Not registered` });
                if (done) done();
                return;
            }

            if (!msg || typeof msg !== "object") {
                const message = `Invalid msg.`;
                node.status({ fill: "red", shape: "ring", text: `${message}` });
                if (done) done();
                return;
            }

            if (!node.registry) {
                const message = `Registry not found. Create config node.`;
                node.status({ fill: "red", shape: "ring", text: `${message}` });
                msg.status = { status: "fail", pointId: node.pointId, error: `${message}` };
                node.send(msg);
                if (done) done();
                return;
            }
            
            if (!msg.metadata) {
                const message = `Registration requires the appropriate msg.metadata from a global setter node`;
                node.status({ fill: "red", shape: "ring", text: `${message}` });
                msg.status = { status: "fail", pointId: node.pointId, error: `${message}` };
                node.send(msg);
                if (done) done();
                return;
            }

            let pointData = node.registry.lookup(node.pointId);
            let globalData = {};
            if (pointData.path && typeof pointData.path === "string") {
                globalData = node.context().global.get(pointData.path, pointData.store);
            } else {
                globalData = node.context().global.get(msg.metadata.path, msg.metadata.store);
            }

            const incoming = {
                nodeId: node.id,
                writable: node.writable,
                path: msg.metadata.path,
                store: node.store
            };

            // Update Registry on change
            if (!pointData || JSON.stringify(pointData) !== JSON.stringify(incoming)) {
                node.registry.register(node.pointId, {
                    nodeId: node.id,
                    writable: node.writable,
                    path: msg.metadata.path,
                    store: node.store
                });
                
                pointData = node.registry.lookup(node.pointId);

                if (globalData === null || Object.keys(globalData).length === 0) { 
                    const message = `Global data doesn't exist for (${pointData.store ?? "default"})::${pointData.path}::${node.pointId}`;
                    node.status({ fill: "red", shape: "ring", text: `${message}` });
                    msg.status = { status: "fail", pointId: node.pointId, error: `${message}` };
                    if (done) done();
                    return;
                }

                let network = {
                    registry: node.registry.name,
                    pointId: node.pointId,
                    writable: node.writable
                }

                const obj = { ...globalData, network: network};
                const message = `Registered: (${pointData.store ?? "default"})::${pointData.path}::${node.pointId}`;
                
                node.context().global.set(pointData.path, obj, pointData.store);
                node.status({ fill: "blue", shape: "dot", text: `${message}` });
                msg.status = { status: "success", pointId: node.pointId, error: `${message}` };

                node.send(obj);
                if (done) done();
                return;
            }

            // Pass through msg, just registering.
            node.status({ fill: "blue", shape: "dot", text: `Passthrough: ${globalData.activePriority === 'default' ? 'default' : 'P' + globalData.activePriority}:${globalData.value}${globalData.units}` });
            
            node.send({ globalData });
            if (done) done();
            return;
        });

        // Cleanup
        node.on('close', function(removed, done) {
            if (removed && node.registry && node.isRegistered) {
                node.registry.unregister(node.pointId, node.pointId);
            }
            done();
        });
    }
    RED.nodes.registerType("network-register", NetworkRegisterNode);
}
