module.exports = function(RED) {
    function AndBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        const context = this.context();

        // Initialize name
        node.name = context.get("name") || config.name || "and";
        context.set("name", node.name);

        // Set slots from context or config
        node.slots = context.get("slots");
        if (typeof node.slots !== "number" || node.slots < 2) {
            node.slots = parseInt(config.slots) || 2;
            context.set("slots", node.slots);
        }

        // Initialize inputs
        let inputs = context.get("inputs");
        if (!Array.isArray(inputs) || inputs.length !== node.slots) {
            inputs = Array(node.slots).fill(false);
            context.set("inputs", inputs);
        }

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            let updateOccurred = false;

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (msg.context === "slots") {
                    let slotValue = Number(msg.payload);
                    if (Number.isInteger(slotValue) && slotValue >= 2) {
                        node.slots = slotValue;
                        context.set("slots", node.slots);
                        const newInputs = Array(slotValue).fill(false);
                        for (let i = 0; i < Math.min(inputs.length, slotValue); i++) {
                            newInputs[i] = inputs[i];
                        }
                        inputs = newInputs;
                        context.set("inputs", inputs);
                        node.status({ fill: "green", shape: "dot", text: `slots set to ${slotValue}` });
                        updateOccurred = true;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid slots" });
                        if (done) done();
                        return;
                    }
                } else if (msg.context.startsWith("in")) {
                    let index = parseInt(msg.context.slice(2), 10);
                    if (!isNaN(index) && index >= 1 && index <= node.slots) {
                        let value = Boolean(msg.payload);
                        inputs[index - 1] = value;
                        context.set("inputs", inputs);
                        node.status({ fill: "green", shape: "dot", text: `in${index} set to ${value}` });
                        updateOccurred = true;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: `invalid input index ${index}` });
                        if (done) done();
                        return;
                    }
                } else if (msg.context === "name") {
                    const newName = String(msg.payload || "").trim();
                    if (newName.length > 0) {
                        node.name = newName;
                        context.set("name", node.name);
                        node.status({ fill: "green", shape: "dot", text: `renamed to "${newName}"` });
                        updateOccurred = true;
                    }
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            if (!msg.context || updateOccurred) {
                const value = Boolean(msg.payload);
                if (inputs.length > 0) {
                    inputs[inputs.length - 1] = value;
                    context.set("inputs", inputs);
                }

                const result = inputs.every(v => v === true);
                send({ payload: result });

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: ${result}, in: [${inputs.join(", ")}]`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("and-block", AndBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/and-block/:id", RED.auth.needsPermission("and-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "and-block") {
            const context = node.context();
            const slots = context.get("slots");
            const name = context.get("name");
            res.json({
                name: typeof name === "string" && name.trim() ? name : "and",
                slots: typeof slots === "number" && slots >= 2 ? slots : 2
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};