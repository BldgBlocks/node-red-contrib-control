module.exports = function(RED) {
    function AccumulateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "accumulate",
            count: 0,
            lastCount: null
        };

        // Set initial status
        node.status({
            fill: "green",
            shape: "dot",
            text: `name: ${node.runtime.name}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle reset configuration
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        node.runtime.count = 0;
                        node.runtime.lastCount = null;
                        node.status({ fill: "green", shape: "dot", text: "state reset" });
                    }
                    if (done) done();
                    return;
                } 
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process input
            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Accumulate or reset count
            if (inputValue === true) {
                node.runtime.count++;
            } else {
                node.runtime.count = 0;
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
            // Reset state on redeployment
            node.runtime.count = 0;
            node.runtime.lastCount = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("accumulate-block", AccumulateBlockNode);
};