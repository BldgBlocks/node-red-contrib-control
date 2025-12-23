module.exports = function(RED) {
    function NetworkReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.registry = RED.nodes.getNode(config.registry);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            
            let currentPath = null;
            let currentStore = "default";

            if (node.registry) {
                let currentEntry = node.registry.lookup(msg.pointId);
                
                if (!currentEntry) {
                    node.status({ fill: "red", shape: "ring", text: `Requested pointId not registered` });
                    msg.status = { status: "fail", pointId: msg.pointId, error: `Point Not Registered: ${msg.pointId}` };
                    node.send(msg);
                    if (done) done();
                    return;
                }
                
                currentPath = currentEntry.path;
                currentStore = currentEntry.store || "default";
                let globalData = node.context().global.get(currentPath, currentStore) || {};

                if (globalData === null || Object.keys(globalData).length === 0) { 
                    node.status({ fill: "red", shape: "ring", text: `Global data doesn't exist, waiting...` });
                    msg.status = { status: "fail", pointId: msg.pointId, error: `Point Not Found: ${msg.pointId}` };
                    node.send(msg);
                    if (done) done();
                    return;
                }

                msg = { ...globalData };
                node.status({ fill: "blue", shape: "ring", text: `processing request` });
                msg.status = { status: "success", pointId: msg.pointId, msg: `Point returned. pointId: ${msg.pointId} value: ${globalData.value}` };
                node.send(msg);
                
                if (done) done();
            } else {
                node.status({ fill: "red", shape: "ring", text: `Registry not found. Create config node.` });
                if (done) done();
                return;
            }
        });

        // Cleanup
        node.on('close', function(removed, done) {
            if (removed && node.registry) {
                node.registry.unregister(node.pointId, node.id);
            }
            done();
        });
    }
    RED.nodes.registerType("network-read", NetworkReadNode);
}
