module.exports = function(RED) {
    function InterpolateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "interpolate";
        try {
            node.points = config.points ? JSON.parse(config.points) : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            if (!Array.isArray(node.points) || node.points.length < 2 ||
                !node.points.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                        typeof p.y === "number" && !isNaN(p.y))) {
                node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                node.status({ fill: "red", shape: "ring", text: "invalid points" });
            }
        } catch (e) {
            node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            node.status({ fill: "red", shape: "ring", text: "invalid points" });
        }

        // Store last output value to check for changes
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.context) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                
                if (msg.context === "points") {
                    try {
                        const newPoints = Array.isArray(msg.payload) ? msg.payload : JSON.parse(msg.payload);
                        if (Array.isArray(newPoints) && newPoints.length >= 2 &&
                            newPoints.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                                typeof p.y === "number" && !isNaN(p.y))) {
                            node.points = newPoints;
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: `points: ${newPoints.length}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid points" });
                        }
                    } catch (e) {
                        node.status({ fill: "red", shape: "ring", text: "invalid points" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            if (typeof inputValue !== "number" || isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Linear interpolation
            let outputValue = NaN;
            const isPositiveSlope = node.points.length >= 2 && node.points[1].x > node.points[0].x;

            if (node.points.length >= 2) {
                for (let i = 0; i < node.points.length - 1; i++) {
                    let x1 = node.points[i].x, y1 = node.points[i].y;
                    let x2 = node.points[i + 1].x, y2 = node.points[i + 1].y;
                    if (isPositiveSlope ? (inputValue >= x1 && inputValue <= x2) : (inputValue <= x1 && inputValue >= x2)) {
                        let m = (y2 - y1) / (x2 - x1);
                        let b = y1 - (m * x1);
                        outputValue = (m * inputValue) + b;
                        break;
                    }
                }
            }

            if (isNaN(outputValue)) {
                node.status({ fill: "red", shape: "ring", text: "input out of range" });
                if (done) done();
                return;
            }

            // Check if output value has changed
            if (lastOutput !== outputValue) {
                lastOutput = outputValue;
                send({ payload: outputValue });

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
                });
            }

            if (done) done();
            return;
        });

        node.on("close", function(done) {
            // Reset points to config value on redeployment
            try {
                node.points = config.points ? JSON.parse(config.points) : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                if (!Array.isArray(node.points) || node.points.length < 2 ||
                    !node.points.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                            typeof p.y === "number" && !isNaN(p.y))) {
                    node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                }
            } catch (e) {
                node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            }
            // Clear status to prevent stale status after restart
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("interpolate-block", InterpolateBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/interpolate-block/:id", RED.auth.needsPermission("interpolate-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "interpolate-block") {
            res.json({
                name: node.name || "interpolate",
                points: node.points || [{ x: 0, y: 0 }, { x: 100, y: 100 }]
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};