module.exports = function(RED) {
    function CacheBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            operationMode: config.operationMode || "payload",
            cachedMessage: null
        };

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message (Req 7)
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Validate context
            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                node.status({ fill: "red", shape: "ring", text: "missing context" });
                if (done) done();
                return;
            }

            // Validate payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                if (done) done();
                return;
            }

            switch (msg.context) {
                case "update":
                    node.runtime.cachedMessage = RED.util.cloneMessage(msg);
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `update: ${typeof msg.payload === "number" ? msg.payload.toFixed(2) : JSON.stringify(msg.payload).slice(0, 20)}`
                    });
                    if (done) done();
                    return;
                case "execute":
                    if (node.runtime.cachedMessage === null) {
                        node.status({
                            fill: "blue",
                            shape: "dot",
                            text: "execute: null"
                        });
                        send({ payload: null });
                    } else {
                        let outputMsg;
                        if (node.runtime.operationMode === "clone") {
                            outputMsg = RED.util.cloneMessage(node.runtime.cachedMessage);
                        } else {
                            outputMsg = { payload: node.runtime.cachedMessage.payload };
                        }
                        node.status({
                            fill: "blue",
                            shape: "dot",
                            text: `execute: ${typeof outputMsg.payload === "number" ? outputMsg.payload.toFixed(2) : JSON.stringify(outputMsg.payload).slice(0, 20)}`
                        });
                        send(outputMsg);
                    }
                    if (done) done();
                    return;
                case "reset":
                    if (typeof msg.payload !== "boolean" || !msg.payload) {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    node.runtime.cachedMessage = null;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "reset"
                    });
                    if (done) done();
                    return;
                default:
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
            }
        });

        node.on("close", function(done) {
            node.runtime.cachedMessage = null;
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("cache-block", CacheBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/cache-block-runtime/:id", RED.auth.needsPermission("cache-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "cache-block") {
            res.json({
                name: node.runtime.name,
                operationMode: node.runtime.operationMode,
                cachedValue: node.runtime.cachedMessage ? node.runtime.cachedMessage.payload : null
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};