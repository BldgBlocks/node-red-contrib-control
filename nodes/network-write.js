module.exports = function(RED) {
    function NetworkWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.registry = RED.nodes.getNode(config.registry);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Expecting: msg.payload = { pointId, priority, value }
            if (!msg || !msg.pointId || !msg.priority || msg.value === undefined) {
                node.status({ fill: "red", shape: "dot", text: "Invalid msg properties" });
                msg.status = { status: "fail", pointId: msg.pointId, error: `Invalid msg properties` };

                node.send(msg);
                if (done) done();
                return;
            }

            // Lookup Path
            const entry = node.registry.lookup(msg.pointId);
            const store = entry.store ?? "default";
            const path = entry.path;
            if (!entry || !path) {
                node.status({ fill: "red", shape: "dot", text: `Unknown ID: (${store})::${path}::${msg.pointId}` });
                msg.status = { status: "fail", pointId: msg.pointId, error: `Unknown ID: (${store})::${path}::${msg.pointId}` };

                node.send(msg);
                if (done) done();
                return;
            }
            
            // Check Writable
            if (!entry.writable) {
                node.status({ fill: "red", shape: "dot", text: `Not Writable: (${store})::${path}::${msg.pointId}` });
                msg.status = { status: "fail", pointId: msg.pointId, error: `Not Writable: (${store})::${path}::${msg.pointId}` };

                node.send(msg);
                if (done) done();
                return;
            }

            // Get State
            const globalContext = node.context().global;
            let state = globalContext.get(path, store);

            if (!state || !state.priority) {
                node.status({ fill: "red", shape: "ring", text: `Point Not Found: (${store})::${path}::${msg.pointId}` });
                msg.status = { status: "fail", pointId: msg.pointId, error: `Point Not Found: (${store})::${path}::${msg.pointId}` };

                node.send(msg);
                if (done) done();
                return;
            }

            // Check Type
            if (msg.value === "null" || msg.value === null) {
                msg.value = null;
            } else {
                const inputType = typeof msg.value;
                const dataType = state.metadata.type;
                if (inputType !== dataType) {
                    node.status({ fill: "red", shape: "ring", text: `Mismatch type error: ${store}:${path} ID: ${msg.pointId}, ${inputType} !== ${dataType}` });
                    msg.status = { status: "fail", pointId: msg.pointId, error: `Mismatch type error: ${store}:${path} ID: ${msg.pointId}, ${inputType} !== ${dataType}` };

                    node.send(msg);
                    if (done) done();
                    return;
                }
            }

            // Update Priority
            if (msg.priority === 'default') {
                state.defaultValue = msg.value ?? state.defaultValue;
            } else {
                const priority = parseInt(msg.priority, 10);
                if (isNaN(priority) || priority < 1 || priority > 16) {
                    node.status({ fill: "red", shape: "ring", text: `Invalid priority: ${msg.priority}` });
                    msg.status = { status: "fail", pointId: msg.pointId, error: `Invalid Priority: (${store})::${path}::${msg.pointId}` };

                    node.send(msg);
                    if (done) done();
                    return;
                }
                 
                state.priority[msg.priority] = msg.value;
            }

            // Calculate Winner (Same logic as Setter)
            let winnerValue = state.defaultValue;
            let winnerPriority = 'default'
            for (let i = 1; i <= 16; i++) {
                if (state.priority[i] !== undefined && state.priority[i] !== null) {
                    winnerValue = state.priority[i];
                    winnerPriority = `${i}`
                    break;
                }
            }
            state.value = winnerValue;
            state.activePriority = winnerPriority;
            state.metadata.lastSet = new Date().toISOString();

            // Save & Emit
            globalContext.set(path, state, store);
            msg = { ...state };
            node.status({ fill: "blue", shape: "dot", text: `Success: P${msg.priority}:${msg.value} > (${store})::${path}::${msg.pointId}` });
            msg.status = { status: "ok", pointId: msg.pointId, value: `Wrote: P${msg.priority}:${msg.value} > (${store})::${path}::${msg.pointId} Active: P${winnerPriority}:${winnerValue}` };
            
            // Trigger global getters to update on new value
            RED.events.emit("bldgblocks-global-update", {
                key: path,
                store: store,
                data: state
            });

            node.send(msg);
            if (done) done();
        });
    }
    RED.nodes.registerType("network-write", NetworkWriteNode);
}
