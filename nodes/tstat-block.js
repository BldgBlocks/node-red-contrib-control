module.exports = function(RED) {
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "tstat";
        node.setpoint = parseFloat(config.setpoint) || 70;
        node.diff = parseFloat(config.diff) || 2;
        node.isHeating = config.isHeating === true;
        if (isNaN(node.setpoint)) {
            node.setpoint = 70;
            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
        }
        if (isNaN(node.diff) || node.diff < 0) {
            node.diff = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid diff" });
        }

        // Initialize state
        let above = false;
        let below = false;
        let lastInput = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "setpoint":
                        const spValue = parseFloat(msg.payload);
                        if (!isNaN(spValue)) {
                            node.setpoint = spValue;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `setpoint: ${spValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                        }
                        break;
                    case "diff":
                        const diffValue = parseFloat(msg.payload);
                        if (!isNaN(diffValue) && diffValue >= 0) {
                            node.diff = diffValue;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `diff: ${diffValue.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid diff" });
                        }
                        break;
                    case "isHeating":
                        if (typeof msg.payload === "boolean") {
                            node.isHeating = msg.payload;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `isHeating: ${msg.payload}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid isHeating" });
                        }
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        break;
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Validate setpoint and diff
            if (isNaN(node.setpoint)) {
                node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                if (done) done();
                return;
            }
            if (isNaN(node.diff) || node.diff < 0) {
                node.status({ fill: "red", shape: "ring", text: "invalid diff" });
                if (done) done();
                return;
            }

            // Thermostat logic
            const delta = node.diff / 2;
            const hiValue = node.setpoint + delta;
            const loValue = node.setpoint - delta;

            const prevAbove = above;
            const prevBelow = below;

            if (input > hiValue) {
                above = true;
                below = false;
            } else if (input < loValue) {
                above = false;
                below = true;
            } else if (above && input < node.setpoint) {
                above = false;
            } else if (below && input > node.setpoint) {
                below = false;
            }

            // Check if input or outputs have changed
            const outputs = [
                { payload: node.isHeating },
                { payload: above },
                { payload: below }
            ];

            if (lastInput !== input || prevAbove !== above || prevBelow !== below) {
                lastInput = input;
                send(outputs);

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: [${node.isHeating ? "heating" : "cooling"}, ${above}, ${below}], in: ${input.toFixed(2)}, sp: ${node.setpoint.toFixed(1)}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `out: [${node.isHeating ? "heating" : "cooling"}, ${above}, ${below}], in: ${input.toFixed(2)}, sp: ${node.setpoint.toFixed(1)}`
                });
            }

            if (done) done();
            return;
        });

        node.on("close", function(done) {
            // Reset properties to config values on redeployment
            node.setpoint = parseFloat(config.setpoint) || 70;
            node.diff = parseFloat(config.diff) || 2;
            node.isHeating = config.isHeating === true;
            if (isNaN(node.setpoint)) {
                node.setpoint = 70;
            }
            if (isNaN(node.diff) || node.diff < 0) {
                node.diff = 2;
            }
            // Clear status to prevent stale status after restart
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/tstat-block/:id", RED.auth.needsPermission("tstat-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "tstat-block") {
            res.json({
                name: node.name || "tstat",
                setpoint: !isNaN(node.setpoint) ? node.setpoint : 70,
                diff: !isNaN(node.diff) && node.diff >= 0 ? node.diff : 2,
                isHeating: node.isHeating === true
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};