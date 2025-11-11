module.exports = function(RED) {
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
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
        }

        let intervalId = null;

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
                if (typeof msg.context !== "string") {
                    node.status({ fill: "red", shape: "ring", text: "invalid context" });
                    if (done) done();
                    return;
                }
                switch (msg.context) {
                    case "period":
                        const value = parseFloat(msg.payload);
                        if (isNaN(value) || value <= 0 || !isFinite(value)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid period" });
                            if (done) done();
                            return;
                        }
                        node.runtime.period = value;
                        node.status({ fill: "green", shape: "dot", text: `period: ${node.runtime.period.toFixed(2)}` });
                        if (intervalId) {
                            clearInterval(intervalId);
                            node.runtime.state = true;
                            const halfPeriodMs = (node.runtime.period * 1000) / 2;
                            send({ payload: node.runtime.state });
                            node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.state}` });
                            intervalId = setInterval(() => {
                                node.runtime.state = !node.runtime.state;
                                send({ payload: node.runtime.state });
                                node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.state}` });
                            }, halfPeriodMs);
                        }
                        break;
                    case "command":
                        if (typeof msg.payload !== "string" || !["start", "stop"].includes(msg.payload)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid command" });
                            if (done) done();
                            return;
                        }
                        if (msg.payload === "start" && !intervalId) {
                            node.runtime.state = true;
                            const halfPeriodMs = (node.runtime.period * 1000) / 2;
                            send({ payload: node.runtime.state });
                            node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.state}` });
                            intervalId = setInterval(() => {
                                node.runtime.state = !node.runtime.state;
                                send({ payload: node.runtime.state });
                                node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.state}` });
                            }, halfPeriodMs);
                            node.status({ fill: "green", shape: "dot", text: `started, period: ${node.runtime.period.toFixed(2)}` });
                        } else if (msg.payload === "stop" && intervalId) {
                            clearInterval(intervalId);
                            intervalId = null;
                            node.status({ fill: "yellow", shape: "dot", text: "stopped" });
                        }
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
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