module.exports = function (RED) {
    function OneshotBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize state
        node.triggerCount = context.get("triggerCount") || 0;
        node.locked = context.get("locked") || false;
        node.duration = parseInt(config.duration) || 1000; // Default 1000ms
        node.output = false;
        context.set("triggerCount", node.triggerCount);
        context.set("locked", node.locked);

        // Set initial status
        node.status({
            fill: node.locked ? "red" : "blue",
            shape: "dot",
            text: `triggers: ${node.triggerCount}, locked: ${node.locked}`
        });

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context === "reset") {
                node.locked = false;
                context.set("locked", false);
                node.output = false;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `triggers: ${node.triggerCount}, locked: false`
                });
                send({ payload: false });
                if (done) done();
                return;
            }

            if (node.locked) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: `triggers: ${node.triggerCount}, locked: true`
                });
                send({ payload: node.output });
                if (done) done();
                return;
            }

            // Check trigger condition
            const triggerOnTrue = config.triggerOnTrue || false;
            if (!triggerOnTrue || msg.payload === true) {
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
                        shape: "dot",
                        text: `triggers: ${node.triggerCount}, locked: true`
                    });
                    send({ payload: false });
                }, node.duration);
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `ignored: ${node.triggerCount}`
                });
                send({ payload: node.output });
            }

            if (done) done();
        });

        node.on("close", function (done) {
            done();
        });
    }

    RED.nodes.registerType("oneshot-block", OneshotBlockNode);
};