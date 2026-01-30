module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function TickTockBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            period: parseFloat(config.period),
            state: true
        };

        // Validate initial config
        if (isNaN(node.runtime.period) || node.runtime.period <= 0 || !isFinite(node.runtime.period)) {
            node.runtime.period = 10;
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
                        node.runtime.period = value;
                        utils.setStatusOK(node, `period: ${node.runtime.period.toFixed(2)}`);
                        if (intervalId) {
                            clearInterval(intervalId);
                            node.runtime.state = true;
                            const halfPeriodMs = (node.runtime.period * 1000) / 2;
                            send({ payload: node.runtime.state });
                            utils.setStatusChanged(node, `out: ${node.runtime.state}`);
                            intervalId = setInterval(() => {
                                node.runtime.state = !node.runtime.state;
                                send({ payload: node.runtime.state });
                                utils.setStatusChanged(node, `out: ${node.runtime.state}`);
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
                            node.runtime.state = true;
                            const halfPeriodMs = (node.runtime.period * 1000) / 2;
                            send({ payload: node.runtime.state });
                            utils.setStatusChanged(node, `out: ${node.runtime.state}`);
                            intervalId = setInterval(() => {
                                node.runtime.state = !node.runtime.state;
                                send({ payload: node.runtime.state });
                                utils.setStatusChanged(node, `out: ${node.runtime.state}`);
                            }, halfPeriodMs);
                            utils.setStatusOK(node, `started, period: ${node.runtime.period.toFixed(2)}`);
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