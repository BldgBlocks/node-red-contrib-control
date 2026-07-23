module.exports = function(RED) {
    const utils = require('./utils')(RED);

    const help = {
        read: "Request data from the server by pointId\nExample: `{ action: \"read\", pointId: 101 }`",
        write: "Write data to the server by pointId. The point must be writable and the value must match its type.\nExample: `{ action: \"write\", pointId: 101, priority: 16, value: 75.5 }`\nUse `null` or \"null\" as the value to release a priority.",
        discover: "Discover available points on the server.\nExample: `{ action: \"discover\" }`",
        help: "Display this help message.\nExample: `{ action: \"help\" }`"
    };

    function NetworkServiceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.registry = RED.nodes.getNode(config.registry);

        async function read(msg, done) {
            const entry = node.registry.lookup(msg.pointId);
            if (!entry) {
                return utils.sendError(node, msg, done, `Not Registered: ${msg.pointId}`, msg.pointId);
            }

            const state = await utils.getGlobalState(node, entry.path, entry.store || "default");
            if (!state || Object.keys(state).length === 0) {
                return utils.sendError(node, msg, done, `Global Data Empty: ${msg.pointId}`, msg.pointId);
            }

            const result = { ...state };
            const pointId = result.network?.pointId ?? msg.pointId;
            utils.sendSuccess(node, result, done, `Data Found. pointId: ${pointId} value: ${result.value ?? "No Value"}`, pointId, "ring");
        }

        async function write(msg, done) {
            if (msg.pointId === undefined || msg.pointId === null || msg.priority === undefined || msg.priority === null || msg.value === undefined) {
                return utils.sendError(node, msg, done, "Invalid write properties", msg.pointId);
            }

            const entry = node.registry.lookup(msg.pointId);
            if (!entry?.path) {
                return utils.sendError(node, msg, done, `Unknown ID: (${entry?.store ?? "unknown"})::${msg.pointId}`, msg.pointId);
            }
            if (!entry.writable) {
                return utils.sendError(node, msg, done, `Not Writable: (${entry.store || "default"})::${entry.path}::${msg.pointId}`, msg.pointId);
            }

            const store = entry.store || "default";
            const state = await utils.getGlobalState(node, entry.path, store);
            if (!state?.priority) {
                return utils.sendError(node, msg, done, `Point Not Found: (${store})::${entry.path}`, msg.pointId);
            }

            const value = msg.value === "null" || msg.value === null ? null : msg.value;
            const dataType = state.metadata?.type;
            if (value !== null && dataType && typeof value !== dataType) {
                return utils.sendError(node, msg, done, `Type Mismatch: Expected ${dataType}`, msg.pointId);
            }

            const priority = parseInt(msg.priority, 10);
            if (isNaN(priority) || priority < 1 || priority > 16) {
                return utils.sendError(node, msg, done, `Invalid Priority: ${msg.priority} (must be 1-16)`, msg.pointId);
            }

            state.priority[priority] = value;
            const result = utils.getHighestPriority(state);
            state.value = result.value;
            state.activePriority = result.priority;
            state.metadata.lastSet = new Date().toISOString();
            await utils.setGlobalState(node, entry.path, store, state);
            RED.events.emit("bldgblocks:global:value-changed", { key: entry.path, store, data: state });
            utils.sendSuccess(node, { ...state }, done, `Wrote: P${priority}:${value} > Active: ${state.activePriority}:${state.value}`, msg.pointId, "ring");
        }

        async function discover(msg, send, done) {
            const networkProperties = {};
            const entries = [...node.registry.points.values()];
            for (const entry of entries) {
                if (!entry.path) continue;
                const store = entry.store || "default";
                try {
                    const state = await utils.getGlobalState(node, entry.path, store);
                    if (!state?.metadata || !state?.network) continue;
                    if (!networkProperties[store]) networkProperties[store] = {};
                    networkProperties[store][entry.path] = {
                        store: state.metadata.store,
                        registry: state.network.registry,
                        path: state.metadata.path,
                        type: state.metadata.type,
                        pointId: state.network.pointId,
                        writable: state.network.writable
                    };
                } catch (error) {
                    node.trace(`Skipping unavailable point ${entry.path}: ${error.message}`);
                }
            }
            const pointCount = Object.values(networkProperties)
                .reduce((count, properties) => count + Object.keys(properties).length, 0);
            utils.setStatusChanged(node, `Returned ${pointCount} network point${pointCount === 1 ? "" : "s"}`);
            send({ ...msg, networkProperties, timestamp: Date.now() });
            if (done) done();
        }

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            if (!msg || typeof msg !== "object") {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }
            if (!node.registry) {
                utils.setStatusError(node, "Registry missing");
                if (done) done();
                return;
            }

            try {
                switch (msg.action) {
                    case "read": return await read(msg, done);
                    case "write": return await write(msg, done);
                    case "discover": return await discover(msg, send, done);
                    case "help":
                        utils.setStatusOK(node, "Help returned");
                        send({ ...msg, payload: help, help });
                        if (done) done();
                        return;
                    default:
                        utils.sendError(node, msg, done, "Invalid or missing action");
                }
            } catch (error) {
                node.error(error, msg);
                utils.sendError(node, msg, done, `Internal Error: ${error.message}`, msg.pointId);
            }
        });

        utils.setStatusOK(node, "Ready");
    }

    RED.nodes.registerType("network-service", NetworkServiceNode);
};