module.exports = function(RED) {
    function OneshotBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize state
        node.name = config.name || "oneshot";
        node.duration = parseInt(config.duration) || 1000;
        node.triggerOnTrue = config.triggerOnTrue || false;
        node.triggerCount = context.get("triggerCount") || 0;
        node.locked = context.get("locked") || false;
        node.output = false;
        context.set("triggerCount", node.triggerCount);
        context.set("locked", node.locked);

        // Validate initial config
        if (isNaN(node.duration) || node.duration < 1) {
            node.duration = 1000;
            node.status({ fill: "red", shape: "ring", text: "invalid duration" });
        }

        // Set initial status
        node.status({
            fill: node.locked ? "red" : "blue",
            shape: "dot",
            text: `triggers: ${node.triggerCount}, ${node.locked ? "locked" : "unlocked"}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context") && msg.context === "reset") {
                node.locked = false;
                node.output = false;
                context.set("locked", false);
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `triggers: ${node.triggerCount}, reset`
                });
                send({ payload: false });
                if (done) done();
                return;
            }

            if (node.locked) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `triggers: ${node.triggerCount}, locked`
                });
                send({ payload: node.output });
                if (done) done();
                return;
            }

            // Check trigger condition
            if (!node.triggerOnTrue || msg.payload === true) {
                node.triggerCount++;
                node.locked = true;
                node.output = true;
                context.set("triggerCount", node.triggerCount);
                context.set("locked", true);

                // Send true pulse
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `triggers: ${node.triggerCount}, out: true`
                });
                send({ payload: true });

                // Schedule false output after duration
                setTimeout(() => {
                    node.output = false;
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `triggers: ${node.triggerCount}, locked`
                    });
                    send({ payload: false });
                }, node.duration);
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `triggers: ${node.triggerCount}, ignored`
                });
                send({ payload: node.output });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("oneshot-block", OneshotBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/oneshot-block/:id", RED.auth.needsPermission("oneshot-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "oneshot-block") {
            res.json({
                name: node.name || "oneshot",
                duration: !isNaN(node.duration) && node.duration >= 1 ? node.duration : 1000,
                triggerOnTrue: node.triggerOnTrue || false
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};