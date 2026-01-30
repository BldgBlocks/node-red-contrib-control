module.exports = function(RED) {
    function requiresEvaluation(type) { return type === "flow" || type === "global" || type === "msg"; }
    
    // Safe evaluation helper (promisified)
    function evaluateNodeProperty(value, type, node, msg) {
        return new Promise((resolve, reject) => {
            if (!this.requiresEvaluation(type)) {
                resolve(value); // Return raw value for static types
            } else {
                RED.util.evaluateNodeProperty(
                    value, type, node, msg, 
                    (err, result) => err ? reject(err) : resolve(result)
                );
            }
        });
    }

    function sendError(node, msg, done, text, pointId = null) {
        node.status({ fill: "red", shape: "dot", text: text });
        
        // Only attempt to send if a message object exists
        if (msg) {
            msg.status = { 
                code: "error", 
                pointId: pointId || msg.pointId || "unknown", 
                message: text 
            };
            node.send(msg);
        }
        
        if (done) done();
    }

    function sendSuccess(node, msg, done, text, pointId, shape = "ring") {
        node.status({ fill: "blue", shape: shape, text: text });
        
        if (msg) {
            msg.status = { 
                code: "ok", 
                pointId: pointId, 
                message: text 
            };
            node.send(msg);
        }

        if (done) done();
    }

    function getGlobalState(node, path, store) {
        return new Promise((resolve, reject) => {
            node.context().global.get(path, store, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
    }

    function setGlobalState(node, path, store, value) {
        return new Promise((resolve, reject) => {
            node.context().global.set(path, value, store, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    function getHighestPriority(state) {
        let value = state.defaultValue;
        let priority = 'default';

        for (let i = 1; i <= 16; i++) {
            // Check strictly for undefined/null, allow 0 or false
            if (state.priority[i] !== undefined && state.priority[i] !== null) {
                value = state.priority[i];
                priority = String(i);
                break;
            }
        }
        return { value, priority };
    }

    // ============================================================================
    // Status Helper Functions
    // ============================================================================
    // Simplified status reporting with consistent fill/shape/text protocol
    // Usage: utils.setStatusOK(node, "sum: 42.5");

    function setStatusOK(node, text) {
        node.status({ fill: "green", shape: "dot", text });
    }

    function setStatusChanged(node, text) {
        node.status({ fill: "blue", shape: "dot", text });
    }

    function setStatusUnchanged(node, text) {
        node.status({ fill: "blue", shape: "ring", text });
    }

    function setStatusError(node, text) {
        node.status({ fill: "red", shape: "ring", text });
    }

    function setStatusWarn(node, text) {
        node.status({ fill: "yellow", shape: "ring", text });
    }

    function setStatusBusy(node, text = "busy - dropped msg") {
        node.status({ fill: "yellow", shape: "ring", text });
    }
    
    // Usage:
    // const utils = require('./utils')(RED);

    return {
        requiresEvaluation,
        evaluateNodeProperty,
        sendError,
        sendSuccess,
        getGlobalState,
        setGlobalState,
        getHighestPriority,
        setStatusOK,
        setStatusChanged,
        setStatusUnchanged,
        setStatusError,
        setStatusWarn,
        setStatusBusy
    };
}