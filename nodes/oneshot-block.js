module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function OneshotBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        const durationMultiplier = config.durationUnits === "seconds" ? 1000 : config.durationUnits === "minutes" ? 60000 : 1;
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.duration = (parseFloat(config.duration)) * durationMultiplier;
        node.durationUnits = config.durationUnits;
        node.resetRequireTrue = config.resetRequireTrue;
        node.resetOnComplete = config.resetOnComplete;
        node.triggerCount = 0;
        node.locked = false;
        node.output = false;

        // Validate initial config
        if (isNaN(node.duration) || node.duration < 1) {
            node.duration = 1000;
            node.durationUnits = "milliseconds";
            utils.setStatusError(node, "invalid duration");
        }

        // Timer for pulse
        let timer = null;

        // Set initial status
        utils.setStatusOK(node, `triggers: ${node.triggerCount}, ${node.locked ? "locked" : "unlocked"}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (msg.context === "reset") {
                    if (node.resetRequireTrue && msg.payload !== true) {
                        utils.setStatusError(node, "invalid reset payload");
                        if (done) done();
                        return;
                    }
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    node.locked = false;
                    node.output = false;
                    utils.setStatusChanged(node, `triggers: ${node.triggerCount}, reset`);
                    send({ payload: false });
                    if (done) done();
                    return;
                }
                if (msg.context === "duration") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload for duration");
                        if (done) done();
                        return;
                    }
                    let newDuration = parseFloat(msg.payload);
                    const newDurationUnits = msg.units || "milliseconds";
                    const multiplier = newDurationUnits === "seconds" ? 1000 : newDurationUnits === "minutes" ? 60000 : 1;
                    newDuration *= multiplier;
                    if (isNaN(newDuration) || newDuration < 1) {
                        utils.setStatusError(node, "invalid duration");
                        if (done) done();
                        return;
                    }
                    node.duration = newDuration;
                    node.durationUnits = newDurationUnits;
                    utils.setStatusOK(node, `duration: ${node.duration.toFixed(0)} ms`);
                    if (done) done();
                    return;
                }
                utils.setStatusWarn(node, "unknown context");
                if (done) done("Unknown context");
                return;
            }

            // Get trigger input from configured property
            let triggerValue;
            try {
                triggerValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                triggerValue = undefined;
            }
            if (triggerValue === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            // Validate trigger input
            if (triggerValue !== true) {
                utils.setStatusWarn(node, `ignored: non-true`);
                if (done) done();
                return;
            }

            // Check if locked
            if (node.locked) {
                utils.setStatusError(node, `triggers: ${node.triggerCount}, locked`);
                send({ payload: node.output });
                if (done) done();
                return;
            }

            // Trigger pulse
            node.triggerCount++;
            node.locked = true;
            node.output = true;

            // Send true pulse
            utils.setStatusOK(node, `triggers: ${node.triggerCount}, out: true`);
            send({ payload: true });

            // Schedule false output
            timer = setTimeout(() => {
                node.output = false;
                if (node.resetOnComplete) {
                    node.locked = false;
                    utils.setStatusOK(node, `triggers: ${node.triggerCount}, unlocked`);
                } else {
                    utils.setStatusError(node, `triggers: ${node.triggerCount}, locked`);
                }
                send({ payload: false });
                timer = null;
            }, node.duration);

            if (done) done();
        });

        node.on("close", function(done) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            done();
        });
    }

    RED.nodes.registerType("oneshot-block", OneshotBlockNode);
};