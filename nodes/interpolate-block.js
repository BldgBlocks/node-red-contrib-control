module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function InterpolateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.points = null;
        node.lastOutput = null;

        // Initialize points
        try {
            node.points = config.points ? JSON.parse(config.points) : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            if (!Array.isArray(node.points) || node.points.length < 2 ||
                !node.points.every(p => typeof p.x === "number" && !isNaN(p.x) &&
                                                typeof p.y === "number" && !isNaN(p.y))) {
                node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
                utils.setStatusError(node, "invalid points, using default");
            } else {
                utils.setStatusOK(node, `name: ${node.name}, points: ${node.points.length}`);
            }
        } catch (e) {
            node.points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
            utils.setStatusError(node, "invalid points, using default");
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.context) {
                if (typeof msg.context !== "string" || !msg.context.trim()) {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
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
                            utils.setStatusOK(node, `points: ${newPoints.length}`);
                        } else {
                            utils.setStatusError(node, "invalid points");
                        }
                    } catch (e) {
                        utils.setStatusError(node, "invalid points");
                    }
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
            }

            // Check for missing input property
            let inputValue;
            try {
                inputValue = parseFloat(RED.util.getMessageProperty(msg, node.inputProperty));
            } catch (err) {
                inputValue = NaN;
            }
            if (isNaN(inputValue)) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            // Linear interpolation
            let outputValue = NaN;
            const isPositiveSlope = node.points.length >= 2 && node.points[1].x > node.points[0].x;

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

            if (isNaN(outputValue)) {
                utils.setStatusError(node, "input out of range");
                if (done) done();
                return;
            }

            // Check if output value has changed
            const isUnchanged = outputValue === node.lastOutput;
            const statusShape = isUnchanged ? "ring" : "dot";
            utils.setStatusOK(node, `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`);
            if (statusShape === "ring") utils.setStatusUnchanged(node, `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`);

            if (!isUnchanged) {
                node.lastOutput = outputValue;
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