const fs = require("fs").promises;
const path = require("path");
const fsSync = require("fs");

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function MemoryBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name,
            writePeriod: config.writePeriod,
            transferProperty: config.transferProperty,
            writeOnUpdate: config.writeOnUpdate === true,
            storedMsg: null
        };

        // Resolve typed inputs
        node.runtime.writePeriod = parseFloat(RED.util.evaluateNodeProperty( config.writePeriod, config.writePeriodType, node ));

        // File path for persistent storage
        const filePath = path.join(RED.settings.userDir, `memory-${node.id}.json`);

        let writeTimeout = null;
        let lastUpdateMsg = null;

        // Load stored message from file
        async function loadStoredMessage() {
            try {
                const data = await fs.readFile(filePath, "utf8");
                node.runtime.storedMsg = JSON.parse(data);
                const payloadStr = node.runtime.storedMsg[node.runtime.transferProperty] != null ? String(node.runtime.storedMsg[node.runtime.transferProperty]).substring(0, 20) : "null";
                utils.setStatusOK(node, `loaded: ${payloadStr}`);
            } catch (err) {
                if (err.code !== "ENOENT") {
                    utils.setStatusError(node, "file error");
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
                utils.setStatusError(node, "file read error");
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
                utils.setStatusError(node, "file error");
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
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Evaluate typed-inputs if needed
            if (utils.requiresEvaluation(config.writePeriodType)) {
                node.runtime.writePeriod = parseFloat(RED.util.evaluateNodeProperty( config.writePeriod, config.writePeriodType, node, msg ));
            }

            // Initialize output array: [Output 1, Output 2]
            const output = [null, null];

            // Handle context
            if (!msg.hasOwnProperty("context") || !msg.context || typeof msg.context !== "string") {
                // Pass-through message to Output 2
                const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                utils.setStatusChanged(node, `in: ${payloadStr}, out2: ${payloadStr}`);
                output[1] = msg;
                send(output);
                if (done) done();
                return;
            }

            if (msg.context === "update") {
                if (!msg.hasOwnProperty(node.runtime.transferProperty)) {
                    utils.setStatusError(node, `missing ${node.runtime.transferProperty}`);
                    if (done) done();
                    return;
                }
                const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                if (node.runtime.writeOnUpdate) {
                    // Write directly to file, do not store in memory
                    try {
                        fs.writeFile(filePath, JSON.stringify(msg)).catch(err => {
                            utils.setStatusError(node, "file error");
                            node.error("Failed to save message: " + err.message);
                        });
                        utils.setStatusOK(node, `updated: ${payloadStr}`);
                    } catch (err) {
                        utils.setStatusError(node, "file error");
                        node.error("Failed to save message: " + err.message);
                    }
                } else {
                    // Original behavior: store in memory and context, delay write
                    node.runtime.storedMsg = RED.util.cloneMessage(msg);
                    node.context().set("storedMsg", node.runtime.storedMsg);
                    lastUpdateMsg = node.runtime.storedMsg;
                    utils.setStatusOK(node, `updated: ${payloadStr}`);
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
                    utils.setStatusChanged(node, `in: execute, out2: ${payloadStr}`);
                    output[1] = outMsg;
                } else {
                    utils.setStatusUnchanged(node, `in: execute, out2: null`);
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
                    utils.setStatusChanged(node, `in: executeWithFallback, out2: ${payloadStr}`);
                    output[1] = outMsg;
                } else {
                    let value;
                    if (msg.hasOwnProperty(node.runtime.transferProperty)) {
                        value = msg[node.runtime.transferProperty];
                    }
                    else if (msg.hasOwnProperty("fallback")) {
                        value = msg.fallback;
                    } else {
                        utils.setStatusError(node, `missing ${node.runtime.transferProperty}`);
                        if (done) done();
                        return;
                    }
                    
                    if (node.runtime.writeOnUpdate) {
                        // Write directly to file
                        try {
                            fs.writeFile(filePath, JSON.stringify({ [node.runtime.transferProperty]: value })).catch(err => {
                                utils.setStatusError(node, "file error");
                                node.error("Failed to save message: " + err.message);
                            });
                        } catch (err) {
                            utils.setStatusError(node, "file error");
                            node.error("Failed to save message: " + err.message);
                        }
                    } else {
                        // Store in memory and context
                        node.runtime.storedMsg = { [node.runtime.transferProperty]: value };
                        node.context().set("storedMsg", node.runtime.storedMsg);
                        lastUpdateMsg = node.runtime.storedMsg;
                        if (writeTimeout) clearTimeout(writeTimeout);
                        writeTimeout = setTimeout(() => {
                            saveMessage();
                        }, writePeriod);
                    }
                    const outMsg = RED.util.cloneMessage(msg);
                    outMsg[node.runtime.transferProperty] = value;
                    const payloadStr = msg[node.runtime.transferProperty] != null ? String(msg[node.runtime.transferProperty]).substring(0, 20) : "null";
                    utils.setStatusChanged(node, `in: executeWithFallback, out2: ${payloadStr}`);
                    output[1] = outMsg;
                }
                send(output);
                if (done) done();
                return;
            }

            if (msg.context === "query") {
                const hasValue = node.runtime.writeOnUpdate ? fsSync.existsSync(filePath) : node.runtime.storedMsg !== null;
                utils.setStatusChanged(node, `in: query, out1: ${hasValue}`);
                output[0] = { payload: hasValue };
                send(output);
                if (done) done();
                return;
            }

            utils.setStatusWarn(node, "unknown context");
            if (done) done("Unknown context");
        });

        node.on("close", function(done) {
            if (writeTimeout) clearTimeout(writeTimeout);
            if (!node.runtime.writeOnUpdate && lastUpdateMsg) {
                saveMessage()
                    .then(() => {
                        utils.setStatusOK(node, "");
                        done();
                    })
                    .catch(err => {
                        node.error("Failed to save message on close: " + err.message);
                        utils.setStatusError(node, "save error");
                        done();
                    });
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("memory-block", MemoryBlockNode);
};