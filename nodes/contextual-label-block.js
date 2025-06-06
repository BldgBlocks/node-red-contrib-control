module.exports = function(RED) {
    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            contextPropertyName: config.contextPropertyName || "context",
            removeLabel: config.removeLabel || false
        };

        // Validate initial config
        if (!node.runtime.contextPropertyName || typeof node.runtime.contextPropertyName !== "string" || node.runtime.contextPropertyName.trim() === "") {
            node.runtime.contextPropertyName = "label";
            node.status({ fill: "red", shape: "ring", text: "invalid context property, using label" });
            node.warn(`Invalid contextPropertyName: ${config.contextPropertyName}, using label`);
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `mode: ${node.runtime.removeLabel ? "remove" : "set"}, contextPropertyName: ${node.runtime.contextPropertyName}`
            });
        }

        // Track last payload for unchanged state
        let lastPayload = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn("Missing message");
                if (done) done();
                return;
            }

            // Prepare output message
            const outputMsg = RED.util.cloneMessage(msg);
            const payloadStr = JSON.stringify(msg.payload);
            const isUnchanged = lastPayload !== null && payloadStr === JSON.stringify(lastPayload);
            lastPayload = msg.payload;

            // Set or remove context property
            if (node.runtime.removeLabel) {
                delete outputMsg.context;
                node.status({
                    fill: "blue",
                    shape: isUnchanged ? "ring" : "dot",
                    text: `in: ${payloadStr}, out: removed context`
                });
            } else {
                outputMsg.context = node.runtime.contextPropertyName;
                node.status({
                    fill: "blue",
                    shape: isUnchanged ? "ring" : "dot",
                    text: `in: ${payloadStr}, out: ${node.runtime.contextPropertyName}`
                });
            }

            send(outputMsg);
            if (done) done();
        });

        node.on("close", function(done) {
            // Reset runtime state on redeployment
            node.runtime = {
                name: config.name || "",
                contextPropertyName: config.contextPropertyName || "label",
                removeLabel: config.removeLabel || false
            };
            if (!node.runtime.contextPropertyName || typeof node.runtime.contextPropertyName !== "string" || node.runtime.contextPropertyName.trim() === "") {
                node.runtime.contextPropertyName = "label";
                node.status({ fill: "red", shape: "ring", text: "invalid context property, using label" });
            } else {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `mode: ${node.runtime.removeLabel ? "remove" : "set"}, contextPropertyName: ${node.runtime.contextPropertyName}`
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
                name: node.runtime.name,
                contextPropertyName: node.runtime.contextPropertyName,
                removeLabel: node.runtime.removeLabel
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};