module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CommentBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize properties
        node.name = config.name;
        node.comment = config.comment || "";
        node.statusDisplay = config.statusDisplay;
        node.statusProperty = config.statusProperty || "";
        node.statusPropertyType = config.statusPropertyType || "msg";

        // Pre-compile JSONata expression if configured
        let jsonataExpr = null;
        if (node.statusPropertyType === "jsonata" && node.statusProperty) {
            try {
                jsonataExpr = RED.util.prepareJSONataExpression(node.statusProperty, node);
            } catch (err) {
                node.error(`Invalid JSONata expression: ${err.message}`);
            }
        }

        // Ensure comment is within 100 characters
        if (node.comment && node.comment.length > 100) {
            node.comment = node.comment.substring(0, 100);
        }
        
        // Update status based on configuration (static — no msg available)
        const updateStaticStatus = function() {
            switch (node.statusDisplay) {
                case "default":
                    utils.setStatusOK(node, node.comment || "No comment set");
                    break;
                case "name":
                    utils.setStatusOK(node, node.name || "comment");
                    break;
                case "property":
                    // Can't resolve msg properties without a message — show placeholder
                    utils.setStatusOK(node, "waiting for input");
                    break;
                case "none":
                default:
                    break;
            }
        };

        // Resolve and display the configured status property from a message
        function resolveStatusProperty(msg) {
            return new Promise(function(resolve) {
                if (node.statusPropertyType === "jsonata" && jsonataExpr) {
                    RED.util.evaluateJSONataExpression(jsonataExpr, msg, function(err, result) {
                        if (err) {
                            resolve(undefined);
                        } else {
                            resolve(result);
                        }
                    });
                } else {
                    // msg type — use getMessageProperty
                    try {
                        resolve(RED.util.getMessageProperty(msg, node.statusProperty));
                    } catch (err) {
                        resolve(undefined);
                    }
                }
            });
        }

        function formatValue(val) {
            if (val === undefined) return "undefined";
            if (val === null) return "null";
            if (typeof val === "number") return val % 1 === 0 ? String(val) : val.toFixed(2);
            if (typeof val === "boolean") return String(val);
            if (typeof val === "string") return val.length > 40 ? val.substring(0, 40) + "…" : val;
            if (typeof val === "object") {
                const s = JSON.stringify(val);
                return s.length > 40 ? s.substring(0, 40) + "…" : s;
            }
            return String(val);
        }

        updateStaticStatus();

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            if (node.statusDisplay === "property" && node.statusProperty) {
                const val = await resolveStatusProperty(msg);
                if (val === undefined) {
                    utils.setStatusWarn(node, `${node.statusPropertyType === "jsonata" ? "expr" : node.statusProperty}: not found`);
                } else {
                    utils.setStatusChanged(node, formatValue(val));
                }
            } else {
                updateStaticStatus();
            }

            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("comment-block", CommentBlockNode);
};