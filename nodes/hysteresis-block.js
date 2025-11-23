module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function HysteresisBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        node.state = "within";

        // Evaluate typed-input properties    
        try {      
            node.upperLimit = parseFloat(RED.util.evaluateNodeProperty( config.upperLimit, config.upperLimitType, node ));
            node.lowerLimit = parseFloat(RED.util.evaluateNodeProperty( config.lowerLimit, config.lowerLimitType, node ));
            node.upperLimitThreshold = parseFloat(RED.util.evaluateNodeProperty( config.upperLimitThreshold, config.upperLimitThresholdType, node ));
            node.lowerLimitThreshold = parseFloat(RED.util.evaluateNodeProperty( config.lowerLimitThreshold, config.lowerLimitThresholdType, node ));
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }
            
            // Update typed-input properties if needed
            try {           
                if (utils.requiresEvaluation(config.upperLimitType)) {
                    node.upperLimit = parseFloat(RED.util.evaluateNodeProperty( config.upperLimit, config.upperLimitType, node, msg ));
                }
                if (utils.requiresEvaluation(config.lowerLimitType)) {
                    node.lowerLimit = parseFloat(RED.util.evaluateNodeProperty( config.lowerLimit, config.lowerLimitType, node, msg ));
                }
                if (utils.requiresEvaluation(config.upperLimitThresholdType)) {
                    node.upperLimitThreshold = parseFloat(RED.util.evaluateNodeProperty( config.upperLimitThreshold, config.upperLimitThresholdType, node, msg ));
                }
                if (utils.requiresEvaluation(config.lowerLimitThresholdType)) {
                    node.lowerLimitThreshold = parseFloat(RED.util.evaluateNodeProperty( config.lowerLimitThreshold, config.lowerLimitThresholdType, node, msg ));
                }
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
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
