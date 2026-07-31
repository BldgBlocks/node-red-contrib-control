module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function PriorityBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        function parseDefaultValue(value, type) {
            if (value === "" || value === undefined || value === null) return null;
            if (type === "num") {
                const parsed = Number(value);
                return Number.isNaN(parsed) ? null : parsed;
            }
            if (type === "bool") return value === true || value === "true";
            if (type === "json") {
                try {
                    return JSON.parse(value);
                } catch (error) {
                    return null;
                }
            }
            return String(value);
        }

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.operationMode = config.operationMode === "map" ? "map" : "context";
        node.outputProperty = typeof config.outputProperty === "string" && config.outputProperty.trim() ? config.outputProperty.trim() : "payload";
        node.defaultValue = parseDefaultValue(config.defaultValue, config.defaultValueType);
        node.mappings = Array.isArray(config.mappings) ? config.mappings.filter(mapping => {
            return mapping && typeof mapping.property === "string" && mapping.property.trim() &&
                (/^priority([1-9]|1[0-6])$/.test(mapping.slot) || mapping.slot === "fallback");
        }).map(mapping => ({ property: mapping.property.trim(), slot: mapping.slot })) : [];

        // Initialize state from context or defaults
        let priorities = context.get("priorities") || {
            priority1: null, priority2: null, priority3: null, priority4: null,
            priority5: null, priority6: null, priority7: null, priority8: null,
            priority9: null, priority10: null, priority11: null, priority12: null,
            priority13: null, priority14: null, priority15: null, priority16: null
        };
        let defaultValue = node.defaultValue;
        let fallbackValue = context.get("fallbackValue");
        if (fallbackValue === undefined) fallbackValue = null;
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

            if (node.operationMode === "map") {
                const updates = [];
                for (const mapping of node.mappings) {
                    const mappedValue = RED.util.getMessageProperty(msg, mapping.property);
                    if (mappedValue === undefined) continue;

                    const value = normalizeValue(mappedValue);
                    if (value === undefined) {
                        utils.setStatusError(node, `invalid ${mapping.property}`);
                        if (done) done();
                        return;
                    }
                    updates.push({ slot: mapping.slot, value });
                }

                if (updates.length === 0) {
                    utils.setStatusWarn(node, "no mapped properties found");
                    if (done) done();
                    return;
                }

                for (const update of updates) {
                    if (update.slot === "fallback") {
                        fallbackValue = update.value;
                    } else {
                        priorities[update.slot] = update.value;
                    }
                    messages[update.slot] = update.value === null ? null : RED.util.cloneMessage(msg);
                }
                context.set("priorities", priorities);
                context.set("fallbackValue", fallbackValue);
                context.set("messages", messages);
            } else {
                // Validate legacy context-mode messages.
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
            }

            // Output highest priority message
            const currentOutput = evaluatePriority();
            send(currentOutput);
            const outputValue = RED.util.getMessageProperty(currentOutput, node.outputProperty);
            const outDisplay = outputValue === null ? "null" : typeof outputValue === "number" ? outputValue.toFixed(2) : outputValue;
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
                const output = selectedMessage ? RED.util.cloneMessage(selectedMessage) : {};
                RED.util.setMessageProperty(output, node.outputProperty, selectedValue, true);
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