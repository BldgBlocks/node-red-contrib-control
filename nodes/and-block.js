module.exports = function(RED) {
    function AndBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "and";
        node.slots = parseInt(config.slots) || 2;
        if (typeof node.slots !== "number" || node.slots < 2) {
            node.slots = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid slots" });
        }

        // Initialize inputs
        let inputs = Array(node.slots).fill(false);

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

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

            if (msg.context.startsWith("in")) {
                let index = parseInt(msg.context.slice(2), 10);
                if (!isNaN(index) && index >= 1 && index <= node.slots) {
                    let value = Boolean(msg.payload);
                    inputs[index - 1] = value;
                    msg.payload = inputs.every(v => v === true);
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `slots: ${node.slots}, out: ${msg.payload}`
                    });
                    send(msg);
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "red", shape: "ring", text: `invalid input index ${index}` });
                    if (done) done();
                    return;
                }
            } else {
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("and-block", AndBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/and-block/:id", RED.auth.needsPermission("and-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "and-block") {
            res.json({
                name: node.name || "and",
                slots: !isNaN(node.slots) && node.slots >= 2 ? node.slots : 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};