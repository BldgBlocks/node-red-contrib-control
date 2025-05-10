module.exports = function(RED) {
    function SubtractBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "subtract";
        node.slots = parseInt(config.slots) || 2;
        
        // Validate initial config
        if (isNaN(node.slots) || node.slots < 1) {
            node.status({ fill: "red", shape: "ring", text: "invalid slots" });
            node.slots = 2;
        }

        // Initialize state
        let inputs = Array(node.slots).fill(0);

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
                    inputs = Array(node.slots).fill(0);
                    node.status({ fill: "green", shape: "dot", text: "state reset" });
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
                inputs = Array(node.slots).fill(0);
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
                node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${newValue.toFixed(2)}` });
            } else {
                node.status({ fill: "red", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }

            // Calculate subtraction
            const result = inputs.reduce((acc, val, idx) => idx === 0 ? val : acc - val, 0);
            msg.payload = result;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `slots: ${node.slots}, diff: ${result}`
            });
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            node.slots = parseInt(config.slots) || 2;
            if (isNaN(node.slots) || node.slots < 1) {
                node.slots = 2;
            }
            inputs = Array(node.slots).fill(0);
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("subtract-block", SubtractBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/subtract-block/:id", RED.auth.needsPermission("subtract-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "subtract-block") {
            res.json({
                name: node.name || "subtract",
                slots: node.slots || 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};