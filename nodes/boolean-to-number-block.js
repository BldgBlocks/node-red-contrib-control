module.exports = function(RED) {
    function BooleanToNumberBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime for editor display
        node.runtime = {
            name: config.name || ""
        };
        node.nullToZero = config.nullToZero === true;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Ignore unmatched msg.context
            if (msg.hasOwnProperty("context") && !["toggle", "switch", "inTrue", "inFalse"].includes(msg.context)) {
                // Silently process payload if valid, no status change
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Validate and convert payload
            const inputDisplay = msg.payload === null ? "null" : msg.payload;
            if (msg.payload === null) {
                msg.payload = node.nullToZero ? 0 : -1;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else if (typeof msg.payload === "boolean") {
                msg.payload = msg.payload ? 1 : 0;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("boolean-to-number-block", BooleanToNumberBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/boolean-to-number-block-runtime/:id", RED.auth.needsPermission("boolean-to-number-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "boolean-to-number-block") {
            res.json({
                name: node.runtime.name
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};