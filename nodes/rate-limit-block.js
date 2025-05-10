module.exports = function (RED) {
    function RateLimitBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize configuration
        node.name = config.name || "rate limit";
        node.mode = config.mode || "rate-limit";
        node.rate = parseFloat(config.rate) || 1.0;
        node.interval = parseInt(config.interval) || 100;
        node.threshold = parseFloat(config.threshold) || 5.0;
        node.currentValue = context.get("currentValue") || 0;
        node.targetValue = node.currentValue;
        node.lastUpdate = context.get("lastUpdate") || Date.now();
        context.set("currentValue", node.currentValue);
        context.set("lastUpdate", node.lastUpdate);

        // Set initial status
        node.status({ fill: "blue", shape: "dot", text: `mode: ${node.mode}, out: ${node.currentValue.toFixed(2)}` });

        let updateTimer = null;

        // Function to update output for rate-limit mode
        function updateRateLimitOutput(msg) {
            const now = Date.now();
            const elapsed = (now - node.lastUpdate) / 1000; // Seconds
            const maxChange = node.rate * elapsed;
            let newValue = node.currentValue;

            if (node.currentValue < node.targetValue) {
                newValue = Math.min(node.currentValue + maxChange, node.targetValue);
            } else if (node.currentValue > node.targetValue) {
                newValue = Math.max(node.currentValue - maxChange, node.targetValue);
            }

            node.currentValue = newValue;
            context.set("currentValue", node.currentValue);
            node.lastUpdate = now;
            context.set("lastUpdate", now);

            msg.payload = node.currentValue;
            node.status({
                fill: "blue",
                shape: "dot",
                text: `mode: rate-limit, out: ${node.currentValue.toFixed(2)}`
            });
            node.send(msg);
        }

        // Start update timer for rate-limit mode
        function startTimer() {
            if (updateTimer) clearInterval(updateTimer);
            updateTimer = setInterval(() => updateRateLimitOutput({ payload: node.currentValue }), node.interval);
        }

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (typeof msg.payload !== "number" || isNaN(msg.payload)) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `invalid input`
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
                    text: `mode: rate-limit, target: ${node.targetValue.toFixed(2)}`
                });
                startTimer();
            } else if (node.mode === "threshold") {
                const diff = Math.abs(inputValue - node.currentValue);
                node.currentValue = inputValue;
                context.set("currentValue", node.currentValue);
                msg.payload = inputValue;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `mode: threshold, out: ${node.currentValue.toFixed(2)}`
                });
                if (diff > node.threshold) {
                    send(msg);
                }
            } else if (node.mode === "full-value") {
                node.currentValue = inputValue;
                context.set("currentValue", node.currentValue);
                msg.payload = inputValue;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `mode: full-value, out: ${node.currentValue.toFixed(2)}`
                });
                send(msg);
            }

            if (done) done();
        });

        node.on("close", function (done) {
            if (updateTimer) clearInterval(updateTimer);
            done();
        });
    }

    RED.nodes.registerType("rate-limit-block", RateLimitBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/rate-limit-block/:id", RED.auth.needsPermission("rate-limit-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "rate-limit-block") {
            res.json({
                name: node.name || "rate limit",
                mode: node.mode || "rate-limit",
                rate: node.rate || 1.0,
                interval: node.interval || 100,
                threshold: node.threshold || 5.0
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};