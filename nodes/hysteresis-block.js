module.exports = function(RED) {
    function HysteresisBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        node.state = "within";

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate all properties
            try {
                node.upperLimit = RED.util.evaluateNodeProperty(
                    config.upperLimit, config.upperLimitType, node, msg
                );
                node.lowerLimit = RED.util.evaluateNodeProperty(
                    config.lowerLimit, config.lowerLimitType, node, msg
                );
                node.upperLimitThreshold = RED.util.evaluateNodeProperty(
                    config.upperLimitThreshold, config.upperLimitThresholdType, node, msg
                );
                node.lowerLimitThreshold = RED.util.evaluateNodeProperty(
                    config.lowerLimitThreshold, config.lowerLimitThresholdType, node, msg
                );
                
                // Validate values
                if (isNaN(node.upperLimit) || isNaN(node.lowerLimit) || 
                    isNaN(node.upperLimitThreshold) || isNaN(node.lowerLimitThreshold) ||
                    node.upperLimit <= node.lowerLimit ||
                    node.upperLimitThreshold < 0 || node.lowerLimitThreshold < 0) {
                    node.status({ fill: "red", shape: "ring", text: "invalid evaluated values" });
                    if (done) done();
                    return;
                }
            } catch(err) {
                node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
                if (done) done(err);
                return;
            }

            if (msg.hasOwnProperty("context")) {
                if (msg.context === "upperLimitThreshold") {
                    const value = parseFloat(msg.payload);
                    if (!isNaN(value) && value >= 0) {
                        node.upperLimitThreshold = value;
                        node.status({ fill: "green", shape: "dot", text: `upperLimitThreshold: ${value}` });
                    }
                } else if (msg.context === "lowerLimitThreshold") {
                    const value = parseFloat(msg.payload);
                    if (!isNaN(value) && value >= 0) {
                        node.lowerLimitThreshold = value;
                        node.status({ fill: "green", shape: "dot", text: `lowerLimitThreshold: ${value}` });
                    }
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            // Calculate all boundary points - ensure numeric values
            const upperTurnOn = node.upperLimit;
            const upperTurnOff = node.upperLimit - node.upperLimitThreshold;
            const lowerTurnOn = node.lowerLimit;
            const lowerTurnOff = node.lowerLimit + node.lowerLimitThreshold;

            // Add validation to ensure numbers
            if (isNaN(upperTurnOn) || isNaN(upperTurnOff) || isNaN(lowerTurnOn) || isNaN(lowerTurnOff)) {
                node.status({ fill: "red", shape: "ring", text: "invalid boundary calculation" });
                if (done) done();
                return;
            }
            // Apply comprehensive hysteresis logic
            let newState = node.state;

            switch (node.state) {
                case "above":
                    if (inputValue <= upperTurnOff) {
                        newState = "within";
                        if (inputValue <= lowerTurnOn) {
                            newState = "below"; 
                        }
                    }
                    break;
                case "below":
                    if (inputValue >= lowerTurnOff) {
                        newState = "within";
                        if (inputValue >= upperTurnOn) {
                            newState = "above";
                        }
                    }
                    break;
                case "within":
                    if (inputValue >= upperTurnOn) {
                        newState = "above";
                    } else if (inputValue <= lowerTurnOn) {
                        newState = "below";
                    }
                    break;
                }

            const output = [
                { payload: newState === "above" },
                { payload: newState === "within" },
                { payload: newState === "below" }
            ];

            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inputValue.toFixed(2)}, state: ${newState}`
            });

            node.state = newState;
            send(output);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("hysteresis-block", HysteresisBlockNode);
};
