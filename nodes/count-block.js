module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CountBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.count = 0;
        node.prevState = false;

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
                    const boolVal = utils.validateBoolean(msg.payload);
                    if (!boolVal.valid) {
                        utils.setStatusError(node, boolVal.error);
                        if (done) done();
                        return;
                    }
                    if (boolVal.value === true) {
                        node.count = 0;
                        node.prevState = false;
                        utils.setStatusOK(node, "state reset");
                        send({ payload: node.count });
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
                inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (typeof inputValue !== "boolean") {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            // Prevent integer overflow
            if (node.count > Number.MAX_SAFE_INTEGER - 100000) {
                node.count = 0;
                utils.setStatusWarn(node, "count overflow reset");
            }

            // Increment on false → true transition
            if (!node.prevState && inputValue === true) {
                node.count++;
                utils.setStatusChanged(node, `count: ${node.count}`);
                send({ payload: node.count });
            } else {
                utils.setStatusUnchanged(node, `count: ${node.count}`);
            }

            // Update prevState
            node.prevState = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("count-block", CountBlockNode);
};