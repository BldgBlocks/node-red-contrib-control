module.exports = function(RED) {
    function FrequencyBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            lastIn: false,
            lastEdge: 0,
            completeCycle: false,
            ppm: 0,
            pph: 0,
            ppd: 0
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload for reset" });
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
                        node.runtime.lastIn = false;
                        node.runtime.lastEdge = 0;
                        node.runtime.completeCycle = false;
                        node.runtime.ppm = 0;
                        node.runtime.pph = 0;
                        node.runtime.ppd = 0;
                        node.status({ fill: "green", shape: "dot", text: "reset" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            // Initialize output
            let output = {
                ppm: node.runtime.ppm,
                pph: node.runtime.pph,
                ppd: node.runtime.ppd
            };

            // Detect rising edge
            if (inputValue && !node.runtime.lastIn) { // Rising edge: true and lastIn was false
                let now = Date.now();
                if (!node.runtime.completeCycle) {
                    node.runtime.completeCycle = true;
                } else {
                    // Compute period in minutes
                    let periodMs = now - node.runtime.lastEdge;
                    let periodMin = periodMs / 60000;
                    if (periodMin !== 0) {
                        output.ppm = 1 / periodMin; // Pulses per minute
                        output.pph = output.ppm * 60; // Pulses per hour
                        output.ppd = output.ppm * 1440; // Pulses per day
                        node.runtime.ppm = output.ppm;
                        node.runtime.pph = output.pph;
                        node.runtime.ppd = output.ppd;
                    }
                }
                node.runtime.lastEdge = now;
                node.runtime.completeCycle = true;

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `ppm: ${output.ppm.toFixed(2)}, pph: ${output.pph.toFixed(2)}, ppd: ${output.ppd.toFixed(2)}`
                });
                send({ payload: output });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `input: ${inputValue}, ppm: ${node.runtime.ppm.toFixed(2)}, pph: ${node.runtime.pph.toFixed(2)}, ppd: ${node.runtime.ppd.toFixed(2)}`
                });
            }

            // Update lastIn
            node.runtime.lastIn = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            node.runtime.lastIn = false;
            node.runtime.lastEdge = 0;
            node.runtime.completeCycle = false;
            node.runtime.ppm = 0;
            node.runtime.pph = 0;
            node.runtime.ppd = 0;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("frequency-block", FrequencyBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/frequency-block-runtime/:id", RED.auth.needsPermission("frequency-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "frequency-block") {
            res.json({
                name: node.runtime.name,
                ppm: node.runtime.ppm,
                pph: node.runtime.pph,
                ppd: node.runtime.ppd
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};