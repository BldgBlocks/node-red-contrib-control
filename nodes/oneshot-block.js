module.exports = function(RED) {
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
            node.status({ fill: "red", shape: "ring", text: "invalid duration" });
        }

        // Timer for pulse
        let timer = null;

        // Set initial status
        node.status({
            fill: "blue",
            shape: "ring",
            text: `triggers: ${node.runtime.triggerCount}, ${node.runtime.locked ? "locked" : "unlocked"}`
        });

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
                if (msg.context === "reset") {
                    if (node.runtime.resetRequireTrue && msg.payload !== true) {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset payload" });
                        if (done) done();
                        return;
                    }
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    node.runtime.locked = false;
                    node.runtime.output = false;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `triggers: ${node.runtime.triggerCount}, reset`
                    });
                    send({ payload: false });
                    if (done) done();
                    return;
                }
                if (msg.context === "duration") {
                    if (!msg.hasOwnProperty("payload")) {
                        node.status({ fill: "red", shape: "ring", text: "missing payload for duration" });
                        if (done) done();
                        return;
                    }
                    let newDuration = parseFloat(msg.payload);
                    const newDurationUnits = msg.units || "milliseconds";
                    const multiplier = newDurationUnits === "seconds" ? 1000 : newDurationUnits === "minutes" ? 60000 : 1;
                    newDuration *= multiplier;
                    if (isNaN(newDuration) || newDuration < 1) {
                        node.status({ fill: "red", shape: "ring", text: "invalid duration" });
                        if (done) done();
                        return;
                    }
                    node.runtime.duration = newDuration;
                    node.runtime.durationUnits = newDurationUnits;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `duration: ${node.runtime.duration.toFixed(0)} ms`
                    });
                    if (done) done();
                    return;
                }
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
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
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                if (done) done();
                return;
            }

            // Validate trigger input
            if (triggerValue !== true) {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `ignored: non-true`
                });
                if (done) done();
                return;
            }

            // Check if locked
            if (node.runtime.locked) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `triggers: ${node.runtime.triggerCount}, locked`
                });
                send({ payload: node.runtime.output });
                if (done) done();
                return;
            }

            // Trigger pulse
            node.runtime.triggerCount++;
            node.runtime.locked = true;
            node.runtime.output = true;

            // Send true pulse
            node.status({
                fill: "green",
                shape: "dot",
                text: `triggers: ${node.runtime.triggerCount}, out: true`
            });
            send({ payload: true });

            // Schedule false output
            timer = setTimeout(() => {
                node.runtime.output = false;
                if (node.runtime.resetOnComplete) {
                    node.runtime.locked = false;
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `triggers: ${node.runtime.triggerCount}, unlocked`
                    });
                } else {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `triggers: ${node.runtime.triggerCount}, locked`
                    });
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