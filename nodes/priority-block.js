module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function PriorityBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize runtime state
        // Initialize state
        node.name = config.name;

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

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Validate payload
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                utils.setStatusError(node, "missing or invalid context");
                if (done) done();
                return;
            }

            const contextMsg = msg.context;

            if (contextMsg === "clear") {
                // Clear all priority slots with one command; default and fallback remain untouched.
                for (let i = 1; i <= 16; i++) {
                    const key = `priority${i}`;
                    priorities[key] = null;
                    messages[key] = null;
                }
                context.set("priorities", priorities);
                context.set("messages", messages);
                utils.setStatusOK(node, "priority slots cleared");
            } else {
                const value = normalizeValue(msg.payload);
                if (value === undefined) {
                    utils.setStatusError(node, `invalid ${contextMsg}`);
                    if (done) done();
                    return;
                }

                if (/^priority([1-9]|1[0-6])$/.test(contextMsg)) {
                    priorities[contextMsg] = value;
                    messages[contextMsg] = value === null ? null : RED.util.cloneMessage(msg);
                    context.set("priorities", priorities);
                    context.set("messages", messages);
                    const priorityText = value === null ? `${contextMsg} relinquished` : `${contextMsg}: ${formatValue(value)}`;
                    utils.setStatusOK(node, priorityText);
                } else if (contextMsg === "fallback") {
                    fallbackValue = value;
                    messages[contextMsg] = value === null ? null : RED.util.cloneMessage(msg);
                    context.set("fallbackValue", fallbackValue);
                    context.set("messages", messages);
                    const fallbackText = value === null ? "fallback relinquished" : `fallback: ${formatValue(value)}`;
                    utils.setStatusOK(node, fallbackText);
                } else if (contextMsg === "default") {
                    // Preserve established default behavior contract: runtime messages do not modify default.
                    utils.setStatusWarn(node, "default is fixed");
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Output highest priority message
            const currentOutput = evaluatePriority();
            send(currentOutput);
            const outDisplay = currentOutput.payload === null ? "null" : typeof currentOutput.payload === "number" ? currentOutput.payload.toFixed(2) : currentOutput.payload;
            const statusText = `out: ${outDisplay}, slot: ${currentOutput.diagnostics.activePriority || "none"}`;
            utils.setStatusChanged(node, statusText);

            if (done) done();

            function normalizeValue(payload) {
                if (payload === null || payload === "") return null;
                if (typeof payload === "number") return parseFloat(payload);
                if (typeof payload === "boolean") return payload;
                if (typeof payload === "string") return payload;
                return undefined;
            }

            function formatValue(value) {
                return typeof value === "number" ? value.toFixed(2) : String(value);
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

                // Fall through to fallback, then default (matching global-setter hierarchy)
                if (selectedValue === null) {
                    if (fallbackValue !== null) {
                        selectedValue = fallbackValue;
                        activePriority = "fallback";
                        selectedMessage = messages.fallback;
                    } else if (defaultValue !== null) {
                        selectedValue = defaultValue;
                        activePriority = "default";
                        selectedMessage = messages.default;
                    }
                }

                // Return the original message if available, otherwise a new message
                const output = selectedMessage ? RED.util.cloneMessage(selectedMessage) : { payload: selectedValue };
                output.diagnostics = { activePriority };
                return output;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("priority-block", PriorityBlockNode);
};