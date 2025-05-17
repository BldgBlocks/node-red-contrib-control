module.exports = function(RED) {
    function CallStatusBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            statusTimeout: parseFloat(config.statusTimeout) || 30,
            clearDelay: parseFloat(config.clearDelay) || 10,
            normalOff: config.normalOff === true,
            normalOn: config.normalOn !== false,
            runLostStatus: config.runLostStatus === true,
            noStatusOnRun: config.noStatusOnRun !== false,
            runLostStatusMessage: config.runLostStatusMessage || "Status lost during run",
            noStatusOnRunMessage: config.noStatusOnRunMessage || "No status received during run",
            call: false,
            status: false,
            alarm: false,
            alarmMessage: "",
            statusTimer: null,
            clearTimer: null
        };

        // Validate initial config
        if (isNaN(node.runtime.statusTimeout) || node.runtime.statusTimeout <= 0) {
            node.runtime.statusTimeout = 30;
            node.status({ fill: "red", shape: "ring", text: "invalid statusTimeout" });
        }
        if (isNaN(node.runtime.clearDelay) || node.runtime.clearDelay <= 0) {
            node.runtime.clearDelay = 10;
            node.status({ fill: "red", shape: "ring", text: "invalid clearDelay" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
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
                        node.runtime[msg.context] = value;
                        if (node.runtime.statusTimer) {
                            clearTimeout(node.runtime.statusTimer);
                            node.runtime.statusTimer = null;
                            if (node.runtime.noStatusOnRun && node.runtime.call) {
                                node.runtime.statusTimer = setTimeout(() => {
                                    if (!node.runtime.status) {
                                        node.runtime.alarm = true;
                                        node.runtime.alarmMessage = node.runtime.noStatusOnRunMessage;
                                        node.status({ fill: "red", shape: "dot", text: `no status on run, alarm: true` });
                                        send(sendOutputs());
                                    }
                                    node.runtime.statusTimer = null;
                                }, node.runtime.statusTimeout * 1000);
                            }
                        }
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context}: ${value.toFixed(2)}`
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
                        node.runtime[msg.context] = msg.payload;
                        if (msg.context === "noStatusOnRun" && !msg.payload && node.runtime.statusTimer) {
                            clearTimeout(node.runtime.statusTimer);
                            node.runtime.statusTimer = null;
                        } else if (msg.context === "noStatusOnRun" && msg.payload && node.runtime.call && !node.runtime.status) {
                            node.runtime.statusTimer = setTimeout(() => {
                                if (!node.runtime.status) {
                                    node.runtime.alarm = true;
                                    node.runtime.alarmMessage = node.runtime.noStatusOnRunMessage;
                                    node.status({ fill: "red", shape: "dot", text: `no status on run, alarm: true` });
                                    send(sendOutputs());
                                }
                                node.runtime.statusTimer = null;
                            }, node.runtime.statusTimeout * 1000);
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
                        node.runtime[msg.context] = msg.payload;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `${msg.context} set`
                        });
                        if (node.runtime.alarm && node.runtime.alarmMessage === (msg.context === "runLostStatusMessage" ? node.runtime.noStatusOnRunMessage : node.runtime.runLostStatusMessage)) {
                            node.runtime.alarmMessage = msg.payload;
                            send(sendOutputs());
                        }
                        if (done) done();
                        return;
                    case "status":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid status" });
                            if (done) done();
                            return;
                        }
                        if (!node.runtime.call) {
                            node.status({ fill: "red", shape: "ring", text: "status ignored" });
                            if (done) done();
                            return;
                        }
                        node.runtime.status = msg.payload;
                        if (node.runtime.status && node.runtime.statusTimer) {
                            clearTimeout(node.runtime.statusTimer);
                            node.runtime.statusTimer = null;
                            node.runtime.alarm = false;
                            node.runtime.alarmMessage = "";
                        }
                        send(checkStatusConditions());
                        if (done) done();
                        return;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done("Unknown context");
                        return;
                }
            }

            // Validate call input
            if (typeof msg.payload !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid call" });
                if (done) done();
                return;
            }

            // Process call change
            if (msg.payload !== node.runtime.call) {
                node.runtime.call = msg.payload;

                // Clear existing timers
                if (node.runtime.statusTimer) {
                    clearTimeout(node.runtime.statusTimer);
                    node.runtime.statusTimer = null;
                }
                if (node.runtime.clearTimer) {
                    clearTimeout(node.runtime.clearTimer);
                    node.runtime.clearTimer = null;
                }

                if (node.runtime.call) {
                    // Start call: reset status and alarm, set timeout
                    node.runtime.status = false;
                    node.runtime.alarm = false;
                    node.runtime.alarmMessage = "";
                    if (node.runtime.noStatusOnRun) {
                        node.runtime.statusTimer = setTimeout(() => {
                            if (!node.runtime.status) {
                                node.runtime.alarm = true;
                                node.runtime.alarmMessage = node.runtime.noStatusOnRunMessage;
                                node.status({ fill: "red", shape: "dot", text: `no status on run, alarm: true` });
                                send(sendOutputs());
                            }
                            node.runtime.statusTimer = null;
                        }, node.runtime.statusTimeout * 1000);
                    }
                } else {
                    // Stop call: schedule status and alarm clear
                    node.runtime.clearTimer = setTimeout(() => {
                        node.runtime.status = false;
                        node.runtime.alarm = false;
                        node.runtime.alarmMessage = "";
                        send(sendOutputs());
                        updateStatus();
                        node.runtime.clearTimer = null;
                    }, node.runtime.clearDelay * 1000);
                }
                send(checkStatusConditions());
            } else {
                updateStatus();
            }

            if (done) done();

            function checkStatusConditions() {
                if (node.runtime.call && node.runtime.runLostStatus) {
                    if (node.runtime.status !== node.runtime.normalOn) {
                        node.runtime.alarm = true;
                        node.runtime.alarmMessage = node.runtime.runLostStatusMessage;
                        node.status({ fill: "red", shape: "dot", text: `run lost, alarm: true` });
                        return sendOutputs();
                    }
                }
                if (!node.runtime.call && node.runtime.status !== node.runtime.normalOff) {
                    node.runtime.alarm = true;
                    node.runtime.alarmMessage = "Status mismatch when off";
                    node.status({ fill: "red", shape: "dot", text: `off mismatch, alarm: true` });
                    return sendOutputs();
                }
                if (!node.runtime.alarm || (node.runtime.status === node.runtime.normalOn && node.runtime.call) || (node.runtime.status === node.runtime.normalOff && !node.runtime.call)) {
                    node.runtime.alarm = false;
                    node.runtime.alarmMessage = "";
                }
                updateStatus();
                return sendOutputs();
            }

            function sendOutputs() {
                return [
                    { payload: node.runtime.call },
                    {
                        payload: {
                            call: node.runtime.call,
                            status: node.runtime.status,
                            alarm: node.runtime.alarm,
                            alarmMessage: node.runtime.alarmMessage,
                            timeout: !!node.runtime.statusTimer
                        }
                    }
                ];
            }

            function updateStatus() {
                node.status({
                    fill: node.runtime.alarm ? "red" : "blue",
                    shape: "dot",
                    text: `call: ${node.runtime.call}, status: ${node.runtime.status}, alarm: ${node.runtime.alarm}`
                });
            }
        });

        node.on("close", function(done) {
            if (node.runtime.statusTimer) clearTimeout(node.runtime.statusTimer);
            if (node.runtime.clearTimer) clearTimeout(node.runtime.clearTimer);

            node.runtime = {
                name: config.name || "",
                statusTimeout: parseFloat(config.statusTimeout) || 30,
                clearDelay: parseFloat(config.clearDelay) || 10,
                normalOff: config.normalOff === true,
                normalOn: config.normalOn !== false,
                runLostStatus: config.runLostStatus === true,
                noStatusOnRun: config.noStatusOnRun !== false,
                runLostStatusMessage: config.runLostStatusMessage || "Status lost during run",
                noStatusOnRunMessage: config.noStatusOnRunMessage || "No status received during run",
                call: false,
                status: false,
                alarm: false,
                alarmMessage: "",
                statusTimer: null,
                clearTimer: null
            };

            if (isNaN(node.runtime.statusTimeout) || node.runtime.statusTimeout <= 0) {
                node.runtime.statusTimeout = 30;
            }
            if (isNaN(node.runtime.clearDelay) || node.runtime.clearDelay <= 0) {
                node.runtime.clearDelay = 10;
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("call-status-block", CallStatusBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/call-status-block-runtime/:id", RED.auth.needsPermission("call-status-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "call-status-block") {
            res.json({
                name: node.runtime.name,
                statusTimeout: node.runtime.statusTimeout,
                clearDelay: node.runtime.clearDelay,
                normalOff: node.runtime.normalOff,
                normalOn: node.runtime.normalOn,
                runLostStatus: node.runtime.runLostStatus,
                noStatusOnRun: node.runtime.noStatusOnRun,
                runLostStatusMessage: node.runtime.runLostStatusMessage,
                noStatusOnRunMessage: node.runtime.noStatusOnRunMessage,
                call: node.runtime.call,
                status: node.runtime.status,
                alarm: node.runtime.alarm,
                alarmMessage: node.runtime.alarmMessage
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};