module.exports = function(RED) {
    function RoundBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            inputProperty: config.inputProperty || "payload",
            precision: config.precision
        };

        // Validate initial config
        const validPrecisions = ["0.01", "0.1", "0.5", "1.0"];
        if (!validPrecisions.includes(node.runtime.precision)) {
            node.runtime.precision = "1.0";
            node.status({ fill: "red", shape: "ring", text: "invalid precision, using 1.0" });
        } else {
            node.status({ fill: "green", shape: "dot", text: `name: ${node.runtime.name || "round"}, precision: ${node.runtime.precision}` });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle precision configuration
            if (msg.hasOwnProperty("context") && msg.context === "precision") {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                const newPrecision = String(msg.payload);
                if (!validPrecisions.includes(newPrecision)) {
                    node.status({ fill: "red", shape: "ring", text: "invalid precision" });
                    if (done) done();
                    return;
                }
                node.runtime.precision = newPrecision;
                node.status({ fill: "green", shape: "dot", text: `precision: ${newPrecision}` });
                if (done) done();
                return;
            }

            // Passthrough: Process payload if numeric, else pass unchanged
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                node.status({ fill: "red", shape: "ring", text: "missing or invalid input property" });
                send(msg);
                if (done) done();
                return;
            }

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                send(msg);
                if (done) done();
                return;
            }

            // Round based on precision
            let result;
            const precision = parseFloat(node.runtime.precision);
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
            node.status({ fill: "blue", shape: "dot", text: `in: ${inputValue.toFixed(2)}, out: ${result}` });
            send(msg);
            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("round-block", RoundBlockNode);
};