module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function OneshotBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        const durationMultiplier = config.durationUnits === "seconds" ? 1000 : config.durationUnits === "minutes" ? 60000 : 1;
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            duration: (parseFloat(config.duration)) * durationMultiplier,
            durationUnits: config.durationUnits,
            resetRequireTrue: config.resetRequireTrue,
            resetOnComplete: config.resetOnComplete,
            triggerCount: 0,
            locked: false,
            output: false
        };

        // Validate initial config
        if (isNaN(node.runtime.duration) || node.runtime.duration < 1) {
            node.runtime.duration = 1000;
            node.runtime.durationUnits = "milliseconds";
            utils.setStatusError(node, "invalid duration");
        }

        // Timer for pulse
        let timer = null;

        // Set initial status
        utils.setStatusOK(node, `triggers: ${node.runtime.triggerCount}, ${node.runtime.locked ? "locked" : "unlocked"}`);

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
                    if (node.runtime.resetRequireTrue && msg.payload !== true) {
                        utils.setStatusError(node, "invalid reset payload");
                        if (done) done();
                        return;
                    }
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    node.runtime.locked = false;
                    node.runtime.output = false;
                    utils.setStatusChanged(node, `triggers: ${node.runtime.triggerCount}, reset`);
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
                    node.runtime.duration = newDuration;
                    node.runtime.durationUnits = newDurationUnits;
                    utils.setStatusOK(node, `duration: ${node.runtime.duration.toFixed(0)} ms`);
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
                triggerValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
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
            if (node.runtime.locked) {
                utils.setStatusError(node, `triggers: ${node.runtime.triggerCount}, locked`);
                send({ payload: node.runtime.output });
                if (done) done();
                return;
            }

            // Trigger pulse
            node.runtime.triggerCount++;
            node.runtime.locked = true;
            node.runtime.output = true;

            // Send true pulse
            utils.setStatusOK(node, `triggers: ${node.runtime.triggerCount}, out: true`);
            send({ payload: true });

            // Schedule false output
            timer = setTimeout(() => {
                node.runtime.output = false;
                if (node.runtime.resetOnComplete) {
                    node.runtime.locked = false;
                    utils.setStatusOK(node, `triggers: ${node.runtime.triggerCount}, unlocked`);
                } else {
                    utils.setStatusError(node, `triggers: ${node.runtime.triggerCount}, locked`);
                }
                send({ payload: false });
                timer = null;
            }, node.runtime.duration);

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