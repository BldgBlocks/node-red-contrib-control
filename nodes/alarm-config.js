module.exports = function(RED) {
    
    function AlarmConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Register this registry with utils for global lookup
        const utils = require('./utils')(RED);
        utils.registerRegistryNode(node);
        
        // The Map: stores alarm metadata keyed by collector node ID (always unique)
        // Format: { "nodeId": { name: "Alarm Name", severity: "high", status: "active", ... } }
        node.alarms = new Map();

        // Register an alarm in the registry (keyed by nodeId for uniqueness)
        node.register = function(nodeId, meta) {
            if (!nodeId || typeof nodeId !== 'string') {
                return false;
            }

            if (node.alarms.has(nodeId)) {
                const existing = node.alarms.get(nodeId);
                // Merge updates (preserving existing fields not in new meta)
                meta = Object.assign({}, existing, meta);
            }
            node.alarms.set(nodeId, meta);
            return true;
        };

        // Unregister an alarm by node ID
        node.unregister = function(nodeId) {
            node.alarms.delete(nodeId);
        };

        // Lookup an alarm by node ID
        node.lookup = function(nodeId) {
            return node.alarms.get(nodeId);
        };

        // Update alarm status by node ID
        node.updateStatus = function(nodeId, status) {
            if (node.alarms.has(nodeId)) {
                const alarm = node.alarms.get(nodeId);
                alarm.status = status;  // 'active' or 'cleared'
                alarm.lastUpdate = new Date().toISOString();
                return true;
            }
            return false;
        };

        // Get all alarms
        node.getAll = function() {
            const arr = [];
            for (const [nodeId, meta] of node.alarms.entries()) {
                arr.push({ nodeId, ...meta });
            }
            return arr;
        };
    }
    RED.nodes.registerType("alarm-config", AlarmConfigNode);

    // --- HTTP Endpoint: List all alarms in a specific config ---
    // Route: /alarm-config/list/<ConfigID>
    RED.httpAdmin.get('/alarm-config/list/:configId', RED.auth.needsPermission('alarm-config.read'), function(req, res) {
        const configId = req.params.configId;
        
        // Find the alarm-config node
        const configNode = RED.nodes.getNode(configId);
        if (!configNode) {
            // Not deployed yet — return empty list so the editor can show a friendly message
            return res.json([]);
        }

        // Get all alarms from this config
        const alarms = configNode.getAll();
        
        // Sort by name
        alarms.sort((a, b) => a.name.localeCompare(b.name));
        
        res.json(alarms);
    });

    // --- HTTP Endpoint: Check if alarm exists ---
    // Route: /alarm-config/check/<ConfigID>/<AlarmName>/<CurrentNodeID>
    RED.httpAdmin.get('/alarm-config/check/:configId/:alarmName/:nodeId', RED.auth.needsPermission('alarm-config.read'), function(req, res) {
        const configId = req.params.configId;
        const alarmName = decodeURIComponent(req.params.alarmName);
        const checkNodeId = req.params.nodeId;
        
        // Find the alarm-config node
        const configNode = RED.nodes.getNode(configId);
        
        let entry = null;
        let result = "unavailable";
        let collision = false;

        if (!configNode) {
            // Config exists in editor but not deployed yet, or doesn't exist
            return res.json({ status: result, warning: "Configuration not deployed" });
        }

        // Check for the alarm — map is keyed by nodeId
        entry = configNode.lookup(checkNodeId);

        if (entry) {
            result = "assigned";
        } else {
            // Check if any other node has the same alarm name (name collision check)
            const allAlarms = configNode.getAll();
            const nameMatch = allAlarms.find(a => a.name === alarmName && a.nodeId !== checkNodeId);
            if (nameMatch) {
                collision = true;
                entry = nameMatch;
            }
        }

        if (collision) {
            result = "collision";
        } else if (!entry) {
            result = "available";
        }

        res.json({ status: result, details: entry });
    });
};
