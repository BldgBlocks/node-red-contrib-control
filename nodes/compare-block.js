module.exports = function(RED) {
    function CompareBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.inputProperty = config.inputProperty || "payload";
        node.setpoint = Number(config.setpoint);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload for setpoint" });
                    if (done) done();
                    return;
                }

                if (msg.context === "setpoint") {
                    const setpointValue = parseFloat(msg.payload);
                    if (!isNaN(setpointValue) && isFinite(setpointValue)) {
                        node.setpoint = setpointValue;
                        node.status({ fill: "green", shape: "dot", text: `setpoint: ${setpointValue.toFixed(2)}` });
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "invalid setpoint" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Get input from configured property
            const input = RED.util.getMessageProperty(msg, node.inputProperty);
            if (input === undefined) {
                node.status({ fill: "red", shape: "ring", text: "missing input property" });
                if (done) done();
                return;
            }

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
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

            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inputValue.toFixed(2)}, sp: ${node.setpoint.toFixed(2)}, out: [${greater}, ${equal}, ${less}]`
            });
            
            send(outputs);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("compare-block", CompareBlockNode);
};