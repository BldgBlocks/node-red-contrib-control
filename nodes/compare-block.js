module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function CompareBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.inputProperty = config.inputProperty || "payload";
        node.setpoint = Number(config.setpoint);

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
                    utils.setStatusError(node, "missing payload for setpoint");
                    if (done) done();
                    return;
                }

                if (msg.context === "setpoint") {
                    const numVal = utils.validateNumericPayload(msg.payload);
                    if (numVal.valid) {
                        node.setpoint = numVal.value;
                        utils.setStatusOK(node, `setpoint: ${numVal.value.toFixed(2)}`);
                    } else {
                        utils.setStatusError(node, "invalid setpoint");
                    }
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Get input from configured property
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                utils.setStatusError(node, "invalid input");
                if (done) done();
                return;
            }

            // Compare input to setpoint
            const greater = inputValue > node.setpoint;
            const equal = inputValue === node.setpoint;
            const less = inputValue < node.setpoint;
            const outputs = [
                { payload: greater },
                { payload: equal },
                { payload: less }
            ];

            utils.setStatusOK(node, `in: ${inputValue.toFixed(2)}, sp: ${node.setpoint.toFixed(2)}, out: [${greater}, ${equal}, ${less}]`);
            
            send(outputs);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("compare-block", CompareBlockNode);
};