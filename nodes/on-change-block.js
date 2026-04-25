module.exports = function(RED) {
    const utils = require("./utils")(RED);

    const VALID_MODES = ["on-change", "rate-limit", "pass-through"];

    function num(value, fallback) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeMode(value) {
        return VALID_MODES.includes(value) ? value : "on-change";
    }

    function clearGate(node) {
        if (node.blockTimer) {
            clearTimeout(node.blockTimer);
            node.blockTimer = null;
        }
    }

    function isEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, index) => isEqual(item, b[index]));
        }
        if (typeof a === "object" && a !== null && b !== null) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => isEqual(a[key], b[key]));
        }
        return false;
    }

    function previewValue(value) {
        try {
            const text = typeof value === "string" ? value : JSON.stringify(value);
            return (text === undefined ? String(value) : text).slice(0, 20);
        } catch (err) {
            return String(value).slice(0, 20);
        }
    }

    function modeStatus(node, state) {
        return `${node.mode}: ${state}`;
    }

    function OnChangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.mode = normalizeMode(config.mode);
        node.inputProperty = config.inputProperty || "payload";
        node.lastValue = null;
        node.blockTimer = null;
        node.periodType = config.periodType || "num";
        node.period = num(config.period, 0);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    utils.setStatusBusy(node, modeStatus(node, "busy"));
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(node.periodType) 
                        ? utils.evaluateNodeProperty(config.period, node.periodType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.period),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.period = results[0];       
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                utils.setStatusError(node, "error evaluating period");
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Acceptable fallbacks
            if (isNaN(node.period) || node.period < 0) {
                node.period = num(config.period, 0);
                utils.setStatusError(node, "invalid period, using 0");
            }

            // Handle context updates
            if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                if (msg.context === "period") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload for period");
                        if (done) done();
                        return;
                    }
                    const newPeriod = parseFloat(msg.payload);
                    if (isNaN(newPeriod) || newPeriod < 0) {
                        utils.setStatusError(node, "invalid period");
                        if (done) done();
                        return;
                    }
                    node.period = newPeriod;
                    node.periodType = "num";
                    if (node.period === 0) clearGate(node);
                    utils.setStatusOK(node, modeStatus(node, `${node.period.toFixed(0)}ms`));
                    if (done) done();
                    return;
                }
                if (msg.context === "mode") {
                    if (typeof msg.payload !== "string" || !VALID_MODES.includes(msg.payload)) {
                        utils.setStatusError(node, "invalid mode");
                        if (done) done();
                        return;
                    }
                    node.mode = msg.payload;
                    node.lastValue = null;
                    clearGate(node);
                    utils.setStatusOK(node, modeStatus(node, "set"));
                    if (done) done();
                    return;
                }
                // Ignore unknown context
            }

            // Get input value from configured property
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (inputValue === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                send(msg);
                if (done) done();
                return;
            }

            const currentValue = inputValue;

            if (node.mode !== "pass-through" && node.blockTimer) {
                utils.setStatusUnchanged(node, `${modeStatus(node, "closed")} |`);
                if (done) done();
                return;
            }

            if (node.mode === "on-change" && isEqual(currentValue, node.lastValue)) {
                utils.setStatusUnchanged(node, modeStatus(node, "unchanged"));
                if (done) done();
                return;
            }

            if (node.mode === "on-change") node.lastValue = currentValue;
            send(msg);
            utils.setStatusChanged(
                node,
                node.period > 0 && node.mode !== "pass-through"
                    ? modeStatus(node, "closed")
                    : modeStatus(node, "sent"),
            );

            if (node.period > 0 && node.mode !== "pass-through") {
                node.blockTimer = setTimeout(() => {
                    node.blockTimer = null;
                    utils.setStatusUnchanged(node, modeStatus(node, "open"));
                }, node.period);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            clearGate(node);
            done();
        });
    }

    RED.nodes.registerType("on-change-block", OnChangeBlockNode);
};