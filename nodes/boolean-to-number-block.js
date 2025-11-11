module.exports = function(RED) {
    function BooleanToNumberBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime for editor display
        node.runtime = {
            name: config.name,
            nullToZero: Boolean(config.nullToZero)
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            // Validate and convert payload
            const inputDisplay = msg.payload === null ? "null" : String(msg.payload);
            if (msg.payload === null) {
                msg.payload = node.runtime.nullToZero ? 0 : -1;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else if (typeof msg.payload === "boolean") {
                msg.payload = msg.payload ? 1 : 0;
                node.status({ fill: "blue", shape: "dot", text: `in: ${inputDisplay}, out: ${msg.payload}` });
                send(msg);
            } else {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("boolean-to-number-block", BooleanToNumberBlockNode);
};