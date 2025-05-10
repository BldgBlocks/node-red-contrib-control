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
                                        typeof p.y === "number" && !isNaN(p.y)) ||
                !node.points.slice(1).every((p, i) => p.x > node.points[i].x)) {
                node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                node.status({ fill: "red", shape: "ring", text: "invalid points" });
            }
        } catch (e) {
            node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            node.status({ fill: "red", shape: "ring", text: "invalid points" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
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
                                                typeof p.y === "number" && !isNaN(p.y)) &&
                            newPoints.slice(1).every((p, i) => p.x > newPoints[i].x)) {
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

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Linear interpolation
            let outputValue = NaN;
            if (node.points.length >= 2) {
                for (let i = 0; i < node.points.length - 1; i++) {
                    let x1 = node.points[i].x, y1 = node.points[i].y;
                    let x2 = node.points[i + 1].x, y2 = node.points[i + 1].y;
                    if (inputValue >= x1 && inputValue <= x2) {
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

            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
            });
            send({ payload: outputValue });

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset points to config value on redeployment
            try {
                node.points = config.points ? JSON.parse(config.points) : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                if (!Array.isArray(node.points) || node.points.length < 2 ||
                    !node.points.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                            typeof p.y === "number" && !isNaN(p.y)) ||
                    !node.points.slice(1).every((p, i) => p.x > node.points[i].x)) {
                    node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                }
            } catch (e) {
                node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            }
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