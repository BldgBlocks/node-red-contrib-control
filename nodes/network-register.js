module.exports = function(RED) {
    function NetworkRegisterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Config
        node.registry = RED.nodes.getNode(config.registry);
        node.pointId = parseInt(config.pointId);
        node.writable = !!config.writable;
        node.isRegistered = false;

        // Initial Registration
        if (node.registry && !isNaN(node.pointId)) {
            const success = node.registry.register(node.pointId, {
                nodeId: node.id, // for point registry collision checks
                writable: node.writable,
                path: "not ready",
                store: "not ready"
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
            
            // Message should contain data & metadata from a global setter node
            const missingFields = [];

            if (!msg.metadata) missingFields.push("metadata");
            if (msg.value === undefined) missingFields.push("value");
            if (msg.units === undefined) missingFields.push("units");
            if (!msg.activePriority) missingFields.push("activePriority");

            // Check nested metadata properties
            if (msg.metadata) {
                if (!msg.metadata.path) missingFields.push("metadata.path");
                if (!msg.metadata.store) missingFields.push("metadata.store");
                if (!msg.metadata.sourceId) missingFields.push("metadata.sourceId");
            } else {
                missingFields.push("metadata (entire object)");
            }

            if (missingFields.length > 0) {
                const specificMessage = `Missing required fields: ${missingFields.join(', ')}`;
                node.status({ 
                    fill: "red", 
                    shape: "ring", 
                    text: `${missingFields.length} missing: ${missingFields.slice(0, 3).join(', ')}${missingFields.length > 3 ? '...' : ''}` 
                });
                
                node.send(msg);
                if (done) done();
                return;
            }


            // Lookup current registration
            let pointData = node.registry.lookup(node.pointId);

            const incoming = {
                writable: node.writable,
                path: msg.metadata.path,
                store: msg.metadata.store
            };

            // Update Registry on change
            if (!pointData 
                || pointData.nodeId !== node.nodeId
                || pointData.writable !== incoming.writable 
                || pointData.path !== incoming.path 
                || pointData.store !== incoming.store) {
                    
                node.registry.register(node.pointId, {
                    nodeId: node.id, // for point registry collision checks
                    writable: node.writable,
                    path: msg.metadata.path,
                    store: msg.metadata.store
                });
                
                pointData = node.registry.lookup(node.pointId);

                let globalData = {};
                globalData = node.context().global.get(pointData.path, pointData.store);

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

                const networkObject = { ...globalData, network: network};
                const message = `Registered: (${pointData.store ?? "default"})::${pointData.path}::${node.pointId}`;
                
                node.context().global.set(pointData.path, networkObject, pointData.store);
                node.status({ fill: "blue", shape: "dot", text: `${message}` });
                msg.status = { status: "success", pointId: node.pointId, error: `${message}` };

                node.send(networkObject);
                if (done) done();
                return;
            }

            // Make it here, then message should match global and ready to go
            // Pass through msg
            const prefix = msg.activePriority === 'default' ? '' : 'P';
            const message = `Passthrough: ${prefix}${msg.activePriority}:${msg.value}${msg.units}`;
            node.status({ fill: "blue", shape: "ring", text: message });
            
            node.send(msg);
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
