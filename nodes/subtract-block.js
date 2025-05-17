module.exports = function(RED) {
    function SubtractBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name || "subtract",
            slots: parseInt(config.slots) || 2,
            inputs: Array(parseInt(config.slots) || 2).fill(0),
            lastResult: null
        };

        // Validate initial config
        if (isNaN(node.runtime.slots) || node.runtime.slots < 1) {
            node.runtime.slots = 2;
            node.runtime.inputs = Array(2).fill(0);
            node.status({ fill: "red", shape: "ring", text: "invalid slots, using 2" });
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `name: ${node.runtime.name}, slots: ${node.runtime.slots}`
            });
        }

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

            // Handle configuration messages
            if (msg.context === "reset") {
                if (typeof msg.payload !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                    if (done) done();
                    return;
                }
                if (msg.payload === true) {
                    node.runtime.inputs = Array(node.runtime.slots).fill(0);
                    node.runtime.lastResult = null;
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
                node.runtime.slots = newSlots;
                node.runtime.inputs = Array(newSlots).fill(0);
                node.runtime.lastResult = null;
                node.status({ fill: "green", shape: "dot", text: `slots: ${node.runtime.slots}` });
                if (done) done();
                return;
            } else if (msg.context.startsWith("in")) {
                let slotIndex = parseInt(msg.context.slice(2)) - 1;
                if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= node.runtime.slots) {
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
                node.runtime.inputs[slotIndex] = newValue;
                // Calculate subtraction
                const result = node.runtime.inputs.reduce((acc, val, idx) => idx === 0 ? val : acc - val, 0);
                const isUnchanged = result === node.runtime.lastResult;
                node.status({
                    fill: "blue",
                    shape: isUnchanged ? "ring" : "dot",
                    text: `${msg.context}: ${newValue.toFixed(2)}, diff: ${result.toFixed(2)}`
                });
                node.runtime.lastResult = result;
                send({ ...msg, payload: result });
                if (done) done();
                return;
            } else {
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            node.runtime.slots = parseInt(config.slots) || 2;
            if (isNaN(node.runtime.slots) || node.runtime.slots < 1) {
                node.runtime.slots = 2;
            }
            node.runtime.inputs = Array(node.runtime.slots).fill(0);
            node.runtime.lastResult = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("subtract-block", SubtractBlockNode);
};