
module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function UnitsBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            unit: config.unit
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object" || !msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "invalid message");

                if (done) done();
                return;
            }

            try {
                // Process input
                let input;
                try {
                    input = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
                } catch (err) {
                    input = undefined;
                }
                if (input === undefined) {
                    utils.setStatusError(node, "missing or invalid input property");
                    if (done) done();
                    return;
                }
                
                const payloadPreview = input !== null ? (typeof input === "number" ? input.toFixed(2) : JSON.stringify(input).slice(0, 20)) : "none";

                utils.setStatusOK(node, `in: ${payloadPreview} unit: ${node.runtime.unit !== "" ? node.runtime.unit : "none"}`);

                msg.units = node.runtime.unit;
                send(msg);
                if (done) done();
            } catch (error) {
                utils.setStatusError(node, "processing error");

                if (done) done(error);
                return;
            }
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("units-block", UnitsBlockNode);
};