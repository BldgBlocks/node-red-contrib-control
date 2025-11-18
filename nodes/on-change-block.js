module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            lastValue: null,
            blockTimer: null,
            pendingMsg: null
        };

        // Evaluate typed-input properties
        try {
            node.runtime.period = RED.util.evaluateNodeProperty( node.runtime.period, node.runtime.periodType, node );
            node.runtime.period = parseFloat(node.runtime.period);
        } catch (err) {
            node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate typed-input properties if needed
            try {
                if (utils.requiresEvaluation(node.runtime.periodType)) {
                    node.runtime.period = RED.util.evaluateNodeProperty( node.runtime.period, node.runtime.periodType, node, msg );
                    node.runtime.period = parseFloat(node.runtime.period);
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
                if (done) done();
                return;
            }

            // Acceptable fallbacks
            if (isNaN(node.runtime.period) || node.runtime.period < 0) {
                node.runtime.period = 0;
                node.status({ fill: "red", shape: "ring", text: "invalid period, using 0" });
            }

            // Handle context updates
            if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                const contextLower = msg.context.toLowerCase();
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
                    if (done) done();
                    return;
                }
                if (contextLower === "status") {
                    send({
                        payload: {
                            period: node.runtime.period,
                            periodType: node.runtime.periodType
                        }
                    });
                    if (done) done();
                    return;
                }
                // Ignore unknown context
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                send(msg);
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

            // Handle input during filter period
            if (node.runtime.blockTimer) {
                node.runtime.pendingMsg = RED.util.cloneMessage(msg);
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `filtered: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
                if (done) done();
                return;
            }

            // Allow no-change output if period > 0, othewise only on change
            if (!isEqual(currentValue, node.runtime.lastValue) || node.runtime.period > 0) {
                node.runtime.lastValue = RED.util.cloneMessage(currentValue);
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `out: ${JSON.stringify(currentValue).slice(0, 20)}`
                });
                send(msg);

                // Start filter period if applicable
                if (node.runtime.period > 0) {
                    node.runtime.blockTimer = setTimeout(() => {
                        node.runtime.blockTimer = null;
                        if (node.runtime.pendingMsg) {
                            const pendingValue = node.runtime.pendingMsg.payload;
                            if (!isEqual(pendingValue, node.runtime.lastValue)) {
                                node.runtime.lastValue = RED.util.cloneMessage(pendingValue);
                                node.status({
                                    fill: "blue",
                                    shape: "dot",
                                    text: `out: ${JSON.stringify(pendingValue).slice(0, 20)}`
                                });
                                send(node.runtime.pendingMsg);
                            } else {
                                node.status({
                                    fill: "blue",
                                    shape: "ring",
                                    text: `Filter period expired`
                                });
                            }
                            node.runtime.pendingMsg = null;
                        } else {
                            node.status({});
                        }
                    }, node.runtime.period);
                }
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
            done();
        });
    }

    RED.nodes.registerType("on-change-block", OnChangeBlockNode);
};