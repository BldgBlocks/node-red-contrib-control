module.exports = function(RED) {
    function CommentBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize properties
        node.name = config.name || "comment";
        node.comment = config.comment || "";
        node.statusDisplay = config.statusDisplay || "default";

        // Ensure comment is within 100 characters
        if (node.comment.length > 100) {
            node.comment = node.comment.substring(0, 100);
        }

        // Set initial status
        let status = {};
        if (node.statusDisplay === "default") {
            status = { fill: "green", shape: "dot", text: node.comment || "No comment set" };
        } else if (node.statusDisplay === "name") {
            status = { fill: "green", shape: "dot", text: node.name || "comment" };
        } // "none" leaves status empty
        node.status(status);

        // Track last status for unchanged state
        let lastStatusText = status.text || "";

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Update status
            let status = {};
            if (node.statusDisplay === "default") {
                status = { fill: "blue", shape: lastStatusText === (node.comment || "No comment set") ? "ring" : "dot", text: node.comment || "No comment set" };
            } else if (node.statusDisplay === "name") {
                status = { fill: "blue", shape: lastStatusText === (node.name || "comment") ? "ring" : "dot", text: node.name || "comment" };
            } // "none" leaves status empty
            lastStatusText = status.text || "";
            node.status(status);

            // Pass message unchanged
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("comment-block", CommentBlockNode);
};