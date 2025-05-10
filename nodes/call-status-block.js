module.exports = function(RED) {
    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "call status";
        node.statusTimeout = parseFloat(config.statusTimeout) || 30;
        node.clearDelay = parseFloat(config.clearDelay) || 10;
        node.normalOff = config.normalOff === true;
        node.normalOn = config.normalOn !== false;
        node.runLostStatus = config.runLostStatus === true;
        node.noStatusOnRun = config.noStatusOnRun !== false;
        node.runLostStatusMessage = config.runLostStatusMessage || "Status lost during run";
        node.noStatusOnRunMessage = config.noStatusOnRunMessage || "No status received during run";

        // Validate initial config
        if (isNaN(node.statusTimeout) || node.statusTimeout <= 0) {
            node.statusTimeout = 30;
            node.status({ fill: "red", shape: "ring", text: "invalid statusTimeout" });
        }
        if (isNaN(node.clearDelay) || node.clearDelay <= 0) {
            node.clearDelay = 10;
            node.status({ fill: "red", shape: "ring", text: "invalid clearDelay" });
        }

        // Initialize state
        let call = false;
        let status = false;
        let alarm = false;
        let alarmMessage = "";
        let statusTimer = null;
        let clearTimer = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "statusTimeout":
                    case "clearDelay":
                        const value = parseFloat(msg.payload);
                        if (isNaN(value) || value <= 0) {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        if (msg.context === "statusTimeout") {
                            node.statusTimeout = value;
                        } else {
                            node.clearDelay = value;
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${value}`
                        });
                        if (done) done();
                        return;
                    case "normalOff":
                    case "normalOn":
                    case "runLostStatus":
                    case "noStatusOnRun":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        if (msg.context === "normalOff") {
                            node.normalOff = msg.payload;
                        } else if (msg.context === "normalOn") {
                            node.normalOn = msg.payload;
                        } else if (msg.context === "runLostStatus") {
                            node.runLostStatus = msg.payload;
                        } else {
                            node.noStatusOnRun = msg.payload;
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${msg.payload}`
                        });
                        send(checkStatusConditions());
                        if (done) done();
                        return;
                    case "runLostStatusMessage":
                    case "noStatusOnRunMessage":
                        if (typeof msg.payload !== "string") {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        if (msg.context === "runLostStatusMessage") {
                            node.runLostStatusMessage = msg.payload;
                        } else {
                            node.noStatusOnRunMessage = msg.payload;
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context} set`
                        });
                        if (done) done();
                        return;
                    case "status":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid status" });
                            if (done) done();
                            return;
                        }
                        if (!call) {
                            node.status({ fill: "red", shape: "ring", text: "status ignored" });
                            if (done) done();
                            return;
                        }
                        status = msg.payload;
                        if (status && statusTimer) {
                            clearTimeout(statusTimer);
                            statusTimer = null;
                            alarm = false;
                            alarmMessage = "";
                        }
                        send(checkStatusConditions());
                        if (done) done();
                        return;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                }
            }

            if (typeof msg.payload !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid call" });
                if (done) done();
                return;
            }

            // Process call change
            if (msg.payload !== call) {
                call = msg.payload;

                // Clear existing timers
                if (statusTimer) {
                    clearTimeout(statusTimer);
                    statusTimer = null;
                }
                if (clearTimer) {
                    clearTimeout(clearTimer);
                    clearTimer = null;
                }

                if (call) {
                    // Start call: reset status and alarm, set timeout
                    status = false;
                    alarm = false;
                    alarmMessage = "";
                    if (node.noStatusOnRun) {
                        statusTimer = setTimeout(() => {
                            if (!status) {
                                alarm = true;
                                alarmMessage = node.noStatusOnRunMessage;
                                node.status({ fill: "red", shape: "dot", text: `no status on run, alarm: true` });
                                send(sendOutputs());
                            }
                            statusTimer = null;
                        }, node.statusTimeout * 1000);
                    }
                } else {
                    // Stop call: schedule status and alarm clear
                    clearTimer = setTimeout(() => {
                        status = false;
                        alarm = false;
                        alarmMessage = "";
                        send(sendOutputs());
                        updateStatus();
                        clearTimer = null;
                    }, node.clearDelay * 1000);
                }
                send(checkStatusConditions());
            } else {
                updateStatus();
            }

            if (done) done();

            function checkStatusConditions() {
                if (call && node.runLostStatus) {
                    if (status !== node.normalOn) {
                        alarm = true;
                        alarmMessage = node.runLostStatusMessage;
                        node.status({ fill: "red", shape: "dot", text: `run lost, alarm: true` });
                        return sendOutputs();
                    }
                }
                if (!call && status !== node.normalOff) {
                    alarm = true;
                    alarmMessage = "Status mismatch when off";
                    node.status({ fill: "red", shape: "dot", text: `off mismatch, alarm: true` });
                    return sendOutputs();
                }
                if (!alarm || (status === node.normalOn && call) || (status === node.normalOff && !call)) {
                    alarm = false;
                    alarmMessage = "";
                }
                updateStatus();
                return sendOutputs();
            }

            function sendOutputs() {
                return [
                    { payload: call },
                    {
                        payload: {
                            call,
                            status,
                            alarm,
                            alarmMessage,
                            timeout: !!statusTimer
                        }
                    }
                ];
            }

            function updateStatus() {
                node.status({
                    fill: alarm ? "red" : "blue",
                    shape: "dot",
                    text: `call: ${call}, status: ${status}, alarm: ${alarm}`
                });
            }
        });

        node.on("close", function(done) {
            // Clear timers
            if (statusTimer) clearTimeout(statusTimer);
            if (clearTimer) clearTimeout(clearTimer);

            // Reset properties to config values on redeployment
            node.statusTimeout = parseFloat(config.statusTimeout) || 30;
            node.clearDelay = parseFloat(config.clearDelay) || 10;
            node.normalOff = config.normalOff === true;
            node.normalOn = config.normalOn !== false;
            node.runLostStatus = config.runLostStatus === true;
            node.noStatusOnRun = config.noStatusOnRun !== false;
            node.runLostStatusMessage = config.runLostStatusMessage || "Status lost during run";
            node.noStatusOnRunMessage = config.noStatusOnRunMessage || "No status received during run";

            if (isNaN(node.statusTimeout) || node.statusTimeout <= 0) {
                node.statusTimeout = 30;
            }
            if (isNaN(node.clearDelay) || node.clearDelay <= 0) {
                node.clearDelay = 10;
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/call-status-block/:id", RED.auth.needsPermission("call-status-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "call-status-block") {
            res.json({
                name: node.name || "call status",
                statusTimeout: !isNaN(node.statusTimeout) && node.statusTimeout > 0 ? node.statusTimeout : 30,
                clearDelay: !isNaN(node.clearDelay) && node.clearDelay > 0 ? node.clearDelay : 10,
                normalOff: node.normalOff === true,
                normalOn: node.normalOn === true,
                runLostStatus: node.runLostStatus === true,
                noStatusOnRun: node.noStatusOnRun === true,
                runLostStatusMessage: node.runLostStatusMessage || "Status lost during run",
                noStatusOnRunMessage: node.noStatusOnRunMessage || "No status received during run"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};