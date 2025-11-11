module.exports = function(RED) {
    function AccumulateBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            mode: config.mode,
            count: 0,
            lastCount: null
        };

        // Set initial status
        node.status({
            fill: "green",
            shape: "dot",
            text: `mode: ${node.runtime.mode}, name: ${node.runtime.name || node.runtime.mode + " accumulate"}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn("Missing message");
                if (done) done();
                return;
            }

            // Handle reset command with intentional payload requirement
            if (msg.context === "reset") {
                if (msg.payload === true) {
                    count = 0;
                    updateStatus();
                    if (done) done();
                    return;
                }
                // payload !== true: treat as normal message, don't reset
            }

            // Process input based on mode
            if (node.runtime.mode !== "flows") {
                // Check for missing payload
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    node.warn("Missing payload");
                    if (done) done();
                    return;
                }

                // Validate input
                const inputValue = msg.payload;
                if (typeof inputValue !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: "invalid input" });
                    node.warn("Invalid input: non-boolean payload");
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
                node.status({ fill: "blue", shape: "dot", text: `out: ${node.runtime.count}` });
                send({ payload: node.runtime.count });
            } else {
                node.status({ fill: "blue", shape: "ring", text: `out: ${node.runtime.count}` });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("accumulate-block", AccumulateBlockNode);
};