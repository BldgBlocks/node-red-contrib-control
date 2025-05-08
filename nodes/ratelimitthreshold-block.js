module.exports = function (RED) {
    function RateLimitThresholdBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize configuration
        node.mode = config.mode || "rate-limit";
        node.rate = parseFloat(config.rate) || 1.0; // Units per second
        node.interval = parseInt(config.interval) || 100; // ms
        node.threshold = parseFloat(config.threshold) || 5.0; // Units
        node.currentValue = context.get("currentValue") || 0;
        node.lastOutput = context.get("lastOutput") || null;
        node.targetValue = node.currentValue;
        node.lastUpdate = context.get("lastUpdate") || Date.now();
        context.set("currentValue", node.currentValue);
        context.set("lastOutput", node.lastOutput);
        context.set("lastUpdate", node.lastUpdate);

        // Set initial status
        let statusText = `Mode: ${node.mode}, value: ${node.currentValue.toFixed(2)}`;
        if (node.mode === "rate-limit") {
            statusText += `, target: ${node.targetValue.toFixed(2)}, rate: ${node.rate}/s`;
        } else if (node.mode === "threshold") {
            statusText += `, last: ${(node.lastOutput !== null ? node.lastOutput.toFixed(2) : "none")}, threshold: ${node.threshold}`;
        }
        node.status({ fill: "blue", shape: "dot", text: statusText });

        let updateTimer = null;

        // Function to update output for rate-limit mode
        function updateRateLimitOutput() {
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
                context.set("currentValue", node.currentValue);
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `mode: rate-limit, value: ${node.currentValue.toFixed(2)}, target: ${node.targetValue}, rate: ${node.rate}/s`
                });
                node.send({ payload: node.currentValue });
            }

            node.lastUpdate = now;
            context.set("lastUpdate", now);
        }

        // Start update timer for rate-limit mode
        function startTimer() {
            if (updateTimer) clearInterval(updateTimer);
            updateTimer = setInterval(updateRateLimitOutput, node.interval);
        }

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (typeof msg.payload !== "number" || isNaN(msg.payload)) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `invalid input: ${node.currentValue}`
                });
                if (done) done();
                return;
            }

            const inputValue = msg.payload;

            if (node.mode === "rate-limit") {
                node.targetValue = inputValue;
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `mode: rate-limit, value: ${node.currentValue.toFixed(2)}, target: ${node.targetValue}, rate: ${node.rate}/s`
                });
                startTimer();
            } else if (node.mode === "threshold") {
                const diff = node.lastOutput !== null ? Math.abs(inputValue - node.lastOutput) : node.threshold + 1;
                if (diff > node.threshold || node.lastOutput === null) {
                    node.lastOutput = inputValue;
                    node.currentValue = inputValue;
                    context.set("lastOutput", node.lastOutput);
                    context.set("currentValue", node.currentValue);
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `mode: threshold, last: ${node.lastOutput.toFixed(2)}`
                    });
                    send({ payload: node.lastOutput });
                } else {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `mode: threshold, last: ${node.lastOutput.toFixed(2)}, diff: ${diff}`
                    });
                }
            } else if (node.mode === "full-value") {
                node.currentValue = inputValue;
                context.set("currentValue", node.currentValue);
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `mode: full-value, value: ${node.currentValue.toFixed(2)}`
                });
                send({ payload: inputValue });
            }

            if (done) done();
        });

        node.on("close", function (done) {
            if (updateTimer) clearInterval(updateTimer);
            done();
        });
    }

    RED.nodes.registerType("ratelimitthreshold-block", RateLimitThresholdBlockNode);
};