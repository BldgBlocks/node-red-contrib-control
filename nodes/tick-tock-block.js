module.exports = function(RED) {
    function TickTockBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize from editor config
        node.name = config.name || "tick tock";
        node.period = parseFloat(config.period) || 10;

        // Validate period
        if (isNaN(node.period) || node.period <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
            node.period = 10;
        }

        // State variables
        let intervalId = null;
        let state = true;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (msg.context === "period") {
                    const value = parseFloat(msg.payload);
                    if (isNaN(value) || value <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid period" });
                        if (done) done();
                        return;
                    }
                    node.period = value;
                    node.status({ fill: "green", shape: "dot", text: `period: ${node.period.toFixed(2)}` });

                    if (intervalId) {
                        clearInterval(intervalId);
                        state = true;
                        const halfPeriodMs = (node.period * 1000) / 2;
                        send({ payload: state });
                        node.status({ fill: "blue", shape: "dot", text: `out: ${state}` });
                        intervalId = setInterval(() => {
                            state = !state;
                            send({ payload: state });
                            node.status({ fill: "blue", shape: "dot", text: `out: ${state}` });
                        }, halfPeriodMs);
                    }
                } else if (msg.context === "command") {
                    if (typeof msg.payload !== "string") {
                        node.status({ fill: "red", shape: "ring", text: "invalid command" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === "start" && !intervalId) {
                        state = true;
                        const halfPeriodMs = (node.period * 1000) / 2;
                        send({ payload: state });
                        node.status({ fill: "blue", shape: "dot", text: `out: ${state}` });
                        intervalId = setInterval(() => {
                            state = !state;
                            send({ payload: state });
                            node.status({ fill: "blue", shape: "dot", text: `out: ${state}` });
                        }, halfPeriodMs);
                        node.status({ fill: "green", shape: "dot", text: `started, period: ${node.period.toFixed(2)}` });
                    } else if (msg.payload === "stop" && intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                        node.status({ fill: "red", shape: "dot", text: "stopped" });
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid command" });
                    }
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
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
            state = true;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("tick-tock-block", TickTockBlockNode);

    // HTTP endpoint for editor reflection
    RED.httpAdmin.get("/tick-tock-block/:id", RED.auth.needsPermission("tick-tock-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "tick-tock-block") {
            res.json({
                name: node.name || "tick tock",
                period: node.period || 10
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};