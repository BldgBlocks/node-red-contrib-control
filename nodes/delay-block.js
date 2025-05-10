module.exports = function(RED) {
    function DelayBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "delay";
        const delayOnMultiplier = config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1;
        const delayOffMultiplier = config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1;
        node.delayOn = (parseFloat(config.delayOn) || 1000) * delayOnMultiplier;
        node.delayOff = (parseFloat(config.delayOff) || 1000) * delayOffMultiplier;
        
        // Validate initial config
        if (isNaN(node.delayOn) || node.delayOn < 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid delayOn" });
            node.delayOn = 1000;
        }
        if (isNaN(node.delayOff) || node.delayOff < 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid delayOff" });
            node.delayOff = 1000;
        }

        // Initialize state
        let prevState = false;
        let timeoutId = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        prevState = false;
                        node.status({ fill: "green", shape: "dot", text: "reset" });
                    }
                    if (done) done();
                    return;
                } else if (msg.context === "delayOn") {
                    let newDelayOn = parseFloat(msg.payload);
                    const newDelayOnMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOn = newDelayOn * newDelayOnMultiplier;
                    if (isNaN(newDelayOn) || newDelayOn < 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid delayOn" });
                        if (done) done();
                        return;
                    }
                    node.delayOn = newDelayOn;
                    node.status({ fill: "green", shape: "dot", text: `delayOn: ${newDelayOn}` });
                    if (done) done();
                    return;
                } else if (msg.context === "delayOff") {
                    let newDelayOff = parseFloat(msg.payload);
                    const newDelayOffMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOff = newDelayOff * newDelayOffMultiplier;
                    if (isNaN(newDelayOff) || newDelayOff < 0) {
                        node.status({ fill: "red", shape: "ring", text: "invalid delayOff" });
                        if (done) done();
                        return;
                    }
                    node.delayOff = newDelayOff;
                    node.status({ fill: "green", shape: "dot", text: `delayOff: ${newDelayOff}` });
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
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }

            // Handle state transitions
            if (!prevState && inputValue === true) {
                prevState = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting true` });
                timeoutId = setTimeout(() => {
                    msg.payload = true;
                    node.status({ fill: "blue", shape: "dot", text: `out: true` });
                    send(msg);
                    timeoutId = null;
                }, node.delayOn);
            } else if (prevState && inputValue === false) {
                prevState = false;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting false` });
                timeoutId = setTimeout(() => {
                    msg.payload = false;
                    node.status({ fill: "blue", shape: "dot", text: `out: false` });
                    send(msg);
                    timeoutId = null;
                }, node.delayOff);
            } else {
                node.status({ fill: "blue", shape: "ring", text: `awaiting ${inputValue}` });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            prevState = false;
            node.delayOn = (parseFloat(config.delayOn) || 1000) * (config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1);
            node.delayOff = (parseFloat(config.delayOff) || 1000) * (config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1);
            if (isNaN(node.delayOn) || node.delayOn < 0) {
                node.delayOn = 1000;
            }
            if (isNaN(node.delayOff) || node.delayOff < 0) {
                node.delayOff = 1000;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("delay-block", DelayBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/delay-block/:id", RED.auth.needsPermission("delay-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "delay-block") {
            res.json({
                name: node.name || "delay",
                delayOn: node.delayOn || 1000,
                delayOff: node.delayOff || 1000
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};