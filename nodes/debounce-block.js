module.exports = function(RED) {
    function DebounceBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.period = parseFloat(config.period) || 1000; // Default 1000ms

        // Validate initial config
        if (isNaN(node.period) || node.period <= 0) {
            node.period = 1000;
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
        }

        // Initialize state
        let debounceTimer = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    delete msg.context; // Remove context after processing
                    if (done) done();
                    return;
                }
                
                if (msg.context === "period") {
                    const newPeriod = parseFloat(msg.payload);
                    if (isNaN(newPeriod) || newPeriod <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid period" });
                        delete msg.context; // Remove context after processing
                        if (done) done();
                        return;
                    }
                    node.period = newPeriod;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `period: ${newPeriod.toFixed(0)} ms`
                    });
                    delete msg.context; // Remove context after processing
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    delete msg.context; // Remove context after processing
                    if (done) done();
                    return;
                }
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            // Only process true payloads
            if (msg.payload !== true) {
                if (done) done();
                return;
            }

            // Clear existing timer if any
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            // Set new debounce timer
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                delete msg.context; // Remove context before sending output
                msg.payload = true;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: true`
                });
                send(msg);
            }, node.period);

            if (done) done();
        });

        node.on("close", function(done) {
            // Clear timer on redeployment
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }

            // Reset properties to config values
            node.period = parseFloat(config.period) || 1000;
            if (isNaN(node.period) || node.period <= 0) {
                node.period = 1000;
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("debounce-block", DebounceBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/debounce-block/:id", RED.auth.needsPermission("debounce-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "debounce-block") {
            res.json({
                period: !isNaN(node.period) && node.period > 0 ? node.period : 1000
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};