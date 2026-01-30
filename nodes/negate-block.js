module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NegateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize state
        node.inputProperty = config.inputProperty || "payload";
        node.lastOutput = null;

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "missing message");
                if (done) done();
                return;
            }

            // Get input value from the specified property
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

            let outputValue;
            let statusText;

            if (typeof inputValue === "number") {
                if (isNaN(inputValue)) {
                    utils.setStatusError(node, "invalid input: NaN");
                    if (done) done();
                    return;
                }
                outputValue = -inputValue;
                statusText = `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`;
            } else if (typeof inputValue === "boolean") {
                outputValue = !inputValue;
                statusText = `in: ${inputValue}, out: ${outputValue}`;
            } else {
                utils.setStatusError(node, "Unsupported type");
                if (done) done();
                return;
            }

            // Check for unchanged output
            const isUnchanged = outputValue === node.lastOutput;
            if (isUnchanged) {
                utils.setStatusUnchanged(node, statusText);
            } else {
                utils.setStatusChanged(node, statusText);
            }

            node.lastOutput = outputValue;
            msg.payload = outputValue;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("negate-block", NegateBlockNode);
};