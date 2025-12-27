
module.exports = function(RED) {
    function UnitsBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            unit: config.unit
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object" || !msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });

                if (done) done();
                return;
            }

            try {
                // Handle configuration messages
                if (msg.hasOwnProperty("context")) {
                    // Configuration handling
                    if (msg.context === "unit") {
                        if (typeof msg.payload === "string") {
                            node.runtime.unit = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `unit: ${node.runtime.unit}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid unit" });
                        }
                        if (done) done();
                        return;
                    }

                    // Handle unknown context
                    if (msg.context && msg.context !== "unit") {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        // Continue processing as passthrough
                    }
                }

                // Process input
                const payloadPreview = msg.payload !== null ? (typeof msg.payload === "number" ? msg.payload.toFixed(2) : JSON.stringify(msg.payload).slice(0, 20)) : "none";

                node.status({ fill: "blue", shape: "dot", text: `in: ${payloadPreview} unit: ${node.runtime.unit !== "" ? node.runtime.unit : "none"}` });

                msg.units = node.runtime.unit;
                send(msg);
                if (done) done();
            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "processing error" });

                if (done) done(error);
                return;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("units-block", UnitsBlockNode);
};