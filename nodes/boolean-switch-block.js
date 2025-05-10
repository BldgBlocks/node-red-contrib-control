module.exports = function(RED) {
    function BooleanSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize properties from config
        node.name = config.name || "boolean switch";

        // Initialize state and slots
        node.state = context.get("state") || false;
        node.toggleCount = context.get("toggleCount") || 0;
        node.inTrue = context.get("inTrue") !== undefined ? context.get("inTrue") : null;
        node.inFalse = context.get("inFalse") !== undefined ? context.get("inFalse") : null;
        context.set("state", node.state);
        context.set("toggleCount", node.toggleCount);
        context.set("inTrue", node.inTrue);
        context.set("inFalse", node.inFalse);

        // Set initial status
        node.status({
            fill: node.state ? "green" : "red",
            shape: "dot",
            text: `state: ${node.state}, out: ${node.state ? node.inTrue : node.inFalse}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `missing payload for ${msg.context}`
                    });
                    if (done) done();
                    return;
                }
                if (msg.context === "inTrue") {
                    node.inTrue = msg.payload;
                    context.set("inTrue", node.inTrue);
                    if (node.state) {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `state: true, out: ${typeof node.inTrue === "number" ? node.inTrue.toFixed(2) : node.inTrue}`
                        });
                        send({ payload: node.inTrue });
                    } else {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: `state: false, out: ${typeof node.inFalse === "number" ? node.inFalse.toFixed(2) : node.inFalse}`
                        });
                    }
                    if (done) done();
                    return;
                } else if (msg.context === "inFalse") {
                    node.inFalse = msg.payload;
                    context.set("inFalse", node.inFalse);
                    if (!node.state) {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: `state: false, out: ${typeof node.inFalse === "number" ? node.inFalse.toFixed(2) : node.inFalse}`
                        });
                        send({ payload: node.inFalse });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `state: true, out: ${typeof node.inTrue === "number" ? node.inTrue.toFixed(2) : node.inTrue}`
                        });
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
            }

            // Handle state changes
            let newState = node.state;
            if (msg.payload === "toggle") {
                newState = !node.state;
            } else if (msg.payload === true || msg.payload === "true") {
                newState = true;
            } else if (msg.payload === false || msg.payload === "false") {
                newState = false;
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `invalid input`
                });
                if (done) done();
                return;
            }

            if (newState !== node.state) {
                node.state = newState;
                node.toggleCount++;
                context.set("state", node.state);
                context.set("toggleCount", node.toggleCount);
                const output = node.state ? node.inTrue : node.inFalse;
                node.status({
                    fill: node.state ? "green" : "red",
                    shape: "dot",
                    text: `state: ${node.state}, out: ${typeof output === "number" ? output.toFixed(2) : output}`
                });
                send({ payload: output });
            }

            if (done) done();
        });

        // Handle manual toggle via HTTP endpoint
        RED.httpAdmin.post("/boolean-switch-block/:id/toggle", RED.auth.needsPermission("boolean-switch-block.write"), function(req, res) {
            const node = RED.nodes.getNode(req.params.id);
            if (node && node.type === "boolean-switch-block") {
                node.state = !node.state;
                node.toggleCount++;
                node.context().set("state", node.state);
                node.context().set("toggleCount", node.toggleCount);
                const output = node.state ? node.inTrue : node.inFalse;
                node.status({
                    fill: node.state ? "green" : "red",
                    shape: "dot",
                    text: `state: ${node.state}, out: ${typeof output === "number" ? output.toFixed(2) : output}`
                });
                console.log(`Manual toggle boolean switch node ${node.id} (${node.name}): state=${node.state}, toggles=${node.toggleCount}`);
                send({ payload: output });
                res.sendStatus(200);
            } else {
                res.sendStatus(404);
            }
        });
    }

    RED.nodes.registerType("boolean-switch-block", BooleanSwitchBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/boolean-switch-block/:id", RED.auth.needsPermission("boolean-switch-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "boolean-switch-block") {
            res.json({
                name: node.name || "boolean switch",
                state: node.state || false,
                toggleCount: node.toggleCount || 0,
                inTrue: node.inTrue !== undefined ? node.inTrue : null,
                inFalse: node.inFalse !== undefined ? node.inFalse : null
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};