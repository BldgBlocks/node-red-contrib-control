module.exports = function(RED) {
    function NegateBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        node.name = config.name || "negate";

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            let outputValue;
            let statusText;

            if (typeof inputValue === 'number') {
                if (isNaN(inputValue)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input: NaN" });
                    if (done) done();
                    return;
                }
                outputValue = -inputValue;
                statusText = `in: ${inputValue.toFixed(2)}, out: ${outputValue.toFixed(2)}`;
            } else if (typeof inputValue === 'boolean') {
                outputValue = !inputValue;
                statusText = `in: ${inputValue}, out: ${outputValue}`;
            } else {
                let errorText;
                if (inputValue === null) {
                    errorText = "invalid input: null";
                } else if (Array.isArray(inputValue)) {
                    errorText = "invalid input: array";
                } else if (typeof inputValue === 'string') {
                    errorText = "invalid input: string";
                } else {
                    errorText = "invalid input type";
                }
                node.status({ fill: "red", shape: "ring", text: errorText });
                if (done) done();
                return;
            }

            msg.payload = outputValue;
            node.status({
                fill: "blue",
                shape: "dot",
                text: statusText
            });
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("negate-block", NegateBlockNode);
};