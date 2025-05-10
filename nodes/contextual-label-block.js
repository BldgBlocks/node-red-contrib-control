module.exports = function(RED) {
    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.contextPropertyName = config.contextPropertyName || "context";

        // Validate initial config
        if (!node.contextPropertyName || typeof node.contextPropertyName !== "string" || node.contextPropertyName.trim() === "") {
            node.contextPropertyName = "context";
            node.status({ fill: "red", shape: "ring", text: "invalid context property" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                if (done) done();
                return;
            }

            msg.context = node.contextPropertyName;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `context: ${node.contextPropertyName}, value: ${JSON.stringify(msg.payload)}`
            });
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset properties on redeployment
            node.contextPropertyName = config.contextPropertyName || "context";

            if (!node.contextPropertyName || typeof node.contextPropertyName !== "string" || node.contextPropertyName.trim() === "") {
                node.contextPropertyName = "context";
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("contextual-label-block", ContextualLabelBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/contextual-label-block/:id", RED.auth.needsPermission("contextual-label-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "contextual-label-block") {
            res.json({
                contextPropertyName: node.contextPropertyName || "context"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};