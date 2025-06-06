const fs = require("fs").promises;
const path = require("path");
const fsSync = require("fs");

module.exports = function(RED) {
    function MemoryBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const utils = require("./utils");

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            writePeriod: config.writePeriod || "60000",
            writePeriodType: config.writePeriodType || "num",
            transferProperty: config.transferProperty || "payload",
            writeOnUpdate: config.writeOnUpdate === true, // New boolean config
            storedMsg: null
        };

        // File path for persistent storage
        const filePath = path.join(RED.settings.userDir, `memory-${node.id}.json`);

        // In-memory cache for delayed writes (used only when writeOnUpdate is false)
        let writeTimeout = null;
        let lastUpdateMsg = null;

        // Load stored message from file
        async function loadStoredMessage() {
            try {
                const data = await fs.readFile(filePath, "utf8");
                node.runtime.storedMsg = JSON.parse(data);
                const payloadStr = node.runtime.storedMsg[node.runtime.transferProperty] != null ? String(node.runtime.storedMsg[node.runtime.transferProperty]).substring(0, 20) : "null";
                node.status({ fill: "green", shape: "dot", text: `loaded: ${payloadStr}` });
            } catch (err) {
                if (err.code !== "ENOENT") {
                    node.status({ fill: "red", shape: "ring", text: "file error" });
                }
            }
        }

        // Read message from file synchronously (for execute and executeWithFallback when writeOnUpdate is true)
        function readStoredMessageSync() {
            try {
                if (fsSync.existsSync(filePath)) {
                    const data = fsSync.readFileSync(filePath, "utf8");
                    return JSON.parse(data);
                }
                return null;
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "file read error" });
                node.error("Failed to read stored message: " + err.message);
                return null;
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
                node.error("Failed to save message: " + err.message);
            }
        }

        // Initialize (load only if writeOnUpdate is false)
        if (!node.runtime.writeOnUpdate) {
            loadStoredMessage().catch(err => {
                node.error("Failed to load stored message: " + err.message);
            });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Resolve writePeriod
            const writePeriod = utils.getTypedValue(node, msg, node.runtime.writePeriod, node.runtime.writePeriodType, { min: 0, name: "write period" }, 60000);
            if (isNaN(writePeriod) || !isFinite(writePeriod) || writePeriod < 0) {
                node.status({ fill: "red", shape: "ring", text: "invalid write period" });
                node.runtime.writePeriod = "60000";
            } else {
                node.runtime.writePeriod = writePeriod.toString();
            }
            node.runtime.writePeriodType = "num";

            // Initialize output array: [Output 1, Output 2]
            const output = [null, null];

            // Handle context
            if (!msg.hasOwnProperty("context") || !msg.context || typeof msg.context !== "string") {
                // Pass-through message to Output 2
                const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                node.status({ fill: "blue", shape: "dot", text: `in: ${payloadStr}, out2: ${payloadStr}` });
                output[1] = msg;
                send(output);
                if (done) done();
                return;
            }

            if (msg.context === "update") {
                if (!msg.hasOwnProperty(node.runtime.transferProperty)) {
                    node.status({ fill: "red", shape: "ring", text: `missing ${node.runtime.transferProperty}` });
                    if (done) done();
                    return;
                }
                const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                if (node.runtime.writeOnUpdate) {
                    // Write directly to file, do not store in memory
                    try {
                        fs.writeFile(filePath, JSON.stringify(msg)).catch(err => {
                            node.status({ fill: "red", shape: "ring", text: "file error" });
                            node.error("Failed to save message: " + err.message);
                        });
                        node.status({ fill: "green", shape: "dot", text: `updated: ${payloadStr}` });
                    } catch (err) {
                        node.status({ fill: "red", shape: "ring", text: "file error" });
                        node.error("Failed to save message: " + err.message);
                    }
                } else {
                    // Original behavior: store in memory and context, delay write
                    node.runtime.storedMsg = RED.util.cloneMessage(msg);
                    node.context().set("storedMsg", node.runtime.storedMsg);
                    lastUpdateMsg = node.runtime.storedMsg;
                    node.status({ fill: "green", shape: "dot", text: `updated: ${payloadStr}` });
                    if (writeTimeout) clearTimeout(writeTimeout);
                    writeTimeout = setTimeout(() => {
                        saveMessage();
                    }, writePeriod);
                }
                if (done) done();
                return;
            }

            if (msg.context === "execute") {
                let storedMsg = node.runtime.writeOnUpdate ? readStoredMessageSync() : node.runtime.storedMsg;
                if (storedMsg !== null) {
                    const outMsg = RED.util.cloneMessage(msg);
                    outMsg[node.runtime.transferProperty] = storedMsg[node.runtime.transferProperty];
                    const payloadStr = outMsg[node.runtime.transferProperty] != null ? String(outMsg[node.runtime.transferProperty]).substring(0, 20) : "null";
                    node.status({ fill: "blue", shape: "dot", text: `in: execute, out2: ${payloadStr}` });
                    output[1] = outMsg;
                } else {
                    node.status({ fill: "blue", shape: "ring", text: `in: execute, out2: null` });
                    output[1] = { payload: null };
                }
                send(output);
                if (done) done();
                return;
            }

            if (msg.context === "executeWithFallback") {
                let storedMsg = node.runtime.writeOnUpdate ? readStoredMessageSync() : node.runtime.storedMsg;
                if (storedMsg !== null) {
                    const outMsg = RED.util.cloneMessage(msg);
                    outMsg[node.runtime.transferProperty] = storedMsg[node.runtime.transferProperty];
                    const payloadStr = outMsg[node.runtime.transferProperty] != null ? String(outMsg[node.runtime.transferProperty]).substring(0, 20) : "null";
                    node.status({ fill: "blue", shape: "dot", text: `in: executeWithFallback, out2: ${payloadStr}` });
                    output[1] = outMsg;
                } else {
                    if (!msg.hasOwnProperty(node.runtime.transferProperty)) {
                        node.status({ fill: "red", shape: "ring", text: `missing ${node.runtime.transferProperty}` });
                        if (done) done();
                        return;
                    }
                    const outMsg = RED.util.cloneMessage(msg);
                    if (node.runtime.writeOnUpdate) {
                        // Write directly to file
                        try {
                            fs.writeFile(filePath, JSON.stringify({ [node.runtime.transferProperty]: msg[node.runtime.transferProperty] })).catch(err => {
                                node.status({ fill: "red", shape: "ring", text: "file error" });
                                node.error("Failed to save message: " + err.message);
                            });
                        } catch (err) {
                            node.status({ fill: "red", shape: "ring", text: "file error" });
                            node.error("Failed to save message: " + err.message);
                        }
                    } else {
                        // Store in memory and context
                        node.runtime.storedMsg = { [node.runtime.transferProperty]: msg[node.runtime.transferProperty] };
                        node.context().set("storedMsg", node.runtime.storedMsg);
                        lastUpdateMsg = node.runtime.storedMsg;
                        if (writeTimeout) clearTimeout(writeTimeout);
                        writeTimeout = setTimeout(() => {
                            saveMessage();
                        }, writePeriod);
                    }
                    const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                    node.status({ fill: "blue", shape: "dot", text: `in: executeWithFallback, out2: ${payloadStr}` });
                    output[1] = outMsg;
                }
                send(output);
                if (done) done();
                return;
            }

            if (msg.context === "query") {
                const hasValue = node.runtime.writeOnUpdate ? fsSync.existsSync(filePath) : node.runtime.storedMsg !== null;
                node.status({ fill: "blue", shape: "dot", text: `in: query, out1: ${hasValue}` });
                output[0] = { payload: hasValue };
                send(output);
                if (done) done();
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
            if (done) done("Unknown context");
        });

        node.on("close", function(done) {
            if (writeTimeout) clearTimeout(writeTimeout);
            if (!node.runtime.writeOnUpdate && lastUpdateMsg) {
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
            } else {
                node.status({});
                done();
            }
        });
    }

    RED.nodes.registerType("memory-block", MemoryBlockNode);

    // Serve runtime state for editor
    RED.httpAdmin.get("/memory-block-runtime/:id", RED.auth.needsPermission("memory-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "memory-block") {
            res.json({
                name: node.runtime.name,
                writePeriod: node.runtime.writePeriod,
                writePeriodType: node.runtime.writePeriodType,
                transferProperty: node.runtime.transferProperty,
                writeOnUpdate: node.runtime.writeOnUpdate,
                storedMsg: node.runtime.storedMsg
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};