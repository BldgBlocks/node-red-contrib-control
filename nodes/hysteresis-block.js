module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function HysteresisBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.state = "within";
        node.isBusy = false;
        node.upperLimit = parseFloat(config.upperLimit);
        node.lowerLimit = parseFloat(config.lowerLimit);
        node.upperLimitThreshold = parseFloat(config.upperLimitThreshold);
        node.lowerLimitThreshold = parseFloat(config.lowerLimitThreshold);

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.upperLimitType) 
                        ? utils.evaluateNodeProperty(config.upperLimit, config.upperLimitType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.upperLimit),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.lowerLimitType) 
                        ? utils.evaluateNodeProperty(config.lowerLimit, config.lowerLimitType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.lowerLimit),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.upperLimitThresholdType) 
                        ? utils.evaluateNodeProperty(config.upperLimitThreshold, config.upperLimitThresholdType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.upperLimitThreshold),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.lowerLimitThresholdType) 
                        ? utils.evaluateNodeProperty(config.lowerLimitThreshold, config.lowerLimitThresholdType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.lowerLimitThreshold),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.upperLimit = results[0];
                if (!isNaN(results[1])) node.lowerLimit = results[1];
                if (!isNaN(results[2])) node.upperLimitThreshold = results[2];
                if (!isNaN(results[3])) node.lowerLimitThreshold = results[3];
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
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
            const inputValue = parseFloat(RED.util.getMessageProperty(msg, node.inputProperty));
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
                node.status({ fill: "red", shape: "ring", text: "invalid limits calculation" });
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
