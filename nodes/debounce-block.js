module.exports = function(RED) {
    function DebounceBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime for editor display
        node.runtime = {
            period: parseFloat(config.period) || 1000,
            debounceCount: 0
        };

        // Validate initial period
        if (isNaN(node.runtime.period) || node.runtime.period <= 0) {
            node.runtime.period = 1000;
            node.status({ fill: "red", shape: "ring", text: "invalid period, using 1000" });
        } else {
            node.status({
                fill: "green",
                shape: "dot",
                text: `period: ${node.runtime.period.toFixed(0)} ms`
            });
        }

        // Initialize state
        let debounceTimer = null;
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle msg.context
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                if (msg.context === "period") {
                    const newPeriod = parseFloat(msg.payload);
                    if (isNaN(newPeriod) || newPeriod <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid period" });
                        if (done) done();
                        return;
                    }
                    node.runtime.period = newPeriod;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `period: ${newPeriod.toFixed(0)} ms, bounced: ${node.runtime.debounceCount}`
                    });
                    if (done) done();
                    return;
                }

                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Process false payloads immediately
            if (msg.payload === false) {
                const statusText = `in: false, out: false, bounced: ${node.runtime.debounceCount}`;
                if (lastOutput === false) {
                    node.status({ fill: "blue", shape: "ring", text: statusText });
                } else {
                    node.status({ fill: "blue", shape: "dot", text: statusText });
                }
                lastOutput = false;
                delete msg.context;
                send(msg);
                if (done) done();
                return;
            }

            // Process true payloads with debouncing
            if (msg.payload === true) {
                // Increment debounce counter if resetting an active timer
                if (debounceTimer) {
                    node.runtime.debounceCount++;
                    if (node.runtime.debounceCount > 9999) {
                        node.runtime.debounceCount = 0;
                    }
                }

                // Clear existing timer
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                // Set new debounce timer
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    const statusText = `in: true, out: true, bounced: ${node.runtime.debounceCount}`;
                    node.status({ fill: "blue", shape: "dot", text: statusText });
                    lastOutput = true;
                    delete msg.context;
                    send(msg);
                }, node.runtime.period);

                if (done) done();
                return;
            }

            // Ignore non-boolean payloads
            node.status({ fill: "red", shape: "ring", text: "invalid payload" });
            if (done) done();
        });

        node.on("close", function(done) {
            // Clear timer on redeployment
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }

            // Reset period and counter
            node.runtime.period = parseFloat(config.period) || 1000;
            if (isNaN(node.runtime.period) || node.runtime.period <= 0) {
                node.runtime.period = 1000;
            }
            node.runtime.debounceCount = 0;

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("debounce-block", DebounceBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/debounce-block-runtime/:id", RED.auth.needsPermission("debounce-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "debounce-block") {
            res.json({
                period: !isNaN(node.runtime.period) && node.runtime.period > 0 ? node.runtime.period : 1000,
                debounceCount: node.runtime.debounceCount || 0
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};