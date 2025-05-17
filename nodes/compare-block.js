module.exports = function(RED) {
    function CompareBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            setpoint: parseFloat(config.setpoint) || 50
        };

        // Validate initial config
        if (isNaN(node.runtime.setpoint) || !isFinite(node.runtime.setpoint)) {
            node.runtime.setpoint = 50;
            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
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
                    node.status({ fill: "red", shape: "ring", text: "missing payload for setpoint" });
                    if (done) done();
                    return;
                }

                if (msg.context === "setpoint") {
                    const setpointValue = parseFloat(msg.payload);
                    if (!isNaN(setpointValue) && isFinite(setpointValue)) {
                        node.runtime.setpoint = setpointValue;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `setpoint: ${setpointValue.toFixed(2)}`
                        });
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Validate input
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Compare input to setpoint
            const greater = inputValue > node.runtime.setpoint;
            const equal = inputValue === node.runtime.setpoint;
            const less = inputValue < node.runtime.setpoint;
            const outputs = [
                { payload: greater },
                { payload: equal },
                { payload: less }
            ];

            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inputValue.toFixed(2)}, sp: ${node.runtime.setpoint.toFixed(2)}, out: [${greater}, ${equal}, ${less}]`
            });
            send(outputs);

            if (done) done();
        });

        node.on("close", function(done) {
            node.runtime.setpoint = parseFloat(config.setpoint) || 50;
            if (isNaN(node.runtime.setpoint) || !isFinite(node.runtime.setpoint)) {
                node.runtime.setpoint = 50;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("compare-block", CompareBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/compare-block-runtime/:id", RED.auth.needsPermission("compare-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "compare-block") {
            res.json({
                name: node.runtime.name,
                setpoint: node.runtime.setpoint
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};