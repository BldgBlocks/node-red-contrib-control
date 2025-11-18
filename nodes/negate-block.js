module.exports = function(RED) {
    function NegateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize runtime state
        node.runtime = {
            name: config.name,
            lastOutput: null
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                if (done) done();
                return;
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            let outputValue;
            let statusText;

            if (typeof inputValue === "number") {
                if (isNaN(inputValue)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input: NaN" });
                    if (done) done();
                    return;
                }
                outputValue = -inputValue;
                statusText = `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`;
            } else if (typeof inputValue === "boolean") {
                outputValue = !inputValue;
                statusText = `in: ${inputValue}, out: ${outputValue}`;
            } else {
                node.status({ fill: "red", shape: "ring", text: "Unsupported type" });
                if (done) done();
                return;
            }

            // Check for unchanged output
            const isUnchanged = outputValue === node.runtime.lastOutput;
            node.status({
                fill: "blue",
                shape: isUnchanged ? "ring" : "dot",
                text: statusText
            });

            node.runtime.lastOutput = outputValue;
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