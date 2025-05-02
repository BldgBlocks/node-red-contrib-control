module.exports = function(RED) {
    function AndBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        // Initialize configurable properties
        this.slots = parseInt(config.slots) || 2;
        
        // Initialize state from context
        let context = this.context();
        let inputs = context.get("inputs") ?? Array(this.slots).fill(false);

        let node = this;

        // Handle configuration updates via msg.context
        node.on("input", function(msg) {
            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.warn("Configuration update ignored: msg.payload missing");
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    return null;
                }
                if (msg.context.startsWith("in")) {
                    let index = parseInt(msg.context.slice(2), 10);
                    if (!isNaN(index) && index >= 1 && index <= node.slots) {
                        let value = Boolean(msg.payload); // Convert to boolean
                        inputs[index - 1] = value; // Map 1-based to 0-based
                        context.set("inputs", inputs);
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `in${index} set to ${value}`
                        });
                    } else {
                        node.warn(`Invalid input index: ${msg.context} (valid: in1 to in${node.slots})`);
                        node.status({ fill: "red", shape: "ring", text: `invalid input index ${index}` });
                        return null;
                    }
                } else {
                    node.warn(`Unrecognized context property: ${msg.context}`);
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    return null;
                }
            }

            // Process input (non-config message assumed to update last input)
            let value = Boolean(msg.payload); // Convert to boolean
            if (inputs.length > 0) {
                inputs[inputs.length - 1] = value; // Update last input
                context.set("inputs", inputs);
            }

            // Compute logical AND
            let newMsg = { payload: inputs.every(input => input === true) };

            // Set status
            node.status({
                fill: "blue",
                shape: "dot",
                text: `out: ${newMsg.payload}, in: [${inputs.join(", ")}]`
            });

            node.send(newMsg);
        });

        // Clean up on node close
        node.on("close", function() {
            // No timers or resources to clean up
        });
    }

    RED.nodes.registerType("and-block", AndBlockNode);
};