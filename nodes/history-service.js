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

        // Listen for events from history-collector nodes with this config
        const eventListener = (eventData) => {
            // Guard against invalid event data
            if (!eventData || typeof eventData !== 'object') {
                utils.setStatusError(node, "invalid event data");
                node.warn("Invalid event data received");
                return;
            }

            // Create output message with the event data as payload
            // Preserve topic if it exists in the event data
            const msg = { 
                payload: eventData,
                topic: eventData.topic
            };
            
            node.send(msg);
            
            // Update status
            utils.setStatusChanged(node, `relayed: ${eventData.seriesName || 'data'}`);
        };

        // Subscribe to events
        RED.events.on(eventName, eventListener);
        utils.setStatusOK(node, `listening on ${node.historyConfig.name}`);

        node.on("close", function(done) {
            // Unsubscribe from events on close
            RED.events.off(eventName, eventListener);
            done();
        });
    }

    RED.nodes.registerType("history-service", HistoryServiceNode);
};
