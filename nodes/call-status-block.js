module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Simplified runtime state
        node.runtime = {
            call: false,
            status: false,
            alarm: false,
            alarmMessage: "",
            statusTimer: null,
            neverReceivedStatus: true // Track if we've ever gotten status during this call
        };

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

                if (msg.context === node.runtime.status) {
                    if (done) done();
                    return;
                }
                
                node.runtime.status = msg.payload;
                node.runtime.neverReceivedStatus = false;
                
                // Clear any pending status timeout
                if (node.runtime.statusTimer) {
                    clearTimeout(node.runtime.statusTimer);
                    node.runtime.statusTimer = null;
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
            if (msg.payload !== node.runtime.call) {
                node.runtime.call = msg.payload;

                // Clear existing timer
                if (node.runtime.statusTimer) {
                    clearTimeout(node.runtime.statusTimer);
                    node.runtime.statusTimer = null;
                }

                if (node.runtime.call) {
                    // Call activated - reset tracking, set timeout if needed
                    node.runtime.neverReceivedStatus = true;
                    node.runtime.alarm = false;
                    node.runtime.alarmMessage = "";
                    
                    if (node.config.noStatusOnRun) {
                        // Set timer for "never got status" condition
                        node.runtime.statusTimer = setTimeout(() => {
                            if (node.runtime.neverReceivedStatus) {
                                node.runtime.alarm = true;
                                node.runtime.alarmMessage = node.config.noStatusOnRunMessage;
                            }
                            send(sendOutputs());
                            updateStatus();
                            node.runtime.statusTimer = null;
                        }, node.config.statusTimeout * 1000);
                    }
                } else {
                    node.runtime.status = false;
                    node.runtime.alarm = false;
                    node.runtime.alarmMessage = "";
                }
                
                // Check alarm conditions
                checkAlarmConditions();
                send(sendOutputs());
                updateStatus();
            }

            if (done) done();

            function checkAlarmConditions() {
                if (node.runtime.status && !node.runtime.call) {
                    node.runtime.alarm = true;
                    node.runtime.alarmMessage = "Status active without call";
                    return;
                }
                
                if (node.runtime.call && !node.runtime.status && !node.runtime.neverReceivedStatus && node.config.runLostStatus) {
                    node.runtime.alarm = true;
                    node.runtime.alarmMessage = node.config.runLostStatusMessage;
                    return;
                }
                
                // No alarm conditions met. Don't clear alarm if timer is still running
                if (!node.runtime.statusTimer) { 
                    node.runtime.alarm = false;
                    node.runtime.alarmMessage = "";
                }
            }

            function sendOutputs() {
                return { 
                    payload: node.runtime.call,
                    status: {
                        call: node.runtime.call,
                        status: node.runtime.status,
                        alarm: node.runtime.alarm,
                        alarmMessage: node.runtime.alarmMessage,
                        timeout: !!node.runtime.statusTimer,
                        neverReceivedStatus: node.runtime.neverReceivedStatus
                    }
                };
            }

            function updateStatus() {
                const text = `call: ${node.runtime.call}, status: ${node.runtime.status}, alarm: ${node.runtime.alarm}`;
                if (node.runtime.alarm) {
                    utils.setStatusError(node, text);
                } else {
                    utils.setStatusChanged(node, text);
                }
            }
        });

        node.on("close", function(done) {
            if (node.runtime.statusTimer) {
                clearTimeout(node.runtime.statusTimer);
            }
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);
};
