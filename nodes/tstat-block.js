module.exports = function(RED) {
    const utils = require('./utils')(RED);
    
    function TstatBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        // Store typed-input properties
        node.name = config.name;
        node.setpoint = parseFloat(config.setpoint);
        node.heatingSetpoint = parseFloat(config.heatingSetpoint);
        node.coolingSetpoint = parseFloat(config.coolingSetpoint);
        node.coolingOn = parseFloat(config.coolingOn);
        node.coolingOff = parseFloat(config.coolingOff);
        node.heatingOff = parseFloat(config.heatingOff);
        node.heatingOn = parseFloat(config.heatingOn);
        node.diff = parseFloat(config.diff);
        node.anticipator = parseFloat(config.anticipator);
        node.ignoreAnticipatorCycles = Math.floor(config.ignoreAnticipatorCycles);
        node.isHeating = config.isHeating === true;
        node.algorithm = config.algorithm;

        let above = false;
        let below = false;
        let lastAbove = false;
        let lastBelow = false;
        let lastIsHeating = null;
        let cyclesSinceModeChange = 0;
        let modeChanged = false;

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
                
                //0
                evaluations.push(
                    utils.requiresEvaluation(config.setpointType) 
                        ? utils.evaluateNodeProperty(config.setpoint, config.setpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.setpoint),
                );
                //1
                evaluations.push(
                    utils.requiresEvaluation(config.heatingSetpointType) 
                        ? utils.evaluateNodeProperty(config.heatingSetpoint, config.heatingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.heatingSetpoint),
                );
                //2
                evaluations.push(
                    utils.requiresEvaluation(config.coolingSetpointType) 
                        ? utils.evaluateNodeProperty(config.coolingSetpoint, config.coolingSetpointType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.coolingSetpoint),
                );
                //3
                evaluations.push(
                    utils.requiresEvaluation(config.coolingOnType) 
                        ? utils.evaluateNodeProperty(config.coolingOn, config.coolingOnType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.coolingOn),
                );
                //4
                evaluations.push(
                    utils.requiresEvaluation(config.coolingOffType) 
                        ? utils.evaluateNodeProperty(config.coolingOff, config.coolingOffType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.coolingOff),
                );
                //5
                evaluations.push(
                    utils.requiresEvaluation(config.heatingOffType) 
                        ? utils.evaluateNodeProperty(config.heatingOff, config.heatingOffType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.heatingOff),
                );
                //6
                evaluations.push(
                    utils.requiresEvaluation(config.heatingOnType) 
                        ? utils.evaluateNodeProperty(config.heatingOn, config.heatingOnType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.heatingOn),
                );
                //7
                evaluations.push(
                    utils.requiresEvaluation(config.diffType) 
                        ? utils.evaluateNodeProperty(config.diff, config.diffType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.diff),
                );
                //8
                evaluations.push(
                    utils.requiresEvaluation(config.anticipatorType) 
                        ? utils.evaluateNodeProperty(config.anticipator, config.anticipatorType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.anticipator),
                );
                //9
                evaluations.push(
                    utils.requiresEvaluation(config.ignoreAnticipatorCyclesType)
                        ? utils.evaluateNodeProperty(config.ignoreAnticipatorCycles, config.ignoreAnticipatorCyclesType, node, msg)
                            .then(val => Math.floor(val))
                        : Promise.resolve(node.ignoreAnticipatorCycles),
                );
                //10
                evaluations.push(
                    utils.requiresEvaluation(config.isHeatingType)
                        ? utils.evaluateNodeProperty(config.isHeating, config.isHeatingType, node, msg)
                            .then(val => val === true)
                        : Promise.resolve(node.isHeating),
                );
                //11
                evaluations.push(
                    utils.requiresEvaluation(config.algorithmType)
                        ? utils.evaluateNodeProperty(config.algorithm, config.algorithmType, node, msg)
                        : Promise.resolve(node.algorithm),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.setpoint = results[0];
                if (!isNaN(results[1])) node.heatingSetpoint = results[1];
                if (!isNaN(results[2])) node.coolingSetpoint = results[2];
                if (!isNaN(results[3])) node.coolingOn = results[3];
                if (!isNaN(results[4])) node.coolingOff = results[4];
                if (!isNaN(results[5])) node.heatingOff = results[5];
                if (!isNaN(results[6])) node.heatingOn = results[6];
                if (!isNaN(results[7])) node.diff = results[7];
                if (!isNaN(results[8])) node.anticipator = results[8];
                if (!isNaN(results[9])) node.ignoreAnticipatorCycles = results[9];
                if (results[10] !== null) node.isHeating = results[10];
                if (results[11]) node.algorithm = results[11];
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
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
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            const input = parseFloat(msg.payload);
            if (isNaN(input)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
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
            let delta = 0;
            let hiValue = 0;
            let loValue = 0;
            let hiOffValue = 0;
            let loOffValue = 0;
            let activeHeatingSetpoint = 0;
            let activeCoolingSetpoint = 0;

            // Main thermostat logic
            // The Tstat node does not control heating/cooling mode, only operates heating or cooling according to the mode set and respective setpoints.
            if (node.algorithm === "single") {
                // Note:
                // Make sure your mode selection is handled upstream and does not osciallate modes.
                // This was changed to allow for broader anticipator authority, or even negative (overshoot) so duty cycle can be better managed.
                // So the same setpoint can be used year round and maintain tight control. 
                // Alternatively, you would need a larger diff value to prevent oscillation.
                delta = node.diff / 2;
                hiValue = node.setpoint + delta;
                loValue = node.setpoint - delta;
                hiOffValue = node.setpoint + effectiveAnticipator;
                loOffValue = node.setpoint - effectiveAnticipator;
                activeHeatingSetpoint = node.setpoint;
                activeCoolingSetpoint = node.setpoint;

                if (isHeating) {
                    if (input < loValue) {
                        below = true;
                    } else if (below && input > loOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < hiOffValue) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "split") {
                    activeHeatingSetpoint = node.heatingSetpoint;
                    activeCoolingSetpoint = node.coolingSetpoint;
                if (node.isHeating) {
                    delta = node.diff / 2;
                    loValue = node.heatingSetpoint - delta;
                    loOffValue = node.heatingSetpoint - effectiveAnticipator;

                    if (input < loValue) {
                        below = true;
                    } else if (below && input > loOffValue) {
                        below = false;
                    }
                    above = false;
                } else {
                    delta = node.diff / 2;
                    hiValue = node.coolingSetpoint + delta;
                    hiOffValue = node.coolingSetpoint + effectiveAnticipator;

                    if (input > hiValue) {
                        above = true;
                    } else if (above && input < hiOffValue) {
                        above = false;
                    }
                    below = false;
                }
            } else if (node.algorithm === "specified") {
                activeHeatingSetpoint = node.heatingOn;
                activeCoolingSetpoint = node.coolingOn;
                if (node.isHeating) {
                    if (input < node.heatingOn) {
                        below = true;
                    } else if (below && input > node.heatingOff - effectiveAnticipator) {
                        below = false;
                    }
                    above = false;
                } else {
                    if (input > node.coolingOn) {
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
            statusInfo.activeHeatingSetpoint = activeHeatingSetpoint;
            statusInfo.activeCoolingSetpoint = activeCoolingSetpoint;
            statusInfo.diff = node.diff;
            statusInfo.anticipator = node.anticipator;
            statusInfo.loValue = loValue;
            statusInfo.hiValue = hiValue;
            statusInfo.loOffValue = loOffValue;
            statusInfo.hiOffValue = hiOffValue;

            if (node.algorithm === "single") {
                statusInfo.setpoint = node.setpoint;
            } else if (node.algorithm === "split") {
                statusInfo.heatingSetpoint = node.heatingSetpoint;
                statusInfo.coolingSetpoint = node.coolingSetpoint;
            } else {
                statusInfo.hiValue = node.coolingOn;
                statusInfo.hiOffValue = node.coolingOff;
                statusInfo.loOffValue = node.heatingOff;
                statusInfo.loValue = node.heatingOn;
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
