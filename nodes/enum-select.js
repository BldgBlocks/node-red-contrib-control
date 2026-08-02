module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function parseKeys(rawKeys) {
        let parsedKeys;

        try {
            parsedKeys = JSON.parse(rawKeys || "[]");
        } catch (err) {
            return { valid: false, keys: [], error: "invalid keys configuration" };
        }

        if (!Array.isArray(parsedKeys)) {
            return { valid: false, keys: [], error: "keys must be an array" };
        }

        if (!parsedKeys.every(key => typeof key === "string" && key.trim().length > 0)) {
            return { valid: false, keys: [], error: "keys must be non-empty strings" };
        }

        const keys = parsedKeys.map(key => key.trim());
        if (new Set(keys).size !== keys.length) {
            return { valid: false, keys: [], error: "duplicate keys configured" };
        }

        return { valid: true, keys, error: null };
    }

    function formatValue(value) {
        if (value === null) {
            return "null";
        }

        if (value === undefined) {
            return "undefined";
        }

        if (typeof value === "string") {
            return value.length > 24 ? `${value.slice(0, 21)}...` : value;
        }

        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }

        try {
            const serialized = JSON.stringify(value);
            return serialized.length > 24 ? `${serialized.slice(0, 21)}...` : serialized;
        } catch (err) {
            return typeof value;
        }
    }

    function EnumSelectNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const parsedKeys = parseKeys(config.keys);
        node.keys = parsedKeys.keys;
        node.keysError = parsedKeys.error;
        node.cachedMessages = {};
        node.selectedKey = node.keys.includes(config.selectedKey)
            ? config.selectedKey
            : (node.keys[0] || "");

        function knownKey(key) {
            return node.keys.includes(key);
        }

        function buildSwitchStatus(key, payload) {
            const activeKey = key || node.selectedKey || "-";
            if (payload === undefined) {
                return `switch: ${activeKey}`;
            }
            return `switch: ${activeKey}, out: ${formatValue(payload)}`;
        }

        function emitCachedMessage(send, key) {
            const cachedMsg = node.cachedMessages[key];
            if (!cachedMsg) {
                return false;
            }

            const outputMsg = RED.util.cloneMessage(cachedMsg);
            outputMsg.selectedKey = key;
            send(outputMsg);
            return true;
        }

        if (node.keysError) {
            utils.setStatusError(node, node.keysError);
        } else if (node.keys.length === 0) {
            utils.setStatusWarn(node, "no keys configured");
        } else {
            utils.setStatusOK(node, buildSwitchStatus(node.selectedKey));
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("context") || typeof msg.context !== "string") {
                utils.setStatusError(node, "missing or invalid context");
                if (done) done();
                return;
            }

            if (node.keysError) {
                utils.setStatusError(node, node.keysError);
                if (done) done();
                return;
            }

            if (node.keys.length === 0) {
                utils.setStatusWarn(node, "no keys configured");
                if (done) done();
                return;
            }

            if (msg.context === "reset") {
                node.cachedMessages = {};
                utils.setStatusChanged(node, buildSwitchStatus(node.selectedKey));
                if (done) done();
                return;
            }

            if (msg.context === "switch") {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }

                const requestedKey = String(msg.payload).trim();

                if (!knownKey(requestedKey)) {
                    utils.setStatusError(node, `unknown key: ${requestedKey}`);
                    if (done) done();
                    return;
                }

                if (requestedKey === node.selectedKey) {
                    utils.setStatusUnchanged(node, buildSwitchStatus(requestedKey));
                    if (done) done();
                    return;
                }

                node.selectedKey = requestedKey;

                if (emitCachedMessage(send, requestedKey)) {
                    const cachedPayload = node.cachedMessages[requestedKey]?.payload;
                    utils.setStatusChanged(node, buildSwitchStatus(requestedKey, cachedPayload));
                } else {
                    utils.setStatusChanged(node, buildSwitchStatus(requestedKey));
                }

                if (done) done();
                return;
            }

            if (!knownKey(msg.context)) {
                utils.setStatusWarn(node, `unknown context: ${msg.context}`);
                if (done) done();
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) done();
                return;
            }

            node.cachedMessages[msg.context] = RED.util.cloneMessage(msg);

            if (msg.context === node.selectedKey) {
                const outputMsg = RED.util.cloneMessage(node.cachedMessages[msg.context]);
                outputMsg.selectedKey = node.selectedKey;
                send(outputMsg);
                utils.setStatusChanged(node, buildSwitchStatus(node.selectedKey, msg.payload));
            } else {
                utils.setStatusOK(node, `${msg.context}: ${formatValue(msg.payload)}`);
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.cachedMessages = null;
            done();
        });
    }

    RED.nodes.registerType("enum-select", EnumSelectNode);
};