module.exports = function(RED) {
    function PriorityBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        const context = this.context();
        
        // Initialize properties from config
        node.name = config.name || "priority";
        
        // Initialize state from context or defaults
        let priorities = context.get("priorities") || {
            priority1: null, priority2: null, priority3: null, priority4: null,
            priority5: null, priority6: null, priority7: null, priority8: null,
            priority9: null, priority10: null, priority11: null, priority12: null,
            priority13: null, priority14: null, priority15: null, priority16: null
        };
        let defaultValue = context.get("defaultValue") || null;
        let fallbackValue = context.get("fallbackValue") || null;
        let messages = context.get("messages") || {
            priority1: null, priority2: null, priority3: null, priority4: null,
            priority5: null, priority6: null, priority7: null, priority8: null,
            priority9: null, priority10: null, priority11: null, priority12: null,
            priority13: null, priority14: null, priority15: null, priority16: null,
            default: null, fallback: null
        };

        // Save initial state to context
        context.set("priorities", priorities);
        context.set("defaultValue", defaultValue);
        context.set("fallbackValue", fallbackValue);
        context.set("messages", messages);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Handle keyed object payload for clearing
            if (typeof msg.payload === "object" && msg.payload !== null && msg.payload.hasOwnProperty("clear")) {
                const clear = msg.payload.clear;
                if (clear === "all") {
                    priorities = {
                        priority1: null, priority2: null, priority3: null, priority4: null,
                        priority5: null, priority6: null, priority7: null, priority8: null,
                        priority9: null, priority10: null, priority11: null, priority12: null,
                        priority13: null, priority14: null, priority15: null, priority16: null
                    };
                    defaultValue = null;
                    fallbackValue = null;
                    messages = {
                        priority1: null, priority2: null, priority3: null, priority4: null,
                        priority5: null, priority6: null, priority7: null, priority8: null,
                        priority9: null, priority10: null, priority11: null, priority12: null,
                        priority13: null, priority14: null, priority15: null, priority16: null,
                        default: null, fallback: null
                    };
                    context.set("priorities", priorities);
                    context.set("defaultValue", defaultValue);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    node.status({ fill: "green", shape: "dot", text: "all slots cleared" });
                } else if (typeof clear === "string" && isValidSlot(clear)) {
                    if (clear.startsWith("priority")) priorities[clear] = null;
                    else if (clear === "default") defaultValue = null;
                    else if (clear === "fallback") fallbackValue = null;
                    messages[clear] = null;
                    context.set("priorities", priorities);
                    context.set("defaultValue", defaultValue);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    node.status({ fill: "green", shape: "dot", text: `${clear} cleared` });
                } else if (Array.isArray(clear) && clear.every(isValidSlot)) {
                    clear.forEach(slot => {
                        if (slot.startsWith("priority")) priorities[slot] = null;
                        else if (slot === "default") defaultValue = null;
                        else if (slot === "fallback") fallbackValue = null;
                        messages[slot] = null;
                    });
                    context.set("priorities", priorities);
                    context.set("defaultValue", defaultValue);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    node.status({ fill: "green", shape: "dot", text: `${clear.join(", ")} cleared` });
                } else {
                    node.status({ fill: "red", shape: "ring", text: "invalid clear" });
                    if (done) done();
                    return;
                }
            } else if (msg.payload === "clear") {
                // Handle string "clear" with msg.context
                if (!msg.hasOwnProperty("context")) {
                    node.status({ fill: "red", shape: "ring", text: "missing context for clear" });
                    if (done) done();
                    return;
                }
                const contextMsg = msg.context;
                if (isValidSlot(contextMsg)) {
                    if (contextMsg.startsWith("priority")) priorities[contextMsg] = null;
                    else if (contextMsg === "default") defaultValue = null;
                    else if (contextMsg === "fallback") fallbackValue = null;
                    messages[contextMsg] = null;
                    context.set("priorities", priorities);
                    context.set("defaultValue", defaultValue);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    node.status({ fill: "green", shape: "dot", text: `${contextMsg} cleared` });
                } else {
                    node.status({ fill: "red", shape: "ring", text: "invalid clear context" });
                    if (done) done();
                    return;
                }
            } else {
                // Handle non-object, non-"clear" payloads
                if (!msg.hasOwnProperty("context")) {
                    node.status({ fill: "red", shape: "ring", text: "missing context" });
                    if (done) done();
                    return;
                }

                const contextMsg = msg.context;
                const value = msg.payload === null ? null : typeof msg.payload === "number" ? parseFloat(msg.payload) : msg.payload;

                if (/^priority([1-9]|1[0-6])$/.test(contextMsg)) {
                    if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: `invalid ${contextMsg}` });
                        if (done) done();
                        return;
                    }
                    priorities[contextMsg] = value;
                    messages[contextMsg] = RED.util.cloneMessage(msg);
                    context.set("priorities", priorities);
                    context.set("messages", messages);
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: value === null ? `${contextMsg} relinquished` : `${contextMsg}: ${value}`
                    });
                } else if (contextMsg === "default") {
                    if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid default" });
                        if (done) done();
                        return;
                    }
                    defaultValue = value;
                    messages[contextMsg] = RED.util.cloneMessage(msg);
                    context.set("defaultValue", defaultValue);
                    context.set("messages", messages);
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: value === null ? "default relinquished" : `default: ${value}`
                    });
                } else if (contextMsg === "fallback") {
                    if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid fallback" });
                        if (done) done();
                        return;
                    }
                    fallbackValue = value;
                    messages[contextMsg] = RED.util.cloneMessage(msg);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: value === null ? "fallback relinquished" : `fallback: ${value}`
                    });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            const currentOutput = evaluatePriority();
            send(currentOutput);
            const displayValue = currentOutput.payload === null ? "null" : typeof currentOutput.payload === "number" ? currentOutput.payload.toFixed(2) : currentOutput.payload;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${typeof msg.payload === "number" ? msg.payload.toFixed(2) : msg.payload}, out: ${displayValue}, slot: ${currentOutput.diagnostics.activePriority || "none"}`
            });

            if (done) done();
            return;

            function isValidSlot(slot) {
                return /^priority([1-9]|1[0-6])$/.test(slot) || slot === "default" || slot === "fallback";
            }

            function evaluatePriority() {
                let selectedValue = null;
                let activePriority = null;
                let selectedMessage = null;

                // Check priorities from 1 to 16
                for (let i = 1; i <= 16; i++) {
                    const key = `priority${i}`;
                    if (priorities[key] !== null) {
                        selectedValue = priorities[key];
                        activePriority = key;
                        selectedMessage = messages[key];
                        break;
                    }
                }

                // Fall back to default or fallback
                if (selectedValue === null) {
                    if (defaultValue !== null) {
                        selectedValue = defaultValue;
                        activePriority = "default";
                        selectedMessage = messages.default;
                    } else if (fallbackValue !== null) {
                        selectedValue = fallbackValue;
                        activePriority = "fallback";
                        selectedMessage = messages.fallback;
                    }
                }

                // Return the original message if available, otherwise a new message
                const output = selectedMessage ? RED.util.cloneMessage(selectedMessage) : { payload: selectedValue };
                output.diagnostics = { activePriority };
                return output;
            }
        });

        node.on("close", function(done) {
            // Clear status to prevent stale status after restart
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("priority-block", PriorityBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/priority-block/:id", RED.auth.needsPermission("priority-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "priority-block") {
            const context = node.context();
            res.json({
                name: node.name || "priority",
                priorities: context.get("priorities") || {},
                defaultValue: context.get("defaultValue") || null,
                fallbackValue: context.get("fallbackValue") || null
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};