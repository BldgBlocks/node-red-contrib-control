module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            lastValue: null,
            blockTimer: null,
            period: parseFloat(config.period),
        };

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.periodType) 
                        ? utils.evaluateNodeProperty(config.period, config.periodType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.runtime.period),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.runtime.period = results[0];       
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
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

            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (inputValue === undefined) {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                send(msg);
                if (done) done();
                return;
            }

            const currentValue = inputValue;

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