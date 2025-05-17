module.exports = function(RED) {
    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            contextPropertyName: config.contextPropertyName || "context"
        };

        // Validate initial config
        if (!node.runtime.contextPropertyName || typeof node.runtime.contextPropertyName !== "string" || node.runtime.contextPropertyName.trim() === "") {
            node.runtime.contextPropertyName = "context";
            node.status({ fill: "red", shape: "ring", text: "invalid context property, using context" });
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `contextPropertyName: ${node.runtime.contextPropertyName}`
            });
        }

        // Track last payload for unchanged state
        let lastPayload = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Set context and output message
            msg.context = node.runtime.contextPropertyName;
            const payloadStr = JSON.stringify(msg.payload);
            const isUnchanged = lastPayload !== null && payloadStr === JSON.stringify(lastPayload);
            node.status({
                fill: "blue",
                shape: isUnchanged ? "ring" : "dot",
                text: `in: ${payloadStr}, out: ${node.runtime.contextPropertyName}`
            });
            lastPayload = msg.payload;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset runtime state on redeployment
            node.runtime.contextPropertyName = config.contextPropertyName || "context";
            if (!node.runtime.contextPropertyName || typeof node.runtime.contextPropertyName !== "string" || node.runtime.contextPropertyName.trim() === "") {
                node.runtime.contextPropertyName = "context";
                node.status({ fill: "red", shape: "ring", text: "invalid context property, using context" });
            } else {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `contextPropertyName: ${node.runtime.contextPropertyName}`
                });
            }

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("contextual-label-block", ContextualLabelBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/contextual-label-block-runtime/:id", RED.auth.needsPermission("contextual-label-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "contextual-label-block") {
            res.json({
                contextPropertyName: node.runtime.contextPropertyName || "context"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};