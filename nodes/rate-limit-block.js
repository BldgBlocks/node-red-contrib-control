module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function RateLimitBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            mode: config.mode,
            rate: parseFloat(config.rate),
            interval: parseInt(config.interval),
            threshold: parseFloat(config.threshold),
            currentValue: 0,
            targetValue: 0,
            lastUpdate: Date.now(),
            lastInputMsg: null
        };

        // Validate initial config
        if (isNaN(node.runtime.rate) || node.runtime.rate <= 0 || !isFinite(node.runtime.rate)) {
            node.runtime.rate = 1.0;
            utils.setStatusError(node, "invalid rate");
        }
        if (isNaN(node.runtime.interval) || node.runtime.interval < 10 || !Number.isInteger(node.runtime.interval)) {
            node.runtime.interval = 100;
            utils.setStatusError(node, "invalid interval");
        }
        if (isNaN(node.runtime.threshold) || node.runtime.threshold < 0 || !isFinite(node.runtime.threshold)) {
            node.runtime.threshold = 5.0;
            utils.setStatusError(node, "invalid threshold");
        }
        if (!["rate-limit", "threshold", "full-value"].includes(node.runtime.mode)) {
            node.runtime.mode = "rate-limit";
            utils.setStatusError(node, "invalid mode");
        }

        // Set initial status
        utils.setStatusOK(node, `mode: ${node.runtime.mode}, out: ${node.runtime.currentValue.toFixed(2)}`);

        let updateTimer = null;

        // Function to update output for rate-limit mode
        function updateRateLimitOutput() {
            if (!node.runtime.lastInputMsg) return;
            const now = Date.now();
            const elapsed = (now - node.runtime.lastUpdate) / 1000; // Seconds
            const maxChange = node.runtime.rate * elapsed;
            let newValue = node.runtime.currentValue;

            if (node.runtime.currentValue < node.runtime.targetValue) {
                newValue = Math.min(node.runtime.currentValue + maxChange, node.runtime.targetValue);
            } else if (node.runtime.currentValue > node.runtime.targetValue) {
                newValue = Math.max(node.runtime.currentValue - maxChange, node.runtime.targetValue);
            }

            if (newValue !== node.runtime.currentValue) {
                node.runtime.currentValue = newValue;
                node.runtime.lastUpdate = now;
                const msg = RED.util.cloneMessage(node.runtime.lastInputMsg);
                msg.payload = node.runtime.currentValue;
                utils.setStatusOK(node, `mode: rate-limit, out: ${node.runtime.currentValue.toFixed(2)}`);
                node.send(msg);
            }
        }

        // Start update timer for rate-limit mode
        function startTimer() {
            if (updateTimer) clearInterval(updateTimer);
            if (node.runtime.mode === "rate-limit") {
                updateTimer = setInterval(updateRateLimitOutput, node.runtime.interval);
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
                        node.runtime.mode = msg.payload;
                        startTimer();
                        utils.setStatusOK(node, `mode: ${node.runtime.mode}`);
                        break;
                    case "rate":
                        const rate = parseFloat(msg.payload);
                        if (isNaN(rate) || rate <= 0 || !isFinite(rate)) {
                            utils.setStatusError(node, "invalid rate");
                            if (done) done();
                            return;
                        }
                        node.runtime.rate = rate;
                        utils.setStatusOK(node, `rate: ${node.runtime.rate.toFixed(2)}`);
                        break;
                    case "interval":
                        const interval = parseInt(msg.payload);
                        if (isNaN(interval) || interval < 10 || !Number.isInteger(interval)) {
                            utils.setStatusError(node, "invalid interval");
                            if (done) done();
                            return;
                        }
                        node.runtime.interval = interval;
                        startTimer();
                        utils.setStatusOK(node, `interval: ${node.runtime.interval}`);
                        break;
                    case "threshold":
                        const threshold = parseFloat(msg.payload);
                        if (isNaN(threshold) || threshold < 0 || !isFinite(threshold)) {
                            utils.setStatusError(node, "invalid threshold");
                            if (done) done();
                            return;
                        }
                        node.runtime.threshold = threshold;
                        utils.setStatusOK(node, `threshold: ${node.runtime.threshold.toFixed(2)}`);
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
            node.runtime.lastInputMsg = RED.util.cloneMessage(msg);

            if (node.runtime.mode === "rate-limit") {
                node.runtime.targetValue = inputValue;
                utils.setStatusOK(node, `mode: rate-limit, target: ${node.runtime.targetValue.toFixed(2)}`);
                updateRateLimitOutput();
                startTimer();
            } else if (node.runtime.mode === "threshold") {
                const diff = Math.abs(inputValue - node.runtime.currentValue);
                if (diff > node.runtime.threshold) {
                    msg.payload = inputValue;
                    node.runtime.currentValue = inputValue;
                    utils.setStatusChanged(node, `mode: threshold, out: ${node.runtime.currentValue.toFixed(2)}`);
                    send(msg);
                } else {
                    utils.setStatusUnchanged(node, `mode: threshold, out: ${node.runtime.currentValue.toFixed(2)}`);
                }
            } else if (node.runtime.mode === "full-value") {
                node.runtime.currentValue = inputValue;
                msg.payload = inputValue;
                utils.setStatusChanged(node, `mode: full-value, out: ${node.runtime.currentValue.toFixed(2)}`);
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