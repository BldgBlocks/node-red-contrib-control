module.exports = function(RED) {
    function AddBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.slots = parseInt(config.slots) || 2;
        node.inputs = Array(parseInt(config.slots) || 2).fill(0);

        let lastSum = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Check for required properties
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

            // Handle configuration messages
            if (msg.context === "reset") {
                if (typeof msg.payload !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                    if (done) done();
                    return;
                }
                if (msg.payload === true) {
                    node.inputs = Array(node.slots).fill(0);
                    lastSum = null;
                    node.status({ fill: "green", shape: "dot", text: "state reset" });
                    if (done) done();
                    return;
                }
            } else if (msg.context === "slots") {
                let newSlots = parseInt(msg.payload);
                if (isNaN(newSlots) || newSlots < 1) {
                    node.status({ fill: "red", shape: "ring", text: "invalid slots" });
                    if (done) done();
                    return;
                }
                node.slots = newSlots;
                node.inputs = Array(newSlots).fill(0);
                lastSum = null;
                node.status({ fill: "green", shape: "dot", text: `slots: ${node.slots}` });
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                let slotIndex = parseInt(msg.context.slice(2)) - 1;
                if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= node.slots) {
                    node.status({ fill: "red", shape: "ring", text: `invalid input slot ${msg.context}` });
                    if (done) done();
                    return;
                }
                let newValue = parseFloat(msg.payload);
                if (isNaN(newValue)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input" });
                    if (done) done();
                    return;
                }
                node.inputs[slotIndex] = newValue;
                // Calculate sum
                const sum = node.inputs.reduce((acc, val) => acc + val, 0);
                const isUnchanged = sum === lastSum;
                node.status({ fill: "blue", shape: isUnchanged ? "ring" : "dot", text: `${msg.context}: ${newValue.toFixed(2)}, sum: ${sum.toFixed(2)}` });
                lastSum = sum;
                send({ payload: sum });
                if (done) done();
                return;
            } else {
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("add-block", AddBlockNode);
};