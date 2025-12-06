module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            lastValue: null,
            blockTimer: null
        };

        // Evaluate typed-input properties
        try {
            node.runtime.period = parseFloat(RED.util.evaluateNodeProperty( config.period, config.periodType, node ));
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
                    node.runtime.period = parseFloat(RED.util.evaluateNodeProperty( config.period, config.periodType, node, msg ));
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
                if (done) done();
                return;
            }

            // Acceptable fallbacks
            if (isNaN(node.runtime.period) || node.runtime.period < 0) {
                node.runtime.period = config.period;
                node.status({ fill: "red", shape: "ring", text: "invalid period, using 0" });
            }

            // Handle context updates
            if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                if (msg.context === "period") {
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

            // Block if in filter period
            if (node.runtime.blockTimer) {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `filtered: ${JSON.stringify(currentValue).slice(0, 20)} |`
                });
                if (done) done();
                return;
            }

            // period === 0 means only ever on change, not equal outside of filter period sends an update message
            if (isEqual(currentValue, node.runtime.lastValue)) {
                if (node.runtime.period === 0) {
                    if (done) done();
                    return;
                }
            }

            node.runtime.lastValue = currentValue;
            send(msg);

            // Start filter period if applicable
            if (node.runtime.period > 0) {
                node.runtime.blockTimer = setTimeout(() => {
                    node.runtime.blockTimer = null;
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `filtered: ${JSON.stringify(currentValue).slice(0, 20)}` // remove ' |' to indicate end of filter period
                    });
                }, node.runtime.period);
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