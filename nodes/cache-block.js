module.exports = function(RED) {
    function CacheBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        
        // Initialize properties from config
        node.name = config.name || "cache";
        
        // Initialize state
        let lastValue = null;

        node.on("input", function(msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!msg.hasOwnProperty("context")) {
                node.status({ fill: "red", shape: "ring", text: "missing context" });
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            switch (msg.context) {
                case "update":
                    lastValue = msg.payload;
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: `update: ${typeof msg.payload === "number" ? msg.payload.toFixed(2) : msg.payload}`
                    });
                    if (done) done();
                    return;
                case "execute":
                    msg.payload = lastValue;
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: `execute: ${typeof lastValue === "number" ? lastValue.toFixed(2) : lastValue}`
                    });
                    send(msg);
                    if (done) done();
                    return;
                case "reset":
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    lastValue = null;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "reset"
                    });
                    if (done) done();
                    return;
                default:
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done();
                    return;
            }
        });

        node.on("close", function(done) {
            // Reset state on redeployment
            lastValue = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("cache-block", CacheBlockNode);

    // Serve dynamic config from runtime
    RED.httpAdmin.get("/cache-block/:id", RED.auth.needsPermission("cache-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "cache-block") {
            res.json({
                name: node.name || "cache"
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};