module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function BooleanToNumberBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime for editor display
        // Initialize state
        node.name = config.name;
        node.inputProperty = config.inputProperty || "payload";
        node.nullToZero = Boolean(config.nullToZero);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Check for missing input property
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

            // Validate and convert input
            const inputDisplay = inputValue === null ? "null" : String(inputValue);
            let outputValue;
            if (inputValue === null) {
                outputValue = node.nullToZero ? 0 : -1;
            } else if (typeof inputValue === "boolean") {
                outputValue = inputValue ? 1 : 0;
            } else if (typeof inputValue === "number" && (inputValue === 0 || inputValue === 1)) {
                outputValue = inputValue === 1;
            } else {
                utils.setStatusError(node, "invalid input type");
                if (done) done();
                return;
            }

            RED.util.setMessageProperty(msg, node.inputProperty, outputValue);
            utils.setStatusChanged(node, `${inputDisplay} -> ${outputValue}`);
            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("boolean-to-number-block", BooleanToNumberBlockNode);
};