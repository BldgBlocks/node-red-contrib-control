module.exports = function(RED) {
    
    function AlarmConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Register this registry with utils for global lookup
        const utils = require('./utils')(RED);
        utils.registerRegistryNode(node);
        
        // The Map: stores alarm metadata by name
        // Format: { "alarmName": { nodeId: "abc.123", pointId: 101, severity: "high", status: "active", ... } }
        node.alarms = new Map();

        // Register an alarm in the registry
        node.register = function(alarmName, meta) {
            if (!alarmName || typeof alarmName !== 'string') {
                return false;
            }

            if (node.alarms.has(alarmName)) {
                const existing = node.alarms.get(alarmName);
                // Allow update if it's the same node
                if (existing.nodeId !== meta.nodeId) {
                    return false;
                }
                // Merge updates (preserving status if provided)
                meta = Object.assign({}, existing, meta);
            }
            node.alarms.set(alarmName, meta);
            return true;
        };

        // Unregister an alarm
        node.unregister = function(alarmName, nodeId) {
            if (node.alarms.has(alarmName) && node.alarms.get(alarmName).nodeId === nodeId) {
                node.alarms.delete(alarmName);
            }
        };

        // Lookup an alarm by name
        node.lookup = function(alarmName) {
            return node.alarms.get(alarmName);
        };

        // Update alarm status
        node.updateStatus = function(alarmName, status) {
            if (node.alarms.has(alarmName)) {
                const alarm = node.alarms.get(alarmName);
                alarm.status = status;  // 'active' or 'cleared'
                alarm.lastUpdate = new Date().toISOString();
                return true;
            }
            return false;
        };

        // Get all alarms
        node.getAll = function() {
            const arr = [];
            for (const [name, meta] of node.alarms.entries()) {
                arr.push({ name, ...meta });
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
            return res.status(404).json({ error: 'Configuration node not found' });
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

        // Check for the alarm
        entry = configNode.lookup(alarmName);
        if (entry) {
            // Collision if alarm exists AND belongs to a different node
            if (entry.nodeId !== checkNodeId) {
                collision = true;
            }
        }

        if (collision) {
            result = "collision";
        } else if (!collision && entry) {
            result = "assigned";
        } else {
            result = "available";
        }

        res.json({ status: result, details: entry });
    });
};
