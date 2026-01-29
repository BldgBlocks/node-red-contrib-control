module.exports = function(RED) {
    function InterpolateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            points: null,
            lastOutput: null
        };

        // Initialize points
        try {
            node.runtime.points = config.points ? JSON.parse(config.points) : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            if (!Array.isArray(node.runtime.points) || node.runtime.points.length < 2 ||
                !node.runtime.points.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                                typeof p.y === "number" && !isNaN(p.y))) {
                node.runtime.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                node.status({ fill: "red", shape: "ring", text: "invalid points, using default" });
            } else {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `name: ${node.runtime.name}, points: ${node.runtime.points.length}`
                });
            }
        } catch (e) {
            node.runtime.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            node.status({ fill: "red", shape: "ring", text: "invalid points, using default" });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.context) {
                if (typeof msg.context !== "string" || !msg.context.trim()) {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
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
                            node.runtime.points = newPoints;
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

            // Check for missing input property
            let inputValue;
            try {
                inputValue = parseFloat(RED.util.getMessageProperty(msg, node.runtime.inputProperty));
            } catch (err) {
                inputValue = NaN;
            }
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                if (done) done();
                return;
            }

            // Linear interpolation
            let outputValue = NaN;
            const isPositiveSlope = node.runtime.points.length >= 2 && node.runtime.points[1].x > node.runtime.points[0].x;

            for (let i = 0; i < node.runtime.points.length - 1; i++) {
                let x1 = node.runtime.points[i].x, y1 = node.runtime.points[i].y;
                let x2 = node.runtime.points[i + 1].x, y2 = node.runtime.points[i + 1].y;
                if (isPositiveSlope ? (inputValue >= x1 && inputValue <= x2) : (inputValue <= x1 && inputValue >= x2)) {
                    let m = (y2 - y1) / (x2 - x1);
                    let b = y1 - (m * x1);
                    outputValue = (m * inputValue) + b;
                    break;
                }
            }

            if (isNaN(outputValue)) {
                node.status({ fill: "red", shape: "ring", text: "input out of range" });
                if (done) done();
                return;
            }

            // Check if output value has changed
            const isUnchanged = outputValue === node.runtime.lastOutput;
            node.status({
                fill: "blue",
                shape: isUnchanged ? "ring" : "dot",
                text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
            });

            if (!isUnchanged) {
                node.runtime.lastOutput = outputValue;
                send({ payload: outputValue });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("interpolate-block", InterpolateBlockNode);
};