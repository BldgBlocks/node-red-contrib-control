module.exports = function(RED) {
    const utils = require('./utils')(RED);
    
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Store typed-input properties
        node.isHeating = config.isHeating;
        node.algorithm = config.algorithm;
        node.name = config.name;

        // Evaluate typed-input properties    
        try {            
            node.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node ));
            node.heatingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.heatingSetpoint, config.heatingSetpointType, node ));
            node.coolingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.coolingSetpoint, config.coolingSetpointType, node ));
            node.coolingOn = parseFloat(RED.util.evaluateNodeProperty( config.coolingOn, config.coolingOnType, node ));
            node.coolingOff = parseFloat(RED.util.evaluateNodeProperty( config.coolingOff, config.coolingOffType, node ));
            node.heatingOff = parseFloat(RED.util.evaluateNodeProperty( config.heatingOff, config.heatingOffType, node ));
            node.heatingOn = parseFloat(RED.util.evaluateNodeProperty( config.heatingOn, config.heatingOnType, node ));
            node.diff = parseFloat(RED.util.evaluateNodeProperty( config.diff, config.diffType, node ));
            node.anticipator = parseFloat(RED.util.evaluateNodeProperty( config.anticipator, config.anticipatorType, node ));
            node.ignoreAnticipatorCycles = Math.floor(RED.util.evaluateNodeProperty( config.ignoreAnticipatorCycles, config.ignoreAnticipatorCyclesType, node ));        
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
        }

        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;
        let lastIsHeating = null;
        let cyclesSinceModeChange = 0;
        let modeChanged = false;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }
            
            // Update typed-input properties if needed
            try {      
                if (utils.requiresEvaluation(config.setpointType)) {
                    node.setpoint = parseFloat(RED.util.evaluateNodeProperty( config.setpoint, config.setpointType, node, msg ));                    
                }
                if (utils.requiresEvaluation(config.heatingSetpointType)) {
                    node.heatingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.heatingSetpoint, config.heatingSetpointType, node, msg ));                    
                }
                if (utils.requiresEvaluation(config.coolingSetpointType)) {
                    node.coolingSetpoint = parseFloat(RED.util.evaluateNodeProperty( config.coolingSetpoint, config.coolingSetpointType, node, msg ));                    
                }
                if (utils.requiresEvaluation(config.coolingOnType)) {
                    node.coolingOn = parseFloat(RED.util.evaluateNodeProperty( config.coolingOn, config.coolingOnType, node, msg ));
                }
                if (utils.requiresEvaluation(config.coolingOffType)) {
                    node.coolingOff = parseFloat(RED.util.evaluateNodeProperty( config.coolingOff, config.coolingOffType, node, msg ));
                }
                if (utils.requiresEvaluation(config.heatingOffType)) {
                    node.heatingOff = parseFloat(RED.util.evaluateNodeProperty( config.heatingOff, config.heatingOffType, node, msg ));
                }
                if (utils.requiresEvaluation(config.heatingOnType)) {
                    node.heatingOn = parseFloat(RED.util.evaluateNodeProperty( config.heatingOn, config.heatingOnType, node, msg ));
                }
                if (utils.requiresEvaluation(config.diffType)) {
                    node.diff = parseFloat(RED.util.evaluateNodeProperty( config.diff, config.diffType, node, msg ));
                }
                if (utils.requiresEvaluation(config.anticipatorType)) {
                    node.anticipator = parseFloat(RED.util.evaluateNodeProperty( config.anticipator, config.anticipatorType, node, msg ));
                }
                if (utils.requiresEvaluation(config.ignoreAnticipatorCyclesType)) {
                    node.ignoreAnticipatorCycles = Math.floor(RED.util.evaluateNodeProperty( config.ignoreAnticipatorCycles, config.ignoreAnticipatorCyclesType, node, msg ));
                }
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                switch (msg.context) {
                    case "algorithm":
                        if (["single", "split", "specified"].includes(msg.payload)) {
                            node.algorithm = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `algorithm: ${msg.payload}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid algorithm" });
                        }
                        break;
                    case "setpoint":
                        if (typeof msg.payload === 'number') {
                            node.setpoint = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `setpoint: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                        }
                        break;
                    case "heatingSetpoint":
                        if (typeof msg.payload === 'number') {
                            node.heatingSetpoint = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `heatingSetpoint: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingSetpoint" });
                        }
                        break;
                    case "coolingSetpoint":
                        if (typeof msg.payload === 'number') {
                            node.coolingSetpoint = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `coolingSetpoint: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingSetpoint" });
                        }
                        break;
                    case "coolingOn":
                        if (typeof msg.payload === 'number') {
                            node.coolingOn = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `coolingOn: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOn" });
                        }
                        break;
                    case "coolingOff":
                        if (typeof msg.payload === 'number') {
                            node.coolingOff = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `coolingOff: ${msg.payload.toFixed(2)}`
                            });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid coolingOff" });
                        }
                        break;
                    case "heatingOff":
                        if (typeof msg.payload === 'number') {
                            node.heatingOff = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `heatingOff: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOff" });
                        }
                        break;
                    case "heatingOn":
                        if (typeof msg.payload === 'number') {
                            node.heatingOn = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `heatingOn: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid heatingOn" });
                        }
                        break;
                    case "diff":
                        if (typeof msg.payload === 'number' && msg.payload >= 0.01) {
                            node.diff = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `diff: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid diff" });
                        }
                        break;
                    case "anticipator":
                        if (typeof msg.payload === 'number' && msg.payload >= -2) {
                            node.anticipator = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `anticipator: ${msg.payload.toFixed(2)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid anticipator" });
                        }
                        break;
                    case "ignoreAnticipatorCycles":
                        if (typeof msg.payload === 'number' && msg.payload >= 0) {
                            node.ignoreAnticipatorCycles = Math.floor(msg.payload);
                            node.status({ fill: "green", shape: "dot", text: `ignoreAnticipatorCycles: ${Math.floor(msg.payload)}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid ignoreAnticipatorCycles" });
                        }
                        break;
                    case "isHeating":
                        if (typeof msg.payload === "boolean") {
                            node.isHeating = msg.payload;
                            node.status({ fill: "green", shape: "dot", text: `isHeating: ${msg.payload}` });
                        } else {
                            node.status({ fill: "red", shape: "ring", text: "invalid isHeating" });
                        }
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        break;
                }
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            const isHeating = msg.hasOwnProperty("isHeating") && typeof msg.isHeating === "boolean" ? msg.isHeating : node.isHeating;
            if (msg.hasOwnProperty("isHeating") && typeof msg.isHeating !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid isHeating (must be boolean)" });
                if (done) done();
                return;
            }

            // Handle mode changes and anticipator logic
            if (lastIsHeating !== null && node.isHeating !== lastIsHeating) {
                modeChanged = true;
                cyclesSinceModeChange = 0;
            }
            lastIsHeating = node.isHeating;   
            if ((below && !lastBelow) || (above && !lastAbove)) {
                cyclesSinceModeChange++;
            }

            let effectiveAnticipator = node.anticipator;
            if (modeChanged && node.ignoreAnticipatorCycles > 0 && cyclesSinceModeChange <= node.ignoreAnticipatorCycles) {
                effectiveAnticipator = 0;
            }
            if (cyclesSinceModeChange > node.ignoreAnticipatorCycles) {
                modeChanged = false;
            }

            lastAbove = above;
            lastBelow = below;

            // Main thermostat logic
            if (node.algorithm === "single") {
                const delta = node.diff / 2;
                const hiValue = node.setpoint + delta;
                const loValue = node.setpoint - delta;
                const hiOffValue = node.setpoint + effectiveAnticipator;
                const loOffValue = node.setpoint - effectiveAnticipator;

                if (input > hiValue) {
                    above = true;
                    below = false;
                } else if (input < loValue) {
                    above = false;
                    below = true;
                } else if (above && input < hiOffValue) {
                    above = false;
                } else if (below && input > loOffValue) {
                    below = false;
                }
            } else if (node.algorithm === "split") {
                if (node.isHeating) {
                    const delta = node.diff / 2;
                    const loValue = node.heatingSetpoint - delta;
                    const loOffValue = node.heatingSetpoint - effectiveAnticipator;

                    if (input < loValue) {
                        below = true;
                    } else if (below && input > loOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    const delta = node.diff / 2;
                    const hiValue = node.coolingSetpoint + delta;
                    const hiOffValue = node.coolingSetpoint + effectiveAnticipator;

                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < hiOffValue) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "specified") {
                if (node.isHeating) {
                    if (input < node.heatingOn) {
                        below = true;
                    } else if (below && input > node.heatingOff - effectiveAnticipator) {
                        below = false;
                    }
                    above = false;
                } else {
                    if (input > coolingOn) {
                        above = true;
                    } else if (above && input < node.coolingOff + effectiveAnticipator) {
                        above = false;
                    }
                    below = false;
                }
            }
            
            // Add status information to every output message
            const statusInfo = {
                algorithm: node.algorithm,
                input: input,
                isHeating: node.isHeating,
                above: above,
                below: below,
                modeChanged: modeChanged,
                cyclesSinceModeChange: cyclesSinceModeChange,
                effectiveAnticipator: effectiveAnticipator
            };

            // Add algorithm-specific status
            if (node.algorithm === "single") {
                statusInfo.setpoint = node.setpoint;
                statusInfo.diff = node.diff;
                statusInfo.anticipator = node.anticipator;
            } else if (node.algorithm === "split") {
                statusInfo.heatingSetpoint = node.heatingSetpoint;
                statusInfo.coolingSetpoint = node.coolingSetpoint;
                statusInfo.diff = node.diff;
                statusInfo.anticipator = node.anticipator;
            } else {
                statusInfo.coolingOn = node.coolingOn;
                statusInfo.coolingOff = node.coolingOff;
                statusInfo.heatingOff = node.heatingOff;
                statusInfo.heatingOn = node.heatingOn;
                statusInfo.anticipator = node.anticipator;
            }

            // Create outputs with status information
            const outputs = [
                { 
                    payload: node.isHeating, 
                    context: "isHeating",
                    status: statusInfo
                },
                { 
                    payload: above,
                    status: statusInfo
                },
                { 
                    payload: below,
                    status: statusInfo
                }
            ];

            send(outputs);

            if (above === lastAbove && below === lastBelow) {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `in: ${input.toFixed(2)}, out: ${node.isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            } else {
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${input.toFixed(2)}, out: ${node.isHeating ? "heating" : "cooling"}, above: ${above}, below: ${below}`
                });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("tstat-block", TstatBlockNode);
};
