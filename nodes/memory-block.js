const fs = require("fs").promises;
const path = require("path");

module.exports = function(RED) {
    function MemoryBlockNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        const utils = require("./utils");
        
        // Initialize properties
        node.name = config.name || "memory";
        node.runtime = {
            writePeriod: config.writePeriod,
            writePeriodType: config.writePeriodType,
            storedMsg: null
        };
        
        // File path for persistent storage
        const filePath = path.join(RED.settings.userDir, `memory-${node.id}.json`);
        
        // In-memory cache
        let writeTimeout = null;
        let lastUpdateMsg = null;

        // Load stored message from file
        async function loadStoredMessage() {
            try {
                const data = await fs.readFile(filePath, "utf8");
                node.runtime.storedMsg = JSON.parse(data);
                node.status({ fill: "green", shape: "dot", text: `loaded: ${JSON.stringify(node.runtime.storedMsg.payload)}` });
            } catch (err) {
                if (err.code !== "ENOENT") {
                    node.status({ fill: "red", shape: "ring", text: "file error" });
                }
            }
        }

        // Save message to file
        async function saveMessage() {
            if (lastUpdateMsg === null) return;
            try {
                await fs.writeFile(filePath, JSON.stringify(lastUpdateMsg));
                lastUpdateMsg = null;
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "file error" });
            }
        }

        // Initialize
        loadStoredMessage().catch(err => {
            node.error("Failed to load stored message: " + err.message);
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Resolve writePeriod
            const writePeriod = utils.getTypedValue(node, msg, node.runtime.writePeriod, node.runtime.writePeriodType, { min: 0, name: "write period" }, 60000);
            node.runtime.writePeriod = writePeriod.toString();
            node.runtime.writePeriodType = "num"; // Update to num after resolution

            if (!msg.hasOwnProperty("context") || !msg.context) {
                // Pass-through message
                node.status({ fill: "blue", shape: "dot", text: `pass: ${JSON.stringify(msg.payload)}` });
                send(msg);
                if (done) done();
                return;
            }

            if (msg.context === "update") {
                // Validate payload
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }
                // Store message
                node.runtime.storedMsg = RED.util.cloneMessage(msg);
                lastUpdateMsg = node.runtime.storedMsg;
                node.status({ fill: "green", shape: "dot", text: `updated: ${JSON.stringify(msg.payload)}` });
                
                // Schedule file write
                if (writeTimeout) clearTimeout(writeTimeout);
                writeTimeout = setTimeout(() => {
                    saveMessage().catch(err => {
                        node.error("Failed to save message: " + err.message);
                    });
                }, writePeriod);
                
                if (done) done();
                return;
            }

            if (msg.context === "execute") {
                // Output stored message
                if (node.runtime.storedMsg !== null) {
                    node.status({ fill: "blue", shape: "dot", text: `out: ${JSON.stringify(node.runtime.storedMsg.payload)}` });
                    send(node.runtime.storedMsg);
                } else {
                    node.status({ fill: "blue", shape: "dot", text: "out: none" });
                }
                if (done) done();
                return;
            }

            // Unknown context
            node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
            if (done) done();
        });

        node.on("close", function(done) {
            // Save any pending update
            if (writeTimeout) clearTimeout(writeTimeout);
            saveMessage()
                .then(() => {
                    node.status({});
                    done();
                })
                .catch(err => {
                    node.error("Failed to save message on close: " + err.message);
                    node.status({});
                    done();
                });
        });
    }

    RED.nodes.registerType("memory-block", MemoryBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/memory-block-runtime/:id", RED.auth.needsPermission("memory-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "memory-block") {
            res.json({
                writePeriod: node.runtime.writePeriod,
                writePeriodType: node.runtime.writePeriodType,
                storedMsg: node.runtime.storedMsg
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};