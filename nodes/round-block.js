module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function RoundBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize state
        node.inputProperty = config.inputProperty || "payload";
        node.precision = config.precision;

        // Validate initial config
        const validPrecisions = ["0.01", "0.1", "0.5", "1.0"];
        if (!validPrecisions.includes(node.precision)) {
            node.precision = "1.0";
            utils.setStatusError(node, "invalid precision, using 1.0");
        } else {
            utils.setStatusOK(node, `name: ${config.name || "round"}, precision: ${node.precision}`);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle precision configuration
            if (msg.hasOwnProperty("context") && msg.context === "precision") {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }
                const newPrecision = String(msg.payload);
                if (!validPrecisions.includes(newPrecision)) {
                    utils.setStatusError(node, "invalid precision");
                    if (done) done();
                    return;
                }
                node.precision = newPrecision;
                utils.setStatusOK(node, `precision: ${newPrecision}`);
                if (done) done();
                return;
            }

            // Passthrough: Process payload if numeric, else pass unchanged
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                send(msg);
                if (done) done();
                return;
            }

            const numVal = utils.validateNumericPayload(input);
            if (!numVal.valid) {
                utils.setStatusError(node, numVal.error);
                send(msg);
                if (done) done();
                return;
            }
            const inputValue = numVal.value;

            // Round based on precision
            let result;
            const precision = parseFloat(node.precision);
            if (precision === 0.01) {
                result = Math.round(inputValue * 100) / 100;
            } else if (precision === 0.1) {
                result = Math.round(inputValue * 10) / 10;
            } else if (precision === 0.5) {
                result = Math.round(inputValue / 0.5) * 0.5;
            } else {
                result = Math.round(inputValue);
            }

            msg.payload = result;
            utils.setStatusOK(node, `in: ${inputValue.toFixed(2)}, out: ${result}`);
            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("round-block", RoundBlockNode);
};