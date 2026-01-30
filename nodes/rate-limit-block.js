module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function RateLimitBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.mode = config.mode;
        node.rate = parseFloat(config.rate);
        node.interval = parseInt(config.interval);
        node.threshold = parseFloat(config.threshold);
        node.currentValue = 0;
        node.targetValue = 0;
        node.lastUpdate = Date.now();
        node.lastInputMsg = null;

        // Validate initial config
        if (isNaN(node.rate) || node.rate <= 0 || !isFinite(node.rate)) {
            node.rate = 1.0;
            utils.setStatusError(node, "invalid rate");
        }
        if (isNaN(node.interval) || node.interval < 10 || !Number.isInteger(node.interval)) {
            node.interval = 100;
            utils.setStatusError(node, "invalid interval");
        }
        if (isNaN(node.threshold) || node.threshold < 0 || !isFinite(node.threshold)) {
            node.threshold = 5.0;
            utils.setStatusError(node, "invalid threshold");
        }
        if (!["rate-limit", "threshold", "full-value"].includes(node.mode)) {
            node.mode = "rate-limit";
            utils.setStatusError(node, "invalid mode");
        }

        // Set initial status
        utils.setStatusOK(node, `mode: ${node.mode}, out: ${node.currentValue.toFixed(2)}`);

        let updateTimer = null;

        // Function to update output for rate-limit mode
        function updateRateLimitOutput() {
            if (!node.lastInputMsg) return;
            const now = Date.now();
            const elapsed = (now - node.lastUpdate) / 1000; // Seconds
            const maxChange = node.rate * elapsed;
            let newValue = node.currentValue;

            if (node.currentValue < node.targetValue) {
                newValue = Math.min(node.currentValue + maxChange, node.targetValue);
            } else if (node.currentValue > node.targetValue) {
                newValue = Math.max(node.currentValue - maxChange, node.targetValue);
            }

            if (newValue !== node.currentValue) {
                node.currentValue = newValue;
                node.lastUpdate = now;
                const msg = RED.util.cloneMessage(node.lastInputMsg);
                msg.payload = node.currentValue;
                utils.setStatusOK(node, `mode: rate-limit, out: ${node.currentValue.toFixed(2)}`);
                node.send(msg);
            }
        }

        // Start update timer for rate-limit mode
        function startTimer() {
            if (updateTimer) clearInterval(updateTimer);
            if (node.mode === "rate-limit") {
                updateTimer = setInterval(updateRateLimitOutput, node.interval);
            }
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
                switch (msg.context) {
                    case "mode":
                        if (!["rate-limit", "threshold", "full-value"].includes(msg.payload)) {
                            utils.setStatusError(node, "invalid mode");
                            if (done) done();
                            return;
                        }
                        node.mode = msg.payload;
                        startTimer();
                        utils.setStatusOK(node, `mode: ${node.mode}`);
                        break;
                    case "rate":
                        const rate = parseFloat(msg.payload);
                        if (isNaN(rate) || rate <= 0 || !isFinite(rate)) {
                            utils.setStatusError(node, "invalid rate");
                            if (done) done();
                            return;
                        }
                        node.rate = rate;
                        utils.setStatusOK(node, `rate: ${node.rate.toFixed(2)}`);
                        break;
                    case "interval":
                        const interval = parseInt(msg.payload);
                        if (isNaN(interval) || interval < 10 || !Number.isInteger(interval)) {
                            utils.setStatusError(node, "invalid interval");
                            if (done) done();
                            return;
                        }
                        node.interval = interval;
                        startTimer();
                        utils.setStatusOK(node, `interval: ${node.interval}`);
                        break;
                    case "threshold":
                        const threshold = parseFloat(msg.payload);
                        if (isNaN(threshold) || threshold < 0 || !isFinite(threshold)) {
                            utils.setStatusError(node, "invalid threshold");
                            if (done) done();
                            return;
                        }
                        node.threshold = threshold;
                        utils.setStatusOK(node, `threshold: ${node.threshold.toFixed(2)}`);
                        break;
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        if (done) done("Unknown context");
                        return;
                }
                if (done) done();
                return;
            }

            // Validate input
            if (typeof msg.payload !== "number" || isNaN(msg.payload) || !isFinite(msg.payload)) {
                utils.setStatusError(node, "invalid input");
                if (done) done();
                return;
            }

            const inputValue = msg.payload;
            node.lastInputMsg = RED.util.cloneMessage(msg);

            if (node.mode === "rate-limit") {
                node.targetValue = inputValue;
                utils.setStatusOK(node, `mode: rate-limit, target: ${node.targetValue.toFixed(2)}`);
                updateRateLimitOutput();
                startTimer();
            } else if (node.mode === "threshold") {
                const diff = Math.abs(inputValue - node.currentValue);
                if (diff > node.threshold) {
                    msg.payload = inputValue;
                    node.currentValue = inputValue;
                    utils.setStatusChanged(node, `mode: threshold, out: ${node.currentValue.toFixed(2)}`);
                    send(msg);
                } else {
                    utils.setStatusUnchanged(node, `mode: threshold, out: ${node.currentValue.toFixed(2)}`);
                }
            } else if (node.mode === "full-value") {
                node.currentValue = inputValue;
                msg.payload = inputValue;
                utils.setStatusChanged(node, `mode: full-value, out: ${node.currentValue.toFixed(2)}`);
                send(msg);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (updateTimer) clearInterval(updateTimer);
            updateTimer = null;
            done();
        });
    }

    RED.nodes.registerType("rate-limit-block", RateLimitBlockNode);
};