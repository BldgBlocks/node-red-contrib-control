module.exports = function(RED) {
    function FrequencyBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "frequency";
        
        // Initialize state
        let lastIn = false;
        let lastEdge = 0;
        let completeCycle = false;
        let ppm = 0;
        let pph = 0;
        let ppd = 0;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

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
                        lastIn = false;
                        lastEdge = 0;
                        completeCycle = false;
                        ppm = 0;
                        pph = 0;
                        ppd = 0;
                        node.status({ fill: "green", shape: "dot", text: "reset" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Initialize output
            let output = { ppm, pph, ppd };

            // Detect rising edge
            if (inputValue && !lastIn) { // Rising edge: true and lastIn was false
                let now = Date.now();
                if (!completeCycle) {
                    completeCycle = true;
                } else {
                    // Compute period in minutes
                    let periodMs = now - lastEdge;
                    let periodMin = periodMs / 60000;
                    if (periodMin !== 0) {
                        output.ppm = 1 / periodMin; // Pulses per minute
                        output.pph = output.ppm * 60; // Pulses per hour
                        output.ppd = output.ppm * 1440; // Pulses per day
                        ppm = output.ppm;
                        pph = output.pph;
                        ppd = output.ppd;
                    }
                }
                lastEdge = now;
                completeCycle = true;

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
                    text: `input: ${inputValue}, ppm: ${ppm.toFixed(2)}`
                });
            }

            // Update lastIn
            lastIn = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            lastIn = false;
            lastEdge = 0;
            completeCycle = false;
            ppm = 0;
            pph = 0;
            ppd = 0;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("frequency-block", FrequencyBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/frequency-block/:id", RED.auth.needsPermission("frequency-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "frequency-block") {
            res.json({
                name: node.name || "frequency"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};