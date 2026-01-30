module.exports = function(RED) {
    const utils = require("./utils")(RED);

    function AccumulateBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.mode = config.mode;
        node.count = 0;
        node.lastCount = null;

        // Set initial status
        utils.setStatusOK(node, `mode: ${node.mode}, name: ${node.name || node.mode + " accumulate"}`);

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
                    node.count = 0;
                    utils.setStatusWarn(node, "reset");
                    if (done) done();
                    return;
                }
            }

            // Process input based on mode
            if (node.mode !== "flows") {
                // Get input value from configured property
                let inputValue;
                try {
                    inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
                } catch (err) {
                    inputValue = undefined;
                }
                const boolVal = utils.validateBoolean(inputValue);
                if (!boolVal.valid) {
                    utils.setStatusError(node, boolVal.error);
                    node.warn("Invalid input: non-boolean value");
                    if (done) done();
                    return;
                }
                inputValue = boolVal.value;

                // Prevent extended time running isues
                if (node.count > 9999) {
                    node.count = 0;
                }

                // Accumulate or reset count
                if (node.mode === "true") {
                    if (inputValue === true) {
                        node.count++;
                    } else {
                        node.count = 0;
                    }
                } else if (node.mode === "false") {
                    if (inputValue === false) {
                        node.count++;
                    } else {
                        node.count = 0;
                    }
                }
            } else {
                // flows mode: count all valid messages
                node.count++;
            }

            // Output only if count changed
            if (node.lastCount !== node.count) {
                node.lastCount = node.count;
                utils.setStatusChanged(node, `out: ${node.count}`);
                send({ payload: node.count });
            } else {
                utils.setStatusUnchanged(node, `out: ${node.count}`);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("accumulate-block", AccumulateBlockNode);
};