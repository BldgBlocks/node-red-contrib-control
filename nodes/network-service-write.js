module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function NetworkServiceWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.registry = RED.nodes.getNode(config.registry);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Validation
                if (!msg || !msg.pointId || !msg.priority || msg.value === undefined) {
                    return utils.sendError(node, msg, done, "Invalid msg properties", msg?.pointId);
                }

                // Registry Lookup
                const entry = node.registry.lookup(msg.pointId);
                if (!entry?.path) {
                    const store = entry?.store ?? "unknown";
                    return utils.sendError(node, msg, done, `Unknown ID: (${store})::${msg.pointId}`, msg.pointId);
                }

                const { store = "default", path, writable } = entry;

                if (!writable) {
                    return utils.sendError(node, msg, done, `Not Writable: (${store})::${path}::${msg.pointId}`, msg.pointId);
                }

                // Get State (Async)
                let state = await utils.getGlobalState(node, path, store);

                if (!state || !state.priority) {
                    return utils.sendError(node, msg, done, `Point Not Found: (${store})::${path}`, msg.pointId);
                }

                // Type Check
                let newValue = msg.value === "null" || msg.value === null ? null : msg.value;
                if (newValue !== null) {
                    const dataType = state.metadata?.type;
                    if (dataType && typeof newValue !== dataType) {
                        return utils.sendError(node, msg, done, `Type Mismatch: Expected ${dataType}`, msg.pointId);
                    }
                }

                // Update Priority Logic
                if (msg.priority === 'default') {
                    state.defaultValue = newValue ?? state.defaultValue;
                } else {
                    const priority = parseInt(msg.priority, 10);
                    if (isNaN(priority) || priority < 1 || priority > 16) {
                        return utils.sendError(node, msg, done, `Invalid Priority: ${msg.priority}`, msg.pointId);
                    }
                    state.priority[msg.priority] = newValue;
                }

                // Calculate Winner
                const result = utils.getHighestPriority(state);
                state.value = result.value;
                state.activePriority = result.priority;
                state.metadata.lastSet = new Date().toISOString();

                // Save (Async) & Emit
                await utils.setGlobalState(node, path, store, state);

                const prefixReq = msg.priority === 'default' ? '' : 'P';
                const prefixAct = state.activePriority === 'default' ? '' : 'P';
                const statusMsg = `Wrote: ${prefixReq}${msg.priority}:${newValue} > Active: ${prefixAct}${state.activePriority}:${state.value}`;

                msg = { ...state, status: null }; 
                
                RED.events.emit("bldgblocks-global-update", { key: path, store: store, data: state });

                utils.sendSuccess(node, msg, done, statusMsg, msg.pointId, "ring");

            } catch (err) {
                node.error(err);
                utils.sendError(node, msg, done, `Internal Error: ${err.message}`, msg?.pointId);
            }
        });
    }
    RED.nodes.registerType("network-service-write", NetworkServiceWriteNode);
}
