module.exports = function(RED) {
    function AndBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            slots: parseInt(config.slots) || 2,
            inputs: Array(parseInt(config.slots) || 2).fill(false)
        };

        // Validate initial slots
        if (!Number.isInteger(node.runtime.slots) || node.runtime.slots < 2) {
            node.runtime.slots = 2;
            node.runtime.inputs = Array(2).fill(false);
            node.status({ fill: "red", shape: "ring", text: "invalid slots, using 2" });
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `slots: ${node.runtime.slots}`
            });
        }

        // Track last state for unchanged outputs
        let lastResult = null;
        let lastInputs = node.runtime.inputs.slice();

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Check for missing context or payload
            if (!msg.hasOwnProperty("context")) {
                node.status({ fill: "red", shape: "ring", text: "missing context" });
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process input slot
            if (msg.context.startsWith("in")) {
                let index = parseInt(msg.context.slice(2), 10);
                if (!isNaN(index) && index >= 1 && index <= node.runtime.slots) {
                    node.runtime.inputs[index - 1] = Boolean(msg.payload);
                    const result = node.runtime.inputs.every(v => v === true);
                    const isUnchanged = result === lastResult && node.runtime.inputs.every((v, i) => v === lastInputs[i]);
                    node.status({
                        fill: "blue",
                        shape: isUnchanged ? "ring" : "dot",
                        text: `in: [${node.runtime.inputs.join(", ")}], out: ${result}`
                    });
                    lastResult = result;
                    lastInputs = node.runtime.inputs.slice();
                    send({ payload: result });
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "red", shape: "ring", text: `invalid input index ${index || "NaN"}` });
                    if (done) done();
                    return;
                }
            }

            node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("and-block", AndBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/and-block-runtime/:id", RED.auth.needsPermission("and-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "and-block") {
            res.json({
                name: node.runtime.name,
                slots: node.runtime.slots,
                inputs: node.runtime.inputs || Array(node.runtime.slots).fill(false)
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};