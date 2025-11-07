module.exports = function(RED) {
    function CommentBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize properties
        node.name = config.name;
        node.comment = config.comment;
        node.statusDisplay = config.statusDisplay;

        // Ensure comment is within 100 characters
        if (node.comment.length > 100) {
            node.comment = node.comment.substring(0, 100);
        }
        
        // Status helper function
        const updateStatus = function() {
            switch (node.statusDisplay) {
                case "default":
                    return { fill: "green", shape: "dot", text: node.comment || "No comment set" };
                case "name":
                    return { fill: "green", shape: "dot", text: node.name || "comment" };
                case "none":
                default:
                    return {};
            }
        };

        node.status(updateStatus());

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            node.status(updateStatus());

            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("comment-block", CommentBlockNode);
};