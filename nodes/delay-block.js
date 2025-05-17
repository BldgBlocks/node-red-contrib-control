module.exports = function(RED) {
    function DelayBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.runtime = {
            name: config.name || "",
            delayOn: (parseFloat(config.delayOn) || 1000) * (config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1),
            delayOff: (parseFloat(config.delayOff) || 1000) * (config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1),
            state: false
        };

        if (isNaN(node.runtime.delayOn) || node.runtime.delayOn < 0) {
            node.runtime.delayOn = 1000;
            node.status({ fill: "red", shape: "ring", text: "invalid delayOn" });
        }
        if (isNaN(node.runtime.delayOff) || node.runtime.delayOff < 0) {
            node.runtime.delayOff = 1000;
            node.status({ fill: "red", shape: "ring", text: "invalid delayOff" });
        }

        let timeoutId = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            if (!msg) {
                if (done) done();
                return;
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
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting true` });
                timeoutId = setTimeout(() => {
                    node.runtime.state = true;
                    msg.payload = true;
                    delete msg.context;
                    node.status({ fill: "blue", shape: "dot", text: `in: true, out: true` });
                    send(msg);
                    timeoutId = null;
                }, node.runtime.delayOn);
            } else if (node.runtime.state && inputValue === false) {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                node.status({ fill: "blue", shape: "ring", text: `awaiting false` });
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
                    node.status({ fill: "blue", shape: "ring", text: `awaiting ${inputValue}` });
                }
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            node.runtime.state = false;
            node.runtime.delayOn = (parseFloat(config.delayOn) || 1000) * (config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1);
            node.runtime.delayOff = (parseFloat(config.delayOff) || 1000) * (config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1);
            if (isNaN(node.runtime.delayOn) || node.runtime.delayOn < 0) {
                node.runtime.delayOn = 1000;
            }
            if (isNaN(node.runtime.delayOff) || node.runtime.delayOff < 0) {
                node.runtime.delayOff = 1000;
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("delay-block", DelayBlockNode);

    RED.httpAdmin.get("/delay-block/:id", RED.auth.needsPermission("delay-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "delay-block") {
            res.json({
                name: node.runtime.name,
                delayOn: node.runtime.delayOn || 1000,
                delayOff: node.runtime.delayOff || 1000,
                state: node.runtime.state
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};