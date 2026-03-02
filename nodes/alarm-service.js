module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function AlarmServiceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize configuration
        node.name = config.name || "alarm-service";
        node.filterTopic = config.filterTopic || "";  // Optional: only listen to alarms with this topic
        node.filterPriority = config.filterPriority || "";  // Optional: only listen to this priority

        // Runtime state
        node.activeAlarms = new Map();  // Map of topic → { state, data, timestamp }
        node.alarmListener = null;

        utils.setStatusOK(node, "listening");

        // ====================================================================
        // Handle alarm events from collectors
        // ====================================================================
        node.alarmListener = function(eventData) {
            // Filter by topic if configured
            if (node.filterTopic && eventData.topic !== node.filterTopic) {
                return;
            }

            // Filter by priority if configured
            if (node.filterPriority && eventData.priority !== node.filterPriority) {
                return;
            }

            // Use topic as the key (allows multiple alarms with different topics)
            const key = eventData.topic || `alarm_${eventData.nodeId}`;

            // Update active alarms map
            if (eventData.state === true) {
                // Alarm triggered
                node.activeAlarms.set(key, {
                    state: true,
                    data: eventData,
                    timestamp: new Date(eventData.timestamp)
                });

                // Update status to show active alarm count
                const activeCount = node.activeAlarms.size;
                utils.setStatusError(node, `${activeCount} active alarm(s)`);

                // Send alarm message with status
                const msg = {
                    alarm: eventData,
                    status: { state: "active", transition: eventData.transition },
                    activeAlarmCount: activeCount,
                    alarmKey: key
                };
                node.send(msg);

            } else if (eventData.state === false) {
                // Alarm cleared
                if (node.activeAlarms.has(key)) {
                    const clearedAlarm = node.activeAlarms.get(key);
                    node.activeAlarms.delete(key);

                    // Update status
                    const activeCount = node.activeAlarms.size;
                    if (activeCount === 0) {
                        utils.setStatusOK(node, "listening (no active alarms)");
                    } else {
                        utils.setStatusWarn(node, `${activeCount} active alarm(s)`);
                    }

                    // Send clear message with status
                    const msg = {
                        alarm: eventData,
                        status: { state: "cleared", transition: eventData.transition },
                        activeAlarmCount: activeCount,
                        alarmKey: key
                    };
                    node.send(msg);
                }
            }
        };

        // Listen to the fixed alarm event
        RED.events.on("bldgblocks:alarms:state-change", node.alarmListener);

        // Handle wired input messages (optional - can relay or query status)
        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle control messages
            if (msg.hasOwnProperty("context")) {
                if (msg.context === "getStatus") {
                    // Query current alarm status
                    const alarmArray = Array.from(node.activeAlarms.values()).map(a => a.data);
                    const statusMsg = {
                        payload: alarmArray,
                        activeCount: node.activeAlarms.size,
                        timestamp: new Date().toISOString()
                    };
                    send(statusMsg);
                    utils.setStatusOK(node, `status: ${node.activeAlarms.size} alarms`);
                    if (done) done();
                    return;
                } else if (msg.context === "clearAll") {
                    // Clear all active alarms from tracking (for reset scenarios)
                    if (msg.payload === true) {
                        node.activeAlarms.clear();
                        utils.setStatusOK(node, "listening (cleared)");
                        if (done) done();
                        return;
                    }
                }
            }

            // Pass-through: relay incoming message downstream
            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            // Remove alarm listener
            if (node.alarmListener) {
                RED.events.off("bldgblocks:alarms:state-change", node.alarmListener);
                node.alarmListener = null;
            }

            // Clear active alarms map
            node.activeAlarms.clear();

            done();
        });
    }

    RED.nodes.registerType("alarm-service", AlarmServiceNode);
};
