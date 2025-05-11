module.exports = function(RED) {
    const utils = require('./utils');

    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        node.config = {
            period: config.period,
            periodType: config.periodType || "num"
        };

        node.runtime = {
            period: node.config.period,
            periodType: node.config.periodType
        };

        let lastValue = null;
        let blockTimer = null;

        function isEqual(a, b) {
            if (a === b) return true;
            if (typeof a !== typeof b) return false;
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length) return false;
                return a.every((item, i) => isEqual(item, b[i]));
            }
            if (typeof a === 'object' && a !== null && b !== null) {
                const keysA = Object.keys(a);
                const keysB = Object.keys(b);
                if (keysA.length !== keysB.length) return false;
                return keysA.every(key => isEqual(a[key], b[key]));
            }
            return false;
        }

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload") && msg.context !== "status") {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                const contextLower = (msg.context || "").toLowerCase();
                if (contextLower === "period") {
                    node.runtime.period = utils.validateProperty(msg.payload, "num", 0, { min: 0, name: "period" }, msg, node);
                    node.runtime.periodType = "num";
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `period: ${node.runtime.period.toFixed(0)} ms`
                    });
                } else if (contextLower === "status") {
                    send({ payload: node.runtime });
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            let period = utils.validateProperty(node.runtime.period, node.runtime.periodType, 0, { min: 0, name: "period" }, msg, node);

            const currentValue = msg.payload;

            if (period > 0) {
                if (blockTimer) {
                    const statusText = isEqual(currentValue, lastValue)
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
                lastValue = RED.util.cloneMessage(currentValue);
                send(msg);
                blockTimer = setTimeout(() => {
                    blockTimer = null;
                    node.status({});
                }, period);
                if (done) done();
                return;
            }

            if (!isEqual(currentValue, lastValue)) {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
                lastValue = RED.util.cloneMessage(currentValue);
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
            if (blockTimer) {
                clearTimeout(blockTimer);
                blockTimer = null;
            }

            lastValue = null;
            node.runtime = {
                period: node.config.period,
                periodType: node.config.periodType
            };

            node.status({});
            done();
        });
    }

    RED.nodes.registerType("on-change-block", OnChangeBlockNode);

    RED.httpAdmin.get("/on-change-block-runtime/:id", RED.auth.needsPermission("on-change-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "on-change-block") {
            res.json(node.runtime);
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};