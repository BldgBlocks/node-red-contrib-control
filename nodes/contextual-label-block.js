module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.contextPropertyName = config.contextPropertyName || "in1";
        node.removeLabel = config.removeLabel || false;

        utils.setStatusOK(node, `mode: ${node.removeLabel ? "remove" : "set"}, property: ${node.contextPropertyName}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "missing message");
                node.warn("Missing message");
                if (done) done();
                return;
            }

            // Set or remove context property
            if (node.removeLabel) {
                delete msg.context;
                utils.setStatusChanged(node, `in: ${msg.payload}, out: removed context`);
            } else {
                msg.context = node.contextPropertyName;
                utils.setStatusChanged(node, `in: ${msg.payload}, out: ${node.contextPropertyName}`);
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