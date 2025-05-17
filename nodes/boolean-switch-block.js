module.exports = function(RED) {
    function BooleanSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize runtime for editor display
        node.runtime = {
            name: config.name || ""
        };

        // Initialize persistent state
        node.state = context.get("state") !== undefined ? context.get("state") : false;
        node.inTrue = context.get("inTrue") !== undefined ? context.get("inTrue") : null;
        node.inFalse = context.get("inFalse") !== undefined ? context.get("inFalse") : null;
        context.set("state", node.state);
        context.set("inTrue", node.inTrue);
        context.set("inFalse", node.inFalse);

        // Set initial status
        const activeSlot = node.state ? "inTrue" : "inFalse";
        const initialOutput = node.state ? node.inTrue : node.inFalse;
        node.status({
            fill: "green",
            shape: "dot",
            text: `switch: ${activeSlot}, out: ${initialOutput === null ? "null" : initialOutput}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Require msg.context
            if (!msg.hasOwnProperty("context")) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "missing context"
                });
                if (done) done();
                return;
            }

            // Handle context commands
            if (msg.context === "toggle" || msg.context === "switch") {
                node.state = !node.state;
                context.set("state", node.state);
                const newActiveSlot = node.state ? "inTrue" : "inFalse";
                const output = node.state ? node.inTrue : node.inFalse;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `switch: ${newActiveSlot}, out: ${output === null ? "null" : output}`
                });
                send({ payload: output });
                if (done) done();
                return;
            } else if (msg.context === "inTrue" || msg.context === "inFalse") {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `missing payload for ${msg.context}`
                    });
                    if (done) done();
                    return;
                }
                const payloadDisplay = msg.payload === null ? "null" : msg.payload;
                if (msg.context === "inTrue" && node.state) {
                    node.inTrue = msg.payload;
                    context.set("inTrue", node.inTrue);
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `switch: inTrue, out: ${payloadDisplay}`
                    });
                    send({ payload: node.inTrue });
                } else if (msg.context === "inFalse" && !node.state) {
                    node.inFalse = msg.payload;
                    context.set("inFalse", node.inFalse);
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `switch: inFalse, out: ${payloadDisplay}`
                    });
                    send({ payload: node.inFalse });
                } else {
                    // Update inactive slot silently
                    if (msg.context === "inTrue") {
                        node.inTrue = msg.payload;
                        context.set("inTrue", node.inTrue);
                    } else {
                        node.inFalse = msg.payload;
                        context.set("inFalse", node.inFalse);
                    }
                }
                if (done) done();
                return;
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: "unknown context"
                });
                if (done) done();
                return;
            }
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });

        // Handle manual toggle via HTTP endpoint
        RED.httpAdmin.post("/boolean-switch-block/:id/toggle", RED.auth.needsPermission("boolean-switch-block.write"), function(req, res) {
            const node = RED.nodes.getNode(req.params.id);
            if (node && node.type === "boolean-switch-block") {
                node.state = !node.state;
                context.set("state", node.state);
                const activeSlot = node.state ? "inTrue" : "inFalse";
                const output = node.state ? node.inTrue : node.inFalse;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `switch: ${activeSlot}, out: ${output === null ? "null" : output}`
                });
                node.send({ payload: output });
                res.sendStatus(200);
            } else {
                res.sendStatus(404);
            }
        });
    }

    RED.nodes.registerType("boolean-switch-block", BooleanSwitchBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/boolean-switch-block-runtime/:id", RED.auth.needsPermission("boolean-switch-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "boolean-switch-block") {
            res.json({
                name: node.runtime.name,
                state: node.state
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};