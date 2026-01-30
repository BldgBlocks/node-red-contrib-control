module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function TickTockBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.period = parseFloat(config.period);
        node.state = true;

        // Validate initial config
        if (isNaN(node.period) || node.period <= 0 || !isFinite(node.period)) {
            node.period = 10;
            utils.setStatusError(node, "invalid period");
        }

        let intervalId = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) done();
                    return;
                }
                if (typeof msg.context !== "string") {
                    utils.setStatusError(node, "invalid context");
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "period":
                        const value = parseFloat(msg.payload);
                        if (isNaN(value) || value <= 0 || !isFinite(value)) {
                            utils.setStatusError(node, "invalid period");
                            if (done) done();
                            return;
                        }
                        node.period = value;
                        utils.setStatusOK(node, `period: ${node.period.toFixed(2)}`);
                        if (intervalId) {
                            clearInterval(intervalId);
                            node.state = true;
                            const halfPeriodMs = (node.period * 1000) / 2;
                            send({ payload: node.state });
                            utils.setStatusChanged(node, `out: ${node.state}`);
                            intervalId = setInterval(() => {
                                node.state = !node.state;
                                send({ payload: node.state });
                                utils.setStatusChanged(node, `out: ${node.state}`);
                            }, halfPeriodMs);
                        }
                        break;
                    case "command":
                        if (typeof msg.payload !== "string" || !["start", "stop"].includes(msg.payload)) {
                            utils.setStatusError(node, "invalid command");
                            if (done) done();
                            return;
                        }
                        if (msg.payload === "start" && !intervalId) {
                            node.state = true;
                            const halfPeriodMs = (node.period * 1000) / 2;
                            send({ payload: node.state });
                            utils.setStatusChanged(node, `out: ${node.state}`);
                            intervalId = setInterval(() => {
                                node.state = !node.state;
                                send({ payload: node.state });
                                utils.setStatusChanged(node, `out: ${node.state}`);
                            }, halfPeriodMs);
                            utils.setStatusOK(node, `started, period: ${node.period.toFixed(2)}`);
                        } else if (msg.payload === "stop" && intervalId) {
                            clearInterval(intervalId);
                            intervalId = null;
                            utils.setStatusWarn(node, "stopped");
                        }
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        if (done) done("Unknown context");
                        return;
                }
                if (done) done();
                return;
            }
            if (done) done();
        });

        node.on("close", function(done) {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            done();
        });
    }

    RED.nodes.registerType("tick-tock-block", TickTockBlockNode);
};