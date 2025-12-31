module.exports = function(RED) {
    function NetworkPointRegistryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // The Map: { 101: { nodeId: "abc.123", writable: true, ... } }
        node.points = new Map();

        node.register = function(pointId, meta) {
            const pid = parseInt(pointId);
            if (isNaN(pid)) return false;

            if (node.points.has(pid)) {
                const existing = node.points.get(pid);
                // Allow update if it's the same node
                if (existing.nodeId !== meta.nodeId) {
                    return false;
                }
                // Merge updates
                meta = Object.assign({}, existing, meta);
            }
            node.points.set(pid, meta);
            return true;
        };

        node.unregister = function(pointId, nodeId) {
            const pid = parseInt(pointId);
            if (node.points.has(pid) && node.points.get(pid).nodeId === nodeId) {
                node.points.delete(pid);
            }
        };

        node.lookup = function(pointId) {
            return node.points.get(parseInt(pointId));
        };
    }
    RED.nodes.registerType("network-point-registry", NetworkPointRegistryNode);

    // --- HTTP Endpoint for Editor Validation ---
    // Route: /network-point-registry/check/<RegistryID>/<PointID>/<CurrentNodeID>
    RED.httpAdmin.get('/network-point-registry/check/:registryId/:pointId/:nodeId', RED.auth.needsPermission('network-point-registry.read'), function(req, res) {
        const registryId = req.params.registryId;
        const checkId = parseInt(req.params.pointId);
        const checkNodeId = req.params.nodeId;
        
        // Find the specific Registry Config Node
        const regNode = RED.nodes.getNode(registryId);

        let entry = null;
        let result = "unavailable";
        let collision = false;

        if (!regNode) {
            // Registry exists in editor but not deployed yet, or doesn't exist
            return res.json({ status: result, warning: "Registry not deployed" });
        }

        // Check that specific registry for the ID
        if (regNode.points.has(checkId)) {
            entry = regNode.points.get(checkId);
            // Collision if ID exists AND belongs to a different node
            if (entry.nodeId !== checkNodeId) {
                collision = true;
            }
        }

        if (collision) {
            result = "collision";
        } else if (!collision && entry) {
            result = "assigned";
        } else{
            result = "available";
        }

        res.json({ status: result, details: entry });
    });


    RED.httpAdmin.get('/network-point-registry/list/:registryId', RED.auth.needsPermission('network-point-registry.read'), function(req, res) {
        const reg = RED.nodes.getNode(req.params.registryId);
        if (!reg) return res.status(404).json({error:'not found'});

        // Convert Map to array
        const arr = [];
        for (const [pid, meta] of reg.points.entries()) {
            arr.push({ id: pid, ...meta });
        }
        res.json(arr);
    });
};
