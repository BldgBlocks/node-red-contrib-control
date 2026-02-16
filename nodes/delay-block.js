module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function DelayBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Unit multipliers (constant, computed once)
        const delayOnMultiplier = config.delayOnUnits === "seconds" ? 1000 : config.delayOnUnits === "minutes" ? 60000 : 1;
        const delayOffMultiplier = config.delayOffUnits === "seconds" ? 1000 : config.delayOffUnits === "minutes" ? 60000 : 1;

        // Initialize state
        node.name = config.name;
        node.state = false;
        node.desired = false;
        node.delayOn = parseFloat(config.delayOn) * delayOnMultiplier;
        node.delayOff = parseFloat(config.delayOff) * delayOffMultiplier;

        let timeoutId = null;
        let pendingDone = null;   // Track deferred done() for in-flight timers
        node.isBusy = false;

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };
            
            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }   

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.delayOnType) 
                        ? utils.evaluateNodeProperty(config.delayOn, config.delayOnType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(parseFloat(config.delayOn)),
                );
                
                evaluations.push(
                    utils.requiresEvaluation(config.delayOffType) 
                        ? utils.evaluateNodeProperty(config.delayOff, config.delayOffType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(parseFloat(config.delayOff)),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values (apply unit multiplier to raw config value)
                if (!isNaN(results[0])) node.delayOn = results[0] * delayOnMultiplier;
                if (!isNaN(results[1])) node.delayOff = results[1] * delayOffMultiplier;         
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Acceptable fallbacks
            if (isNaN(node.delayOn) || node.delayOn < 0) {
                node.delayOn = 1000;
                utils.setStatusError(node, "invalid delayOn");
            }
            if (isNaN(node.delayOff) || node.delayOff < 0) {
                node.delayOff = 1000;
                utils.setStatusError(node, "invalid delayOff");
            }

            if (msg.hasOwnProperty("context")) {
                if (msg.context === "reset") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload");
                        if (done) done();
                        return;
                    }
                    const boolVal = utils.validateBoolean(msg.payload);
                    if (!boolVal.valid) {
                        utils.setStatusError(node, boolVal.error);
                        if (done) done();
                        return;
                    }
                    if (boolVal.value === true) {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        // Complete any deferred done from a cancelled timer
                        if (pendingDone) {
                            pendingDone();
                            pendingDone = null;
                        }
                        node.state = false;
                        node.desired = false;
                        utils.setStatusOK(node, "reset");
                    }
                    if (done) done();
                    return;
                } else if (msg.context === "delayOn") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload for delayOn");
                        if (done) done();
                        return;
                    }
                    let newDelayOn = parseFloat(msg.payload);
                    const newDelayOnMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOn *= newDelayOnMultiplier;
                    if (isNaN(newDelayOn) || newDelayOn < 0) {
                        utils.setStatusError(node, "invalid delayOn");
                        if (done) done();
                        return;
                    }
                    node.delayOn = newDelayOn;
                    utils.setStatusOK(node, `delayOn: ${newDelayOn.toFixed(0)} ms`);
                    if (done) done();
                    return;
                } else if (msg.context === "delayOff") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload for delayOff");
                        if (done) done();
                        return;
                    }
                    let newDelayOff = parseFloat(msg.payload);
                    const newDelayOffMultiplier = msg.units === "seconds" ? 1000 : msg.units === "minutes" ? 60000 : 1;
                    newDelayOff *= newDelayOffMultiplier;
                    if (isNaN(newDelayOff) || newDelayOff < 0) {
                        utils.setStatusError(node, "invalid delayOff");
                        if (done) done();
                        return;
                    }
                    node.delayOff = newDelayOff;
                    utils.setStatusOK(node, `delayOff: ${newDelayOff.toFixed(0)} ms`);
                    if (done) done();
                    return;
                }
                utils.setStatusWarn(node, "unknown context");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            if (typeof inputValue !== "boolean") {
                utils.setStatusError(node, "invalid payload");
                if (done) done();
                return;
            }

            if (!node.state && inputValue === true) {
                if (node.desired) {
                    // Already awaiting true, ignore duplicate
                    if (done) done();
                    return;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                // Complete any prior deferred done before starting new timer
                if (pendingDone) {
                    pendingDone();
                    pendingDone = null;
                }
                utils.setStatusUnchanged(node, "awaiting true");
                node.desired = true;

                // Clone msg for the timer callback so we don't hold the original
                const delayedMsg = RED.util.cloneMessage(msg);
                // Defer done — this message isn't complete until the timer fires or is cancelled
                pendingDone = done;

                timeoutId = setTimeout(() => {
                    node.state = true;
                    delayedMsg.payload = true;
                    delete delayedMsg.context;
                    utils.setStatusChanged(node, "in: true, out: true");
                    send(delayedMsg);
                    timeoutId = null;
                    if (pendingDone) {
                        pendingDone();
                        pendingDone = null;
                    }
                }, node.delayOn);

                // Don't call done() here — it's deferred to the timer callback
                return;
            } else if (node.state && inputValue === false) {
                if (node.desired === false) {
                    // Already awaiting false, ignore duplicate
                    if (done) done();
                    return;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                // Complete any prior deferred done before starting new timer
                if (pendingDone) {
                    pendingDone();
                    pendingDone = null;
                }
                utils.setStatusUnchanged(node, "awaiting false");
                node.desired = false;

                // Clone msg for the timer callback so we don't hold the original
                const delayedMsg = RED.util.cloneMessage(msg);
                // Defer done — this message isn't complete until the timer fires or is cancelled
                pendingDone = done;

                timeoutId = setTimeout(() => {
                    node.state = false;
                    delayedMsg.payload = false;
                    delete delayedMsg.context;
                    utils.setStatusChanged(node, "in: false, out: false");
                    send(delayedMsg);
                    timeoutId = null;
                    if (pendingDone) {
                        pendingDone();
                        pendingDone = null;
                    }
                }, node.delayOff);

                // Don't call done() here — it's deferred to the timer callback
                return;
            } else {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                    // Complete deferred done from the cancelled timer's message
                    if (pendingDone) {
                        pendingDone();
                        pendingDone = null;
                    }
                    utils.setStatusUnchanged(node, `canceled awaiting ${node.state}`);
                } else {
                    utils.setStatusUnchanged(node, "no change");
                }
                
                // No state change, pass the message through
                node.state = inputValue;
                node.desired = inputValue;
                send(msg);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            // Complete any deferred done on shutdown
            if (pendingDone) {
                pendingDone();
                pendingDone = null;
            }
            done();
        });
    }

    RED.nodes.registerType("delay-block", DelayBlockNode);
};