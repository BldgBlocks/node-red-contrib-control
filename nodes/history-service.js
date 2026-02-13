module.exports = function(RED) {
    const utils = require("./utils")(RED);

    function HistoryServiceNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        const node = this;

        // Validate configuration
        if (!node.historyConfig) {
            utils.setStatusError(node, "missing history config");
            return;
        }

        // Generate matching event name based on history-config ID
        const eventName = `bldgblocks:history:${node.historyConfig.id}`;

        // Status throttling - prevent rapid status updates from fast-streaming histories
        let lastRelayedName = null;
        let statusDirty = false;
        let statusInterval = null;

        statusInterval = setInterval(() => {
            if (statusDirty && lastRelayedName) {
                utils.setStatusChanged(node, `relayed: ${lastRelayedName}`);
                statusDirty = false;
            }
        }, 2000);

        // Listen for events from history-collector nodes with this config
        const eventListener = (eventData) => {
            // Guard against invalid event data
            if (!eventData || typeof eventData !== 'object') {
                utils.setStatusError(node, "invalid event data");
                node.warn("Invalid event data received");
                return;
            }

            // Send event data directly as payload (already in InfluxDB batch format)
            const msg = { 
                payload: eventData
            };
            
            node.send(msg);
            lastRelayedName = eventData.measurement || 'data';
            statusDirty = true;
        };

        // Subscribe to events
        RED.events.on(eventName, eventListener);
        utils.setStatusOK(node, `listening on ${node.historyConfig.name}`);

        node.on("close", function(done) {
            // Clear status interval
            if (statusInterval) {
                clearInterval(statusInterval);
                statusInterval = null;
            }
            // Unsubscribe from events on close
            RED.events.off(eventName, eventListener);
            done();
        });
    }

    RED.nodes.registerType("history-service", HistoryServiceNode);
};
