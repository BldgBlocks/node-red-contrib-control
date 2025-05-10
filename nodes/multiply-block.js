module.exports = function(RED) {
    function MultiplyBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "multiply";
        node.slots = parseInt(config.slots) || 2;
        
        // Validate initial config
        if (isNaN(node.slots) || node.slots < 1) {
            node.status({ fill: "red", shape: "ring", text: "invalid slots" });
            node.slots = 2;
        }

        // Initialize state
        let inputs = Array(node.slots).fill(1);
        let lastResult = null;

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

            if (msg.context === "reset") {
                if (typeof msg.payload !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                    if (done) done();
                    return;
                }
                if (msg.payload === true) {
                    inputs = Array(node.slots).fill(1);
                    lastResult = null;
                    node.status({ fill: "green", shape: "dot", text: "reset" });
                }
                if (done) done();
                return;
            } else if (msg.context === "slots") {
                let newSlots = parseInt(msg.payload);
                if (isNaN(newSlots) || newSlots < 1) {
                    node.status({ fill: "red", shape: "ring", text: "invalid slots" });
                    if (done) done();
                    return;
                }
                node.slots = newSlots;
                inputs = Array(node.slots).fill(1);
                lastResult = null;
                node.status({ fill: "green", shape: "dot", text: `slots: ${node.slots}` });
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                let slotIndex = parseInt(msg.context.slice(2)) - 1;
                if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= node.slots) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input slot" });
                    if (done) done();
                    return;
                }
                let newValue = parseFloat(msg.payload);
                if (isNaN(newValue)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input" });
                    if (done) done();
                    return;
                }
                inputs[slotIndex] = newValue;
            } else {
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }

            // Calculate product
            const product = inputs.reduce((acc, val) => acc * val, 1);

            // Output only if result changed
            if (lastResult !== product) {
                lastResult = product;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${msg.context}=${parseFloat(msg.payload).toFixed(2)}, out: ${product.toFixed(2)}`
                });
                send({ payload: product });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${msg.context}=${parseFloat(msg.payload).toFixed(2)}, out: ${product.toFixed(2)}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            node.slots = parseInt(config.slots) || 2;
            if (isNaN(node.slots) || node.slots < 1) {
                node.slots = 2;
            }
            inputs = Array(node.slots).fill(1);
            lastResult = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("multiply-block", MultiplyBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/multiply-block/:id", RED.auth.needsPermission("multiply-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "multiply-block") {
            res.json({
                name: node.name || "multiply",
                slots: node.slots || 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};