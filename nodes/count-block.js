module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CountBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            count: 0,
            prevState: false
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload for reset");
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        utils.setStatusError(node, "invalid reset");
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        node.runtime.count = 0;
                        node.runtime.prevState = false;
                        utils.setStatusOK(node, "state reset");
                        send({ payload: node.runtime.count });
                    }
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Get input value from configured property
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (typeof inputValue !== "boolean") {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            // Prevent integer overflow
            if (node.runtime.count > Number.MAX_SAFE_INTEGER - 100000) {
                node.runtime.count = 0;
                utils.setStatusWarn(node, "count overflow reset");
            }

            // Increment on false → true transition
            if (!node.runtime.prevState && inputValue === true) {
                node.runtime.count++;
                utils.setStatusChanged(node, `count: ${node.runtime.count}`);
                send({ payload: node.runtime.count });
            } else {
                utils.setStatusUnchanged(node, `count: ${node.runtime.count}`);
            }

            // Update prevState
            node.runtime.prevState = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("count-block", CountBlockNode);
};