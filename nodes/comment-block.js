module.exports = function (RED) {
    function CommentBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize comment
        node.comment = context.get("comment") || config.comment || "";
        // Ensure comment is within 60 characters
        if (node.comment.length > 60) {
            node.comment = node.comment.substring(0, 60);
        }
        context.set("comment", node.comment);

        // Set initial status
        node.status({ fill: "blue", shape: "dot", text: node.comment || "No comment set" });

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            // Update status with comment
            node.status({ fill: "blue", shape: "dot", text: node.comment || "No comment set" });

            // Pass message unchanged
            send(msg);

            if (done) done();
        });

        node.on("close", function (done) {
            done();
        });
    }

    RED.nodes.registerType("comment-block", CommentBlockNode);

    // Serve comment for editor
    RED.httpAdmin.get("/comment-block/:id", RED.auth.needsPermission("comment-block.read"), function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "comment-block") {
            const context = node.context();
            const comment = context.get("comment") || "";
            res.json({ comment });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};