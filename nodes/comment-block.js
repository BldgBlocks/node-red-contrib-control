module.exports = function (RED) {
    function CommentBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize properties
        node.name = config.name || "comment";
        node.comment = context.get("comment") || config.comment || "";
        node.statusDisplay = context.get("statusDisplay") || config.statusDisplay || "default";

        // Ensure comment is within 100 characters
        if (node.comment.length > 100) {
            node.comment = node.comment.substring(0, 100);
        }
        context.set("comment", node.comment);
        context.set("statusDisplay", node.statusDisplay);

        // Set initial status
        let status = {};
        if (node.statusDisplay === "default") {
            status = { fill: "blue", shape: "dot", text: node.comment || "No comment set" };
        } else if (node.statusDisplay === "name") {
            status = { fill: "blue", shape: "dot", text: node.name || "comment" };
        } // "none" leaves status empty
        node.status(status);

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            // Update status
            let status = {};
            if (node.statusDisplay === "default") {
                status = { fill: "blue", shape: "dot", text: node.comment || "No comment set" };
            } else if (node.statusDisplay === "name") {
                status = { fill: "blue", shape: "dot", text: node.name || "comment" };
            } // "none" leaves status empty
            node.status(status);

            // Pass message unchanged
            send(msg);

            if (done) done();
        });

        node.on("close", function (done) {
            done();
        });
    }

    RED.nodes.registerType("comment-block", CommentBlockNode);

    // Serve comment and statusDisplay for editor
    RED.httpAdmin.get("/comment-block/:id", RED.auth.needsPermission("comment-block.read"), function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "comment-block") {
            const context = node.context();
            const comment = context.get("comment") || "";
            const statusDisplay = context.get("statusDisplay") || "default";
            res.json({ comment, statusDisplay });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};