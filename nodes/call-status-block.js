module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Simplified runtime state
        // Initialize state
        node.call = false;
        node.status = false;
        node.alarm = false;
        node.alarmMessage = "";
        node.statusTimer = null;
        node.neverReceivedStatus = true // Track if we've ever gotten status during this call;

        // Configuration with validation
        node.config = {
            statusTimeout: Math.max(parseFloat(config.statusTimeout) || 30, 0.01),
            runLostStatus: config.runLostStatus === true,
            noStatusOnRun: config.noStatusOnRun === true,
            runLostStatusMessage: config.runLostStatusMessage,
            noStatusOnRunMessage: config.noStatusOnRunMessage
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Handle status input
            if (msg.hasOwnProperty("context") && msg.context === "status") {
                if (typeof msg.payload !== "boolean") {
                    utils.setStatusError(node, "invalid status");
                    if (done) done();
                    return;
                }

                if (msg.context === node.status) {
                    if (done) done();
                    return;
                }
                
                node.status = msg.payload;
                node.neverReceivedStatus = false;
                
                // Clear any pending status timeout
                if (node.statusTimer) {
                    clearTimeout(node.statusTimer);
                    node.statusTimer = null;
                }
                
                // Check alarm conditions
                checkAlarmConditions();
                send(sendOutputs());
                updateStatus();
                
                if (done) done();
                return;
            }

            // Handle call input (must be boolean)
            if (typeof msg.payload !== "boolean") {
                utils.setStatusError(node, "invalid call payload");
                if (done) done();
                return;
            }

            // Process call state change
            if (msg.payload !== node.call) {
                node.call = msg.payload;

                // Clear existing timer
                if (node.statusTimer) {
                    clearTimeout(node.statusTimer);
                    node.statusTimer = null;
                }

                if (node.call) {
                    // Call activated - reset tracking, set timeout if needed
                    node.neverReceivedStatus = true;
                    node.alarm = false;
                    node.alarmMessage = "";
                    
                    if (node.config.noStatusOnRun) {
                        // Set timer for "never got status" condition
                        node.statusTimer = setTimeout(() => {
                            if (node.neverReceivedStatus) {
                                node.alarm = true;
                                node.alarmMessage = node.config.noStatusOnRunMessage;
                            }
                            send(sendOutputs());
                            updateStatus();
                            node.statusTimer = null;
                        }, node.config.statusTimeout * 1000);
                    }
                } else {
                    node.status = false;
                    node.alarm = false;
                    node.alarmMessage = "";
                }
                
                // Check alarm conditions
                checkAlarmConditions();
                send(sendOutputs());
                updateStatus();
            }

            if (done) done();

            function checkAlarmConditions() {
                if (node.status && !node.call) {
                    node.alarm = true;
                    node.alarmMessage = "Status active without call";
                    return;
                }
                
                if (node.call && !node.status && !node.neverReceivedStatus && node.config.runLostStatus) {
                    node.alarm = true;
                    node.alarmMessage = node.config.runLostStatusMessage;
                    return;
                }
                
                // No alarm conditions met. Don't clear alarm if timer is still running
                if (!node.statusTimer) { 
                    node.alarm = false;
                    node.alarmMessage = "";
                }
            }

            function sendOutputs() {
                return { 
                    payload: node.call,
                    status: {
                        call: node.call,
                        status: node.status,
                        alarm: node.alarm,
                        alarmMessage: node.alarmMessage,
                        timeout: !!node.statusTimer,
                        neverReceivedStatus: node.neverReceivedStatus
                    }
                };
            }

            function updateStatus() {
                const text = `call: ${node.call}, status: ${node.status}, alarm: ${node.alarm}`;
                if (node.alarm) {
                    utils.setStatusError(node, text);
                } else {
                    utils.setStatusChanged(node, text);
                }
            }
        });

        node.on("close", function(done) {
            if (node.statusTimer) {
                clearTimeout(node.statusTimer);
            }
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);
};
