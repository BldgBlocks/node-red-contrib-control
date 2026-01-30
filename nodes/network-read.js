module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function NetworkReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.registry = RED.nodes.getNode(config.registry);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            
            try {
                if (!node.registry) {
                    utils.setStatusError(node, "Registry missing");
                    if (done) done();
                    return;
                }

                const currentEntry = node.registry.lookup(msg.pointId);
                if (!currentEntry) {
                    return utils.sendError(node, msg, done, `Not Registered: ${msg.pointId}`, msg.pointId);
                }
                
                const currentPath = currentEntry.path;
                const currentStore = currentEntry.store || "default";

                // Async Get
                let globalData = await utils.getGlobalState(node, currentPath, currentStore);

                if (!globalData || Object.keys(globalData).length === 0) { 
                    return utils.sendError(node, msg, done, `Global Data Empty: ${msg.pointId}`, msg.pointId);
                }

                msg = { ...globalData };
                
                const ptName = msg.metadata?.name ?? "Unknown";
                const ptVal = msg.value !== undefined ? msg.value : "No Value";
                const ptId = msg.network?.pointId ?? msg.pointId;

                const msgText = `Data Found. pointId: ${ptId} value: ${ptVal}`;
                
                utils.sendSuccess(node, msg, done, msgText, ptId, "ring");

            } catch (err) {
                node.error(err);
                utils.sendError(node, msg, done, `Internal Error: ${err.message}`, msg?.pointId);
            }
        });

        node.on('close', function(removed, done) {
            if (removed && node.registry) {
                node.registry.unregister(node.pointId, node.id);
            }
            done();
        });
    }
    RED.nodes.registerType("network-read", NetworkReadNode);
}
