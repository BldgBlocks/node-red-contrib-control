module.exports = function(RED) {
    function AnalogSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            slots: parseInt(config.slots, 10),
            inputs: Array(parseInt(config.slots, 10) || 2).fill(0),
            switch: 1
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Validate context
            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                node.status({ fill: "red", shape: "ring", text: "missing context" });
                if (done) done();
                return;
            }

            // Validate payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            let shouldOutput = false;
            const prevSwitch = node.runtime.switch;

            switch (msg.context) {
                case "slots":
                    const slotValue = parseInt(msg.payload, 10);
                    if (isNaN(slotValue) || slotValue < 1) {
                        node.status({ fill: "red", shape: "ring", text: "invalid slots" });
                        if (done) done();
                        return;
                    }
                    node.runtime.slots = slotValue;
                    const newInputs = Array(node.runtime.slots).fill(0);
                    for (let i = 0; i < Math.min(node.runtime.inputs.length, node.runtime.slots); i++) {
                        newInputs[i] = node.runtime.inputs[i];
                    }
                    node.runtime.inputs = newInputs;
                    if (node.runtime.switch > node.runtime.slots) {
                        node.runtime.switch = 1;
                        shouldOutput = true;
                    }
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `slots: ${node.runtime.slots}`
                    });
                    break;
                case "switch":
                    const switchValue = parseInt(msg.payload, 10);
                    if (isNaN(switchValue) || switchValue < 1 || switchValue > node.runtime.slots) {
                        node.status({ fill: "red", shape: "ring", text: "invalid switch" });
                        if (done) done();
                        return;
                    }
                    node.runtime.switch = switchValue;
                    shouldOutput = prevSwitch !== node.runtime.switch;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `switch: ${node.runtime.switch}`
                    });
                    break;
                default:
                    if (msg.context.startsWith("in")) {
                        const index = parseInt(msg.context.slice(2), 10);
                        if (isNaN(index) || index < 1 || index > node.runtime.slots) {
                            node.status({ fill: "red", shape: "ring", text: `invalid input index ${index}` });
                            if (done) done();
                            return;
                        }
                        const value = parseFloat(msg.payload);
                        if (isNaN(value)) {
                            node.status({ fill: "red", shape: "ring", text: `invalid in${index}` });
                            if (done) done();
                            return;
                        }
                        node.runtime.inputs[index - 1] = value;
                        shouldOutput = index === node.runtime.switch;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `in${index}: ${value.toFixed(2)}`
                        });
                    } else {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done("Unknown context");
                        return;
                    }
                    break;
            }

            // Output new message if the active slot is updated or switch/slots change affects output
            if (shouldOutput) {
                const out = node.runtime.inputs[node.runtime.switch - 1] ?? node.runtime.inputs[0];
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `slots: ${node.runtime.slots}, switch: ${node.runtime.switch}, out: ${out.toFixed(2)}`
                });
                send({ payload: out });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }
    
    RED.nodes.registerType("analog-switch-block", AnalogSwitchBlockNode);
};