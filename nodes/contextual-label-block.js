module.exports = function(RED) {
    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "contextual label";
        node.contextProperty = config.contextProperty || "context";

        // Validate initial config
        if (!node.contextProperty || typeof node.contextProperty !== "string" || node.contextProperty.trim() === "") {
            node.status({ fill: "red", shape: "ring", text: "invalid context property" });
            node.contextProperty = "context";
        }

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                if (done) done();
                return;
            }

            // Set msg.context and pass original message
            msg.context = node.contextProperty;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `context: ${node.contextProperty}, value: ${typeof msg.payload === "number" ? msg.payload.toFixed(2) : msg.payload}`
            });
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
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
                name: node.name || "contextual label",
                contextProperty: node.contextProperty || "context"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};