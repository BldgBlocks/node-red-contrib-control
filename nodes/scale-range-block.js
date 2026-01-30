module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function ScaleRangeBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name || "";
        node.inputProperty = config.inputProperty || "payload";
        node.inMin = parseFloat(config.inMin);
        node.inMax = parseFloat(config.inMax);
        node.outMin = parseFloat(config.outMin);
        node.outMax = parseFloat(config.outMax);
        node.clamp = config.clamp;
        node.lastInput = parseFloat(config.inMin);

        // Validate initial config
        if (isNaN(node.inMin) || isNaN(node.inMax) || !isFinite(node.inMin) || !isFinite(node.inMax) || node.inMin >= node.inMax) {
            node.inMin = 0.0;
            node.inMax = 100.0;
            node.lastInput = 0.0;
            utils.setStatusError(node, "invalid input range");
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
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
                            utils.setStatusError(node, `invalid ${msg.context}`);
                            if (done) done();
                            return;
                        }
                        node[msg.context] = value;
                        if (node.inMax <= node.inMin) {
                            utils.setStatusError(node, "invalid input range");
                            if (done) done();
                            return;
                        }
                        if (node.outMax <= node.outMin) {
                            utils.setStatusError(node, "invalid output range");
                            if (done) done();
                            return;
                        }
                        utils.setStatusOK(node, `${msg.context}: ${value.toFixed(2)}`);
                        shouldOutput = true;
                        break;
                    case "clamp":
                        if (typeof msg.payload !== "boolean") {
                            utils.setStatusError(node, "invalid clamp");
                            if (done) done();
                            return;
                        }
                        node.clamp = msg.payload;
                        utils.setStatusOK(node, `clamp: ${node.clamp}`);
                        shouldOutput = true;
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        if (done) done("Unknown context");
                        return;
                }

                // Recalculate with last input after config update
                if (shouldOutput) {
                    const out = calculate(node.lastInput, node.inMin, node.inMax, node.outMin, node.outMax, node.clamp);
                    msg.payload = out;
                    utils.setStatusOK(node, `in: ${node.lastInput.toFixed(2)}, out: ${out.toFixed(2)}`);
                    send(msg);
                }
                if (done) done();
                return;
            }

            // Get input from configured property
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }
            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                utils.setStatusError(node, "invalid input");
                if (done) done();
                return;
            }
            if (node.inMax <= node.inMin) {
                utils.setStatusError(node, "inMinx must be < inMax");
                if (done) done();
                return;
            }

            // Scale input
            node.lastInput = inputValue;
            const out = calculate(inputValue, node.inMin, node.inMax, node.outMin, node.outMax, node.clamp);
            msg.payload = out;
            utils.setStatusOK(node, `in: ${inputValue.toFixed(2)}, out: ${out.toFixed(2)}`);
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