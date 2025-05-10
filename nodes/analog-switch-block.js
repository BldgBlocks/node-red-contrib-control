module.exports = function(RED) {
    function AnalogSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "analog switch";
        node.slots = parseInt(config.slots, 10) || 2;

        // Validate initial config
        if (isNaN(node.slots) || node.slots < 1) {
            node.slots = 2;
            node.status({ fill: "red", shape: "ring", text: "invalid slots" });
        }

        // Initialize state
        let inputs = Array(node.slots).fill(0);
        let s1 = 1;

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

            let shouldOutput = false;
            const prevS1 = s1;

            switch (msg.context) {
                case "slots":
                    const slotValue = parseInt(msg.payload, 10);
                    if (isNaN(slotValue) || slotValue < 1) {
                        node.status({ fill: "red", shape: "ring", text: "invalid slots" });
                        if (done) done();
                        return;
                    }
                    node.slots = slotValue;
                    const newInputs = Array(node.slots).fill(0);
                    for (let i = 0; i < Math.min(inputs.length, node.slots); i++) {
                        newInputs[i] = inputs[i];
                    }
                    inputs = newInputs;
                    if (s1 > node.slots) {
                        s1 = 1;
                        shouldOutput = true;
                    }
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `slots: ${node.slots}`
                    });
                    break;
                case "switch":
                    const switchValue = parseInt(msg.payload, 10);
                    if (isNaN(switchValue) || switchValue < 1 || switchValue > node.slots) {
                        node.status({ fill: "red", shape: "ring", text: "invalid switch" });
                        if (done) done();
                        return;
                    }
                    s1 = switchValue;
                    shouldOutput = prevS1 !== s1;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `switch: ${s1}`
                    });
                    break;
                default:
                    if (msg.context.startsWith("in")) {
                        const index = parseInt(msg.context.slice(2), 10);
                        if (isNaN(index) || index < 1 || index > node.slots) {
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
                        inputs[index - 1] = value;
                        shouldOutput = index === s1;
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `in${index}: ${value.toFixed(2)}`
                        });
                    } else {
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done();
                        return;
                    }
                    break;
            }

            // Output new message if the active slot is updated or switch/slots change affects output
            if (shouldOutput) {
                const out = inputs[s1 - 1] ?? inputs[0];
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `slots: ${node.slots}, switch: ${s1}, out: ${out}`
                });
                send({ payload: out });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state and properties on redeployment
            node.slots = parseInt(config.slots, 10) || 2;
            if (isNaN(node.slots) || node.slots < 1) {
                node.slots = 2;
            }
            inputs = Array(node.slots).fill(0);
            s1 = 1;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("analog-switch-block", AnalogSwitchBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/analog-switch-block/:id", RED.auth.needsPermission("analog-switch-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "analog-switch-block") {
            res.json({
                name: node.name || "analog switch",
                slots: !isNaN(node.slots) && node.slots >= 1 ? node.slots : 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};