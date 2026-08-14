module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.contextPropertyName = config.contextPropertyName || "in1";
        node.inputProperty = config.inputProperty || "payload";
        node.removeLabel = config.removeLabel || false;

        utils.setStatusOK(node, node.removeLabel ? "remove" : `set -> ${node.contextPropertyName}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "missing message");
                node.warn("Missing message");
                if (done) done();
                return;
            }

            const inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            if (inputValue === undefined) {
                utils.setStatusError(node, `missing ${node.inputProperty}`);
                if (done) done();
                return;
            }
            msg.payload = inputValue;

            utils.setStatusChanged(node, node.removeLabel ? "remove" : `set -> ${node.contextPropertyName}`);

            // Set or remove context property
            if (node.removeLabel) {
                delete msg.context;
            }

            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("contextual-label-block", ContextualLabelBlockNode);
};