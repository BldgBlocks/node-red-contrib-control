module.exports = function(RED) {
    const utils = require("./utils")(RED);

    function AccumulateBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            mode: config.mode,
            count: 0,
            lastCount: null
        };

        // Set initial status
        utils.setStatusOK(node, `mode: ${node.runtime.mode}, name: ${node.runtime.name || node.runtime.mode + " accumulate"}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "missing message");
                node.warn("Missing message");
                if (done) done();
                return;
            }

            if (msg.context === "reset") {
                if (msg.payload === true) {
                    node.runtime.count = 0;
                    utils.setStatusWarn(node, "reset");
                    if (done) done();
                    return;
                }
            }

            // Process input based on mode
            if (node.runtime.mode !== "flows") {
                // Get input value from configured property
                let inputValue;
                try {
                    inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
                } catch (err) {
                    inputValue = undefined;
                }
                if (typeof inputValue !== "boolean") {
                    utils.setStatusError(node, "missing or invalid input property");
                    node.warn("Invalid input: non-boolean value");
                    if (done) done();
                    return;
                }

                // Prevent extended time running isues
                if (node.runtime.count > 9999) {
                    node.runtime.count = 0;
                }

                // Accumulate or reset count
                if (node.runtime.mode === "true") {
                    if (inputValue === true) {
                        node.runtime.count++;
                    } else {
                        node.runtime.count = 0;
                    }
                } else if (node.runtime.mode === "false") {
                    if (inputValue === false) {
                        node.runtime.count++;
                    } else {
                        node.runtime.count = 0;
                    }
                }
            } else {
                // flows mode: count all valid messages
                node.runtime.count++;
            }

            // Output only if count changed
            if (node.runtime.lastCount !== node.runtime.count) {
                node.runtime.lastCount = node.runtime.count;
                utils.setStatusChanged(node, `out: ${node.runtime.count}`);
                send({ payload: node.runtime.count });
            } else {
                utils.setStatusUnchanged(node, `out: ${node.runtime.count}`);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("accumulate-block", AccumulateBlockNode);
};