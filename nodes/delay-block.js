module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function DelayBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.runtime = {
            name: config.name,
            state: false,
            desired: false
        };

        const typedProperties = ['delayOn', 'delayOff'];

        // Evaluate typed-input properties    
        try {   
            const evaluatedValues = utils.evaluateProperties(node, config, typedProperties, null, true);
            node.runtime.delayOn = (parseFloat(evaluatedValues.delayOn)) * (config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1);
            node.runtime.delayOff = (parseFloat(evaluatedValues.delayOff)) * (config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1);
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
        }

        let timeoutId = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            if (!msg) {
                if (done) done();
                return;
            }    

            // Update typed-input properties if needed
            try {   
                const evaluatedValues = utils.evaluateProperties(node, config, typedProperties, msg);
                node.runtime.delayOn = parseFloat(evaluatedValues.delayOn) * (config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1);
                node.runtime.delayOff = parseFloat(evaluatedValues.delayOff) * (config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1);
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            }

            // Acceptable fallbacks
            if (isNaN(node.runtime.delayOn) || node.runtime.delayOn < 0) {
                node.runtime.delayOn = 1000;
                node.status({ fill: "red", shape: "ring", text: "invalid delayOn" });
            }
            if (isNaN(node.runtime.delayOff) || node.runtime.delayOff < 0) {
                node.runtime.delayOff = 1000;
                node.status({ fill: "red", shape: "ring", text: "invalid delayOff" });
            }

            if (msg.hasOwnProperty("context")) {
                if (msg.context === "reset") {
                    if (!msg.hasOwnProperty("payload") || typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        node.runtime.state = false;
                        node.status({ fill: "green", shape: "dot", text: "reset" });
                    }
                    if (done) done();
                    return;
                } else if (msg.context === "delayOn") {
                    if (!msg.hasOwnProperty("payload")) {
                        node.status({ fill: "red", shape: "ring", text: "missing payload for delayOn" });
                        if (done) done();
                        return;
                    }
                    let newDelayOn = parseFloat(msg.payload);
                    const newDelayOnMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOn *= newDelayOnMultiplier;
                    if (isNaN(newDelayOn) || newDelayOn < 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid delayOn" });
                        if (done) done();
                        return;
                    }
                    node.runtime.delayOn = newDelayOn;
                    node.status({ fill: "green", shape: "dot", text: `delayOn: ${newDelayOn.toFixed(0)} ms` });
                    if (done) done();
                    return;
                } else if (msg.context === "delayOff") {
                    if (!msg.hasOwnProperty("payload")) {
                        node.status({ fill: "red", shape: "ring", text: "missing payload for delayOff" });
                        if (done) done();
                        return;
                    }
                    let newDelayOff = parseFloat(msg.payload);
                    const newDelayOffMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOff *= newDelayOffMultiplier;
                    if (isNaN(newDelayOff) || newDelayOff < 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid delayOff" });
                        if (done) done();
                        return;
                    }
                    node.runtime.delayOff = newDelayOff;
                    node.status({ fill: "green", shape: "dot", text: `delayOff: ${newDelayOff.toFixed(0)} ms` });
                    if (done) done();
                    return;
                }
                node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            if (!node.runtime.state && inputValue === true) {
                if (node.runtime.desired) {
                    if (done) done();
                    return;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting true` });
                node.runtime.desired = true;
                timeoutId = setTimeout(() => {
                    node.runtime.state = true;
                    msg.payload = true;
                    delete msg.context;
                    node.status({ fill: "blue", shape: "dot", text: `in: true, out: true` });
                    send(msg);
                    timeoutId = null;
                }, node.runtime.delayOn);
            } else if (node.runtime.state && inputValue === false) {
                if (node.runtime.desired === false) {
                    if (done) done();
                    return;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting false` });
                node.runtime.desired = false;
                timeoutId = setTimeout(() => {
                    node.runtime.state = false;
                    msg.payload = false;
                    delete msg.context;
                    node.status({ fill: "blue", shape: "dot", text: `in: false, out: false` });
                    send(msg);
                    timeoutId = null;
                }, node.runtime.delayOff);
            } else {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                    node.status({ fill: "blue", shape: "ring", text: `canceled awaiting ${node.runtime.state}` });
                } else {
                    node.status({ fill: "blue", shape: "ring", text: `no change` });
                }
                
                // No state change, pass the message through
                node.runtime.state = inputValue;
                desired = inputValue;
                send(msg);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            done();
        });
    }

    RED.nodes.registerType("delay-block", DelayBlockNode);
};