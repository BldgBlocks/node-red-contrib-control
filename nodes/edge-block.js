module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function EdgeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.algorithm = config.algorithm;
        node.lastValue = null;

        utils.setStatusOK(node, `name: ${node.name || "edge"}, algorithm: ${node.algorithm}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            const validAlgorithms = ["true-to-false", "false-to-true"];

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context") && typeof msg.context === "string") {
                if (msg.context === "algorithm") {
                    if (!msg.hasOwnProperty("payload")) {
                        utils.setStatusError(node, "missing payload");
                        if (done) done();
                        return;
                    }
                    const newAlgorithm = String(msg.payload);
                    if (!validAlgorithms.includes(newAlgorithm)) {
                        utils.setStatusError(node, "invalid algorithm");
                        if (done) done();
                        return;
                    }
                    node.algorithm = newAlgorithm;
                    utils.setStatusOK(node, `algorithm: ${newAlgorithm}`);
                    if (done) done();
                    return;
                }

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
                        node.lastValue = null;
                        utils.setStatusOK(node, "state reset");
                        if (done) done();
                        return;
                    }
                    if (done) done();
                    return;
                }
                // Ignore unknown context, process payload
            }

            // Get input from configured property
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (inputValue === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            if (typeof inputValue !== "boolean") {
                utils.setStatusError(node, "invalid input");
                if (done) done();
                return;
            }

            const currentValue = inputValue;
            const lastValue = node.lastValue;

            // Check for transition
            let isTransition = false;
            if (lastValue !== null && lastValue !== undefined) {
                if (node.algorithm === "true-to-false" && lastValue === true && currentValue === false) {
                    isTransition = true;
                } else if (node.algorithm === "false-to-true" && lastValue === false && currentValue === true) {
                    isTransition = true;
                }
            }

            if (isTransition) {
                utils.setStatusChanged(node, `in: ${currentValue}, out: true`);
                send({ payload: true });
            } else {
                utils.setStatusUnchanged(node, `in: ${currentValue}, out: none`);
            }

            node.lastValue = currentValue;
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("edge-block", EdgeBlockNode);
};