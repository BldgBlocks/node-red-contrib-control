module.exports = function(RED) {
    function OneshotBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            duration: parseInt(config.duration) || 1000,
            triggerOnTrue: config.triggerOnTrue !== false,
            triggerCount: 0,
            locked: false,
            output: false
        };

        // Validate initial config
        if (!Number.isInteger(node.runtime.duration) || node.runtime.duration < 1) {
            node.runtime.duration = 1000;
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
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
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

            // Check trigger condition
            if (!node.runtime.triggerOnTrue || msg.payload === true) {
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
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `triggers: ${node.runtime.triggerCount}, locked`
                    });
                    send({ payload: false });
                    timer = null;
                }, node.runtime.duration);
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `triggers: ${node.runtime.triggerCount}, ignored`
                });
                send({ payload: node.runtime.output });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("oneshot-block", OneshotBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/oneshot-block-runtime/:id", RED.auth.needsPermission("oneshot-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "oneshot-block") {
            res.json({
                name: node.runtime.name,
                duration: node.runtime.duration,
                triggerOnTrue: node.runtime.triggerOnTrue,
                triggerCount: node.runtime.triggerCount,
                locked: node.runtime.locked,
                output: node.runtime.output
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};