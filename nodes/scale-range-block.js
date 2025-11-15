module.exports = function(RED) {
    function ScaleRangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            inMin: parseFloat(config.inMin),
            inMax: parseFloat(config.inMax),
            outMin: parseFloat(config.outMin),
            outMax: parseFloat(config.outMax),
            clamp: config.clamp,
            lastInput: parseFloat(config.inMin)
        };

        // Validate initial config
        if (isNaN(node.runtime.inMin) || isNaN(node.runtime.inMax) || !isFinite(node.runtime.inMin) || !isFinite(node.runtime.inMax) || node.runtime.inMin >= node.runtime.inMax) {
            node.runtime.inMin = 0.0;
            node.runtime.inMax = 100.0;
            node.runtime.lastInput = 0.0;
            node.status({ fill: "red", shape: "ring", text: "invalid input range" });
        }

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
                    node.status({ fill: "red", shape: "ring", text: `missing payload for ${msg.context}` });
                    if (done) done();
                    return;
                }

                let shouldOutput = false;
                switch (msg.context) {
                    case "inMin":
                    case "inMax":
                    case "outMin":
                    case "outMax":
                        const value = parseFloat(msg.payload);
                        if (isNaN(value) || !isFinite(value)) {
                            node.status({ fill: "red", shape: "ring", text: `invalid ${msg.context}` });
                            if (done) done();
                            return;
                        }
                        node.runtime[msg.context] = value;
                        if (node.runtime.inMax <= node.runtime.inMin) {
                            node.status({ fill: "red", shape: "ring", text: "invalid input range" });
                            if (done) done();
                            return;
                        }
                        if (node.runtime.outMax <= node.runtime.outMin) {
                            node.status({ fill: "red", shape: "ring", text: "invalid output range" });
                            if (done) done();
                            return;
                        }
                        node.status({ fill: "green", shape: "dot", text: `${msg.context}: ${value.toFixed(2)}` });
                        shouldOutput = true;
                        break;
                    case "clamp":
                        if (typeof msg.payload !== "boolean") {
                            node.status({ fill: "red", shape: "ring", text: "invalid clamp" });
                            if (done) done();
                            return;
                        }
                        node.runtime.clamp = msg.payload;
                        node.status({ fill: "green", shape: "dot", text: `clamp: ${node.runtime.clamp}` });
                        shouldOutput = true;
                        break;
                    default:
                        node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                        if (done) done("Unknown context");
                        return;
                }

                // Recalculate with last input after config update
                if (shouldOutput) {
                    const out = calculate(node.runtime.lastInput, node.runtime.inMin, node.runtime.inMax, node.runtime.outMin, node.runtime.outMax, node.runtime.clamp);
                    msg.payload = out;
                    node.status({ fill: "blue", shape: "dot", text: `in: ${node.runtime.lastInput.toFixed(2)}, out: ${out.toFixed(2)}` });
                    send(msg);
                }
                if (done) done();
                return;
            }

            // Validate input
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing input" });
                if (done) done();
                return;
            }
            const inputValue = parseFloat(msg.payload);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                node.status({ fill: "red", shape: "ring", text: "invalid input" });
                if (done) done();
                return;
            }
            if (node.runtime.inMax <= node.runtime.inMin) {
                node.status({ fill: "red", shape: "ring", text: "inMinx must be < inMax" });
                if (done) done();
                return;
            }

            // Scale input
            node.runtime.lastInput = inputValue;
            const out = calculate(inputValue, node.runtime.inMin, node.runtime.inMax, node.runtime.outMin, node.runtime.outMax, node.runtime.clamp);
            msg.payload = out;
            node.status({ fill: "blue", shape: "dot", text: `in: ${inputValue.toFixed(2)}, out: ${out.toFixed(2)}` });
            send(msg);

            if (done) done();
        });

        // Scaling function
        function calculate(input, inMin, inMax, outMin, outMax, clamp) {
            const scaleRatio = (outMax - outMin) / (inMax - inMin);
            let output = scaleRatio * (input - inMin) + outMin;
            return clamp ? Math.max(outMin, Math.min(outMax, output)) : output;
        }

        node.on("close", function(done) { 
            done();
        });
    }

    RED.nodes.registerType("scale-range-block", ScaleRangeBlockNode); 
};