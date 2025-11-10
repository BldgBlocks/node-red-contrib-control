module.exports = function(RED) {
    function UnitsBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            unit: config.unit
        };

        // Validate configuration (Req 8)
        const validUnits = ["°C", "°F", "K", "%RH", "Pa", "kPa", "bar", "mbar", "psi", "atm", "inH₂O", "mmH₂O", "CFM", "m³/h", "L/s", "V", "mV", "A", "mA", "W", "Ω", "%", "m", "cm", "mm", "km", "ft", "in", "kg", "g", "lb", "s", "min", "h", "L", "mL", "gal", "lx", "cd", "B", "T"];
        if (!validUnits.includes(node.runtime.unit)) {
            node.runtime.unit = "°F";
            node.status({ fill: "red", shape: "ring", text: "invalid unit, using °F" });
            node.warn(`Invalid configuration: unit=${config.unit}, using °F`);
        } else {
            node.status({ fill: "green", shape: "dot", text: `in: unit: ${node.runtime.unit}` });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                node.warn(`Invalid message`);
                if (done) done();
                return;
            }

            try {
                // Handle configuration messages
                if (msg.context) {
                    if (typeof msg.context !== "string" || !msg.context.trim()) {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                    }
                    if (msg.context === "unit") {
                        if (!msg.hasOwnProperty("payload") || typeof msg.payload !== "string" || !validUnits.includes(msg.payload)) {
                            node.status({ fill: "red", shape: "ring", text: "invalid unit" });
                            node.warn(`Invalid unit: ${msg.payload}`);
                            if (done) done();
                            return;
                        }
                        node.runtime.unit = msg.payload;
                        node.status({ fill: "green", shape: "dot", text: `in: unit: ${node.runtime.unit}` });
                        if (done) done();
                        return;
                    }
                    // Passthrough node: ignore unknown context without error
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                }

                // Process input: append units to message
                const outputMsg = { ...msg, units: node.runtime.unit };
                const payloadPreview = msg.payload !== null ? (typeof msg.payload === "number" ? msg.payload.toFixed(2) : JSON.stringify(msg.payload).slice(0, 20)) : "none";
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${payloadPreview} out: unit: ${node.runtime.unit}`
                });
                send(outputMsg);
                if (done) done();
            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "processing error" });
                node.warn(`Processing error: ${error.message}`);
                if (done) done(error);
                return;
            }
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("units-block", UnitsBlockNode);
};