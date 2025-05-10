module.exports = function(RED) {
    function OrBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "or";
        node.slots = parseInt(config.slots) || 2;
        if (isNaN(node.slots) || node.slots < 2) {
            node.slots = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid slots" });
        }

        // Initialize inputs
        let inputs = Array(node.slots).fill(false);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg.hasOwnProperty("context")) {
                node.status({ fill: "yellow", shape: "ring", text: "missing context" });
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            if (msg.context.startsWith("in")) {
                let index = parseInt(msg.context.slice(2), 10);
                if (!isNaN(index) && index >= 1 && index <= node.slots) {
                    let value = Boolean(msg.payload);
                    let store = inputs[index - 1];
                    if (store !== value) {
                        inputs[index - 1] = value;
                        const result = inputs.some(v => v === true);
                        node.status({
                            fill: "blue",
                            shape: "dot",
                            text: `in: [${inputs.join(", ")}], out: ${result}`
                        });
                        send({ payload: result });
                    } else {
                        node.status({
                            fill: "blue",
                            shape: "ring",
                            text: `in: [${inputs.join(", ")}], out: ${inputs.some(v => v === true)}`
                        });
                    }
                } else {
                    node.status({ fill: "red", shape: "ring", text: "invalid input slot" });
                }
                if (done) done();
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
            if (done) done();
        });

        node.on("close", function(done) {
            inputs = Array(node.slots).fill(false);
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("or-block", OrBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/or-block/:id", RED.auth.needsPermission("or-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "or-block") {
            res.json({
                name: node.name || "or",
                slots: !isNaN(node.slots) && node.slots >= 2 ? node.slots : 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};