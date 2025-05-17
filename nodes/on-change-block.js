module.exports = function(RED) {
    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            period: Number(config.period) || 0,
            periodType: config.periodType || "num",
            lastValue: null,
            blockTimer: null
        };

        // Validate initial config
        if (isNaN(node.runtime.period) || node.runtime.period < 0) {
            node.runtime.period = 0;
            node.status({ fill: "red", shape: "ring", text: "invalid period" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                const contextLower = (msg.context || "").toLowerCase();
                if (contextLower === "period") {
                    if (!msg.hasOwnProperty("payload")) {
                        node.status({ fill: "red", shape: "ring", text: "missing payload for period" });
                        if (done) done();
                        return;
                    }
                    const newPeriod = parseFloat(msg.payload);
                    if (isNaN(newPeriod) || newPeriod < 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid period" });
                        if (done) done();
                        return;
                    }
                    node.runtime.period = newPeriod;
                    node.runtime.periodType = "num";
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `period: ${node.runtime.period.toFixed(0)} ms`
                    });
                } else if (contextLower === "status") {
                    send({ payload: {
                        period: node.runtime.period,
                        periodType: node.runtime.periodType
                    } });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
                if (done) done();
                return;
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Get period
            let period;
            try {
                period = RED.util.evaluateNodeProperty(
                    node.runtime.period,
                    node.runtime.periodType,
                    node,
                    msg
                );
                if (isNaN(period) || period < 0) {
                    throw new Error("invalid period");
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "invalid period" });
                if (done) done();
                return;
            }

            const currentValue = msg.payload;

            // Deep comparison function
            function isEqual(a, b) {
                if (a === b) return true;
                if (typeof a !== typeof b) return false;
                if (Array.isArray(a) && Array.isArray(b)) {
                    if (a.length !== b.length) return false;
                    return a.every((item, i) => isEqual(item, b[i]));
                }
                if (typeof a === "object" && a !== null && b !== null) {
                    const keysA = Object.keys(a);
                    const keysB = Object.keys(b);
                    if (keysA.length !== keysB.length) return false;
                    return keysA.every(key => isEqual(a[key], b[key]));
                }
                return false;
            }

            if (period > 0) {
                if (node.runtime.blockTimer) {
                    const statusText = isEqual(currentValue, node.runtime.lastValue)
                        ? `unchanged: ${JSON.stringify(currentValue).slice(0, 20)}`
                        : `blocked: ${JSON.stringify(currentValue).slice(0, 20)}`;
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: statusText
                    });
                    if (done) done();
                    return;
                }
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
                node.runtime.lastValue = RED.util.cloneMessage(currentValue);
                send(msg);
                node.runtime.blockTimer = setTimeout(() => {
                    node.runtime.blockTimer = null;
                    node.status({});
                }, period);
                if (done) done();
                return;
            }

            if (!isEqual(currentValue, node.runtime.lastValue)) {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
                node.runtime.lastValue = RED.util.cloneMessage(currentValue);
                send(msg);
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `unchanged: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (node.runtime.blockTimer) {
                clearTimeout(node.runtime.blockTimer);
                node.runtime.blockTimer = null;
            }
            node.runtime.lastValue = null;
            node.runtime.period = Number(config.period) || 0;
            node.runtime.periodType = config.periodType || "num";
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("on-change-block", OnChangeBlockNode);

    RED.httpAdmin.get("/on-change-block-runtime/:id", RED.auth.needsPermission("on-change-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "on-change-block") {
            res.json({
                period: node.runtime.period,
                periodType: node.runtime.periodType
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};