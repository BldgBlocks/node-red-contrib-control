module.exports = function(RED) {
    function ContextualLabelBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.contextPropertyName = config.contextPropertyName || "in1";
        node.removeLabel = config.removeLabel || false;

        node.status({
            fill: "green", 
            shape: "dot",
            text: `mode: ${node.removeLabel ? "remove" : "set"}, property: ${node.contextPropertyName}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn("Missing message");
                if (done) done();
                return;
            }

            // Set or remove context property
            if (node.removeLabel) {
                delete msg.context;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${msg.payload}, out: removed context`
                });
            } else {
                msg.context = node.contextPropertyName;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `in: ${msg.payload}, out: ${node.contextPropertyName}`
                });
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