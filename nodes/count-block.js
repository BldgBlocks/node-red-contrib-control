module.exports = function(RED) {
    function CountBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            count: 0,
            prevState: false
        };

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
                    node.status({ fill: "red", shape: "ring", text: "missing payload for reset" });
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        const prevCount = node.runtime.count;
                        node.runtime.count = 0;
                        node.runtime.prevState = false;
                        node.status({ fill: "green", shape: "dot", text: "state reset" });
                        if (prevCount !== 0) {
                            send({ payload: node.runtime.count });
                        }
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

            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Increment on false → true transition
            if (!node.runtime.prevState && inputValue === true) {
                node.runtime.count++;
                node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.count}` });
                send({ payload: node.runtime.count });
            } else {
                node.status({ fill: "blue", shape: "ring", text: `out: ${node.runtime.count}` });
            }

            // Update prevState
            node.runtime.prevState = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            node.runtime.count = 0;
            node.runtime.prevState = false;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("count-block", CountBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/count-block-runtime/:id", RED.auth.needsPermission("count-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "count-block") {
            res.json({
                name: node.runtime.name,
                count: node.runtime.count
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};