module.exports = function(RED) {
    function BooleanToNumberBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime for editor display
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            nullToZero: Boolean(config.nullToZero)
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Check for missing input property
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (inputValue === undefined) {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                if (done) done();
                return;
            }

            // Validate and convert input
            const inputDisplay = inputValue === null ? "null" : String(inputValue);
            if (inputValue === null) {
                msg.payload = node.runtime.nullToZero ? 0 : -1;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else if (typeof inputValue === "boolean") {
                msg.payload = inputValue ? 1 : 0;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else {
                node.status({ fill: "red", shape: "ring", text: "invalid input type" });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("boolean-to-number-block", BooleanToNumberBlockNode);
};