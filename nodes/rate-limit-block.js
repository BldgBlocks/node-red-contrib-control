module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function RateLimitBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const isPositiveFinite = (value) => typeof value === "number" && isFinite(value) && value > 0;
        const hasValue = (value) => value !== undefined && value !== null && value !== "";

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.mode = config.mode;
        const legacyRate = parseFloat(config.rate);
        const configuredRateUp = parseFloat(config.rateUp);
        const configuredRateDown = parseFloat(config.rateDown);
        node.rateUp = isPositiveFinite(configuredRateUp) ? configuredRateUp : legacyRate;
        node.rateDown = isPositiveFinite(configuredRateDown) ? configuredRateDown : legacyRate;
        node.interval = parseInt(config.interval);
        node.threshold = parseFloat(config.threshold);
        node.currentValue = 0;
        node.targetValue = 0;
        node.lastUpdate = Date.now();
        node.lastInputMsg = null;

        // Validate initial config
        if (!isPositiveFinite(node.rateUp)) {
            node.rateUp = 1.0;
            if (hasValue(config.rateUp) || !isPositiveFinite(legacyRate)) {
                utils.setStatusError(node, "invalid rateUp");
            }
        }
        if (!isPositiveFinite(node.rateDown)) {
            node.rateDown = 1.0;
            if (hasValue(config.rateDown) || !isPositiveFinite(legacyRate)) {
                utils.setStatusError(node, "invalid rateDown");
            }
        }
        if (hasValue(config.rate) && !isPositiveFinite(legacyRate)) {
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
        function setRateLimitStatus(prefix) {
            const details = `cur:${node.currentValue.toFixed(2)} target:${node.targetValue.toFixed(2)} up:${node.rateUp.toFixed(2)} down:${node.rateDown.toFixed(2)}`;
            utils.setStatusOK(node, prefix ? `${prefix} ${details}` : details);
        }

        if (node.mode === "rate-limit") {
            setRateLimitStatus();
        } else {
            utils.setStatusOK(node, `${node.currentValue.toFixed(2)}`);
        }

        let updateTimer = null;

        // Function to update output for rate-limit mode
        function updateRateLimitOutput() {
            if (!node.lastInputMsg) return;
            const now = Date.now();
            const elapsed = (now - node.lastUpdate) / 1000; // Seconds
            const isRising = node.currentValue < node.targetValue;
            const activeRate = isRising ? node.rateUp : node.rateDown;
            const maxChange = activeRate * elapsed;
            let newValue = node.currentValue;

            if (isRising) {
                newValue = Math.min(node.currentValue + maxChange, node.targetValue);
            } else if (node.currentValue > node.targetValue) {
                newValue = Math.max(node.currentValue - maxChange, node.targetValue);
            }

            if (newValue !== node.currentValue) {
                node.currentValue = newValue;
                node.lastUpdate = now;
                const msg = RED.util.cloneMessage(node.lastInputMsg);
                msg.payload = node.currentValue;
                setRateLimitStatus();
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
                        if (node.mode === "rate-limit") {
                            setRateLimitStatus("mode:rate-limit");
                        } else {
                            utils.setStatusOK(node, `mode: ${node.mode}`);
                        }
                        break;
                    case "rate":
                        const rate = parseFloat(msg.payload);
                        if (!isPositiveFinite(rate)) {
                            utils.setStatusError(node, "invalid rate");
                            if (done) done();
                            return;
                        }
                        node.rateUp = rate;
                        node.rateDown = rate;
                        if (node.mode === "rate-limit") {
                            setRateLimitStatus("rate up/down updated");
                        } else {
                            utils.setStatusOK(node, `rate up/down: ${rate.toFixed(2)}`);
                        }
                        break;
                    case "rateUp":
                        const rateUp = parseFloat(msg.payload);
                        if (!isPositiveFinite(rateUp)) {
                            utils.setStatusError(node, "invalid rateUp");
                            if (done) done();
                            return;
                        }
                        node.rateUp = rateUp;
                        if (node.mode === "rate-limit") {
                            setRateLimitStatus("rateUp updated");
                        } else {
                            utils.setStatusOK(node, `rateUp: ${node.rateUp.toFixed(2)}`);
                        }
                        break;
                    case "rateDown":
                        const rateDown = parseFloat(msg.payload);
                        if (!isPositiveFinite(rateDown)) {
                            utils.setStatusError(node, "invalid rateDown");
                            if (done) done();
                            return;
                        }
                        node.rateDown = rateDown;
                        if (node.mode === "rate-limit") {
                            setRateLimitStatus("rateDown updated");
                        } else {
                            utils.setStatusOK(node, `rateDown: ${node.rateDown.toFixed(2)}`);
                        }
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
                setRateLimitStatus("target updated");
                updateRateLimitOutput();
                startTimer();
            } else if (node.mode === "threshold") {
                const diff = Math.abs(inputValue - node.currentValue);
                if (diff > node.threshold) {
                    msg.payload = inputValue;
                    node.currentValue = inputValue;
                    utils.setStatusChanged(node, `${node.currentValue.toFixed(2)}`);
                    send(msg);
                } else {
                    utils.setStatusUnchanged(node, `${node.currentValue.toFixed(2)}`);
                }
            } else if (node.mode === "full-value") {
                node.currentValue = inputValue;
                msg.payload = inputValue;
                utils.setStatusChanged(node, `${node.currentValue.toFixed(2)}`);
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