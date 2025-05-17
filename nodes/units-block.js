module.exports = function(RED) {
    function UnitsBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            unit: config.unit || "°F",
            lastUnit: context.get("lastUnit") || config.unit || "°F",
            lastPayload: context.get("lastPayload") || null
        };

        // Validate configuration
        const validUnits = ["°C", "°F", "K", "%RH", "Pa", "kPa", "bar", "mbar", "psi", "atm", "inH₂O", "mmH₂O", "CFM", "m³/h", "L/s", "V", "mV", "A", "mA", "W", "Ω", "%", "m", "cm", "mm", "km", "ft", "in", "kg", "g", "lb", "s", "min", "h", "L", "mL", "gal", "lx", "cd", "B", "T"];
        if (!validUnits.includes(node.runtime.unit)) {
            node.runtime.unit = "°F";
            node.runtime.lastUnit = "°F";
            node.status({ fill: "red", shape: "ring", text: "invalid unit, using °F" });
            node.warn(`Invalid configuration: unit=${config.unit}, using °F`);
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `unit: ${node.runtime.unit}`
            });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn(`Missing message`);
                if (done) done();
                return;
            }

            try {
                // Handle configuration messages
                if (msg.context) {
                    if (typeof msg.context !== "string" || !msg.context.trim()) {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        node.warn(`Unknown context: ${msg.context}`);
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
                        node.runtime.lastUnit = msg.payload;
                        context.set("lastUnit", node.runtime.lastUnit);
                        node.status({ fill: "green", shape: "dot", text: `unit: ${node.runtime.unit}` });
                        if (done) done();
                        return;
                    } else {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        node.warn(`Unknown context: ${msg.context}`);
                        if (done) done();
                        return;
                    }
                }

                // Process input
                const outputMsg = { ...msg, units: node.runtime.unit };
                const payloadPreview = msg.payload !== null ? (typeof msg.payload === "number" ? msg.payload.toFixed(2) : JSON.stringify(msg.payload)) : "none";
                const isUnchanged = node.runtime.unit === node.runtime.lastUnit && JSON.stringify(msg.payload) === JSON.stringify(node.runtime.lastPayload);

                // Update state
                node.runtime.lastUnit = node.runtime.unit;
                node.runtime.lastPayload = msg.payload;
                context.set("lastUnit", node.runtime.lastUnit);
                context.set("lastPayload", node.runtime.lastPayload);

                // Update status
                node.status({
                    fill: "blue",
                    shape: isUnchanged ? "ring" : "dot",
                    text: `in: ${payloadPreview}, unit: ${node.runtime.unit}`
                });

                // Send output only if changed
                if (!isUnchanged) {
                    send(outputMsg);
                }

            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "processing error" });
                node.warn(`Processing error: ${error.message}`);
                if (done) done(error);
                return;
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("units-block", UnitsBlockNode);

    // HTTP endpoint for editor reflection
    RED.httpAdmin.get("/units-block/:id", RED.auth.needsPermission("units-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "units-block") {
            res.json({
                name: node.runtime.name || "",
                unit: node.runtime.unit || "°F"
            });
        } else {
            res.status(404).json({ error: "node not found" });
        }
    });
};