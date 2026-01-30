module.exports = function(RED) {
    const utils = require('./utils')(RED);

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
        
        // Update status based on configuration
        const updateStatus = function() {
            switch (node.statusDisplay) {
                case "default":
                    utils.setStatusOK(node, node.comment || "No comment set");
                    break;
                case "name":
                    utils.setStatusOK(node, node.name || "comment");
                    break;
                case "none":
                default:
                    // No status for "none"
                    break;
            }
        };

        updateStatus();

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
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