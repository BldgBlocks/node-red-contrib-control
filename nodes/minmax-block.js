module.exports = function(RED) {
    function MinMaxBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
        };

        // Store last output value for status
        let lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Evaluate typed-inputs
            try {
                node.runtime.min = RED.util.evaluateNodeProperty(
                    config.min, config.minType, node, msg
                );

                node.runtime.max = RED.util.evaluateNodeProperty(
                    config.max, config.maxType, node, msg
                );
                

                // Validate min and max at startup
                if (isNaN(node.runtime.min) || isNaN(node.runtime.max) || node.runtime.min > node.runtime.max) {
                    node.status({ fill: "red", shape: "dot", text: `invalid min/max` });
                    if (done) done();
                    return;
                }
            } catch(err) {
                node.status({ fill: "red", shape: "ring", text: "error evaluating properties" });
                if (done) done(err);
                return;
            }

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
                    if (done) done();
                    return;
                }
                const value = parseFloat(msg.payload);
                if (isNaN(value) || value < 0) {
                    node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                    if (done) done();
                    return;
                }
                if (msg.context === "min") {
                    if (value < node.runtime.max) {
                        node.runtime.min = value;
                        node.status({ fill: "green", shape: "dot", text: `min: ${node.runtime.min}` });
                    } else {
                        node.status({ fill: "yellow", shape: "dot", text: `Context update aborted. Payload more than max` });
                    }
                } else if (msg.context === "max") {
                    if (value > node.runtime.max) {
                        node.runtime.max = value;
                        node.status({ fill: "green", shape: "dot", text: `max: ${node.runtime.max}` });
                    } else {
                        node.status({ fill: "yellow", shape: "dot", text: `Context update aborted. Payload less than min` });
                    }
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
                }
                if (done) done();
                return;
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            // Clamp input to [min, max]
            const outputValue = Math.min(Math.max(inputValue, node.runtime.min), node.runtime.max);

            // Update status and send output
            msg.payload = outputValue;
            node.status({
                fill: "blue",
                shape: lastOutput === outputValue ? "ring" : "dot",
                text: `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`
            });
            lastOutput = outputValue;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("minmax-block", MinMaxBlockNode);
};