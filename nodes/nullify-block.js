module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function NullifyBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize state
        node.rules = config.rules || [];
        node.deleteAll = config.deleteAll === true;

        // Validate configuration
        let valid = true;
        node.rules = node.rules.map(rule => {
            if (rule.propertyType !== "msg" || !rule.property || typeof rule.property !== "string" || !rule.property.trim()) {
                valid = false;
                return { property: "payload", propertyType: "msg" };
            }
            return rule;
        });
        if (!valid) {
            utils.setStatusError(node, "invalid rules, using defaults");
        } else {
            utils.setStatusOK(node, `rules: ${node.rules.map(r => r.property).join(", ")}`);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "missing message");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.context) {
                if (typeof msg.context !== "string" || !msg.context.trim()) {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                if (msg.context === "rules") {
                    if (!msg.hasOwnProperty("payload") || !Array.isArray(msg.payload) || !msg.payload.every(r => r.property && typeof r.property === "string" && r.propertyType === "msg")) {
                        utils.setStatusError(node, "invalid rules");
                        if (done) done();
                        return;
                    }
                    node.rules = msg.payload;
                    utils.setStatusOK(node, `rules: ${node.rules.map(r => r.property).join(", ")}`);
                    if (done) done();
                    return;
                }
            }

            // Replace the root message or apply nullification rules.
            const outputMsg = node.deleteAll ? {} : RED.util.cloneMessage(msg);
            const nullified = [];
            if (!node.deleteAll) {
                node.rules.forEach(rule => {
                    RED.util.setMessageProperty(outputMsg, rule.property, null);
                    nullified.push(rule.property);
                });
            }

            // Update status and send output
            utils.setStatusOK(node, node.deleteAll ? "all properties deleted" : `nullified: ${nullified.join(", ")}`);
            send(outputMsg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("nullify-block", NullifyBlockNode);
};