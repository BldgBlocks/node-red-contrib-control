module.exports = function (RED) {
    function BooleanSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

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
            text: `state: ${node.state}, toggles: ${node.toggleCount}, inTrue: ${JSON.stringify(node.inTrue)}, inFalse: ${JSON.stringify(node.inFalse)}`
        });

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            let newState = node.state;
            let output = null;

            // Handle context updates
            if (msg.context === "inTrue") {
                if (msg.hasOwnProperty("payload")) {
                    node.inTrue = msg.payload;
                    context.set("inTrue", node.inTrue);
                    node.status({
                        fill: node.state ? "green" : "red",
                        shape: "dot",
                        text: `state: ${node.state}, toggles: ${node.toggleCount}, inTrue: ${JSON.stringify(node.inTrue)}, inFalse: ${JSON.stringify(node.inFalse)}`
                    });
                } else {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Missing payload for inTrue`
                    });
                }
                if (done) done();
                return;
            } else if (msg.context === "inFalse") {
                if (msg.hasOwnProperty("payload")) {
                    node.inFalse = msg.payload;
                    context.set("inFalse", node.inFalse);
                    node.status({
                        fill: node.state ? "green" : "red",
                        shape: "dot",
                        text: `state: ${node.state}, toggles: ${node.toggleCount}, inTrue: ${JSON.stringify(node.inTrue)}, inFalse: ${JSON.stringify(node.inFalse)}`
                    });
                } else {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: `Missing payload for inFalse`
                    });
                }
                if (done) done();
                return;
            }

            // Handle state changes
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
                    text: `Invalid input, State: ${node.state}, Toggles: ${node.toggleCount}`
                });
                if (done) done();
                return;
            }

            if (newState !== node.state) {
                node.state = newState;
                node.toggleCount++;
                context.set("state", node.state);
                context.set("toggleCount", node.toggleCount);
            }

            // Output based on state
            output = node.state ? node.inTrue : node.inFalse;
            node.status({
                fill: node.state ? "green" : "red",
                shape: "dot",
                text: `state: ${node.state}, toggles: ${node.toggleCount}, inTrue: ${JSON.stringify(node.inTrue)}, inFalse: ${JSON.stringify(node.inFalse)}`
            });

            if (output !== null && output !== undefined) {
                send({ payload: output });
            }

            if (done) done();
        });

        // Handle manual toggle via HTTP endpoint
        RED.httpAdmin.post("/boolean-switch-block/:id/toggle", RED.auth.needsPermission("boolean-switch-block.write"), function (req, res) {
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
                    text: `State: ${node.state}, Toggles: ${node.toggleCount}, inTrue: ${JSON.stringify(node.inTrue)}, inFalse: ${JSON.stringify(node.inFalse)}`
                });
                console.log(`Manual toggle boolean-switch-block node ${node.id}: state=${node.state}, toggles=${node.toggleCount}`);
                if (output !== null && output !== undefined) {
                    node.send({ payload: output });
                }
                res.sendStatus(200);
            } else {
                res.sendStatus(404);
            }
        });
    }

    RED.nodes.registerType("boolean-switch-block", BooleanSwitchBlockNode);
};