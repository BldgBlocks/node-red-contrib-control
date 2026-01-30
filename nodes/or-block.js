module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function OrBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize state
        node.inputs = Array(parseInt(config.slots) || 2).fill(false)
        node.slots = parseInt(config.slots);

        node.status({ fill: "green", shape: "dot", text: `slots: ${node.slots}` });

        // Initialize logic fields
        let lastResult = null;
        let lastInputs = node.inputs.slice();

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Check required properties
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
                if (!isNaN(index) && index >= 1 && index <= node.slots) {
                    node.inputs[index - 1] = Boolean(msg.payload);
                    const result = node.inputs.some(v => v === true);
                    const isUnchanged = result === lastResult && node.inputs.every((v, i) => v === lastInputs[i]);
                    node.status({
                        fill: "blue",
                        shape: isUnchanged ? "ring" : "dot",
                        text: `in: [${node.inputs.join(", ")}], out: ${result}`
                    });
                    lastResult = result;
                    lastInputs = node.inputs.slice();
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
            done();
        });
    }

    RED.nodes.registerType("or-block", OrBlockNode);
};