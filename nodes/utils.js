module.exports = function(RED) {
    // Shared state across all nodes using this utils module
    // Registries set attached to RED object to ensure a true singleton
    // across multiple invocations of this module function.
    if (!RED._bldgblocks_registries) {
        RED._bldgblocks_registries = new Set();
    }
    const registries = RED._bldgblocks_registries;

    function registerRegistryNode(node) {
        registries.add(node);
        node.on("close", () => registries.delete(node));
    }

    function lookupPointMetadata(pointId) {
        const pid = parseInt(pointId);
        if (isNaN(pid)) return null;
        
        for (const reg of registries) {
            if (reg.points && reg.points.has(pid)) {
                return reg.points.get(pid);
            }
        }
        return null;
    }

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

    // ============================================================================
    // Validation Helper Functions
    // ============================================================================
    // Common validation patterns used across control blocks

    /**
     * Validate that msg exists and contains required properties
     * @param {Object} msg - The message object to validate
     * @param {string[]} requiredProps - Array of required property names (e.g., ["payload"])
     * @returns {boolean} true if valid, false otherwise
     */
    function validateMessage(msg, requiredProps = []) {
        if (!msg || typeof msg !== 'object') {
            return false;
        }
        return requiredProps.every(prop => msg.hasOwnProperty(prop));
    }

    /**
     * Validate and parse numeric payload
     * @param {*} payload - The payload to validate
     * @param {Object} options - Validation options {min, max, allowZero}
     * @returns {Object} {valid: boolean, value: number|null, error: string|null}
     */
    function validateNumericPayload(payload, options = {}) {
        const { min = -Infinity, max = Infinity, allowZero = true } = options;
        
        if (payload === null || payload === undefined) {
            return { valid: false, value: null, error: "missing payload" };
        }

        const value = parseFloat(payload);
        
        if (isNaN(value)) {
            return { valid: false, value: null, error: "invalid numeric payload" };
        }

        if (!allowZero && value === 0) {
            return { valid: false, value: null, error: "payload cannot be zero" };
        }

        if (value < min || value > max) {
            return { valid: false, value: null, error: `payload out of range [${min}, ${max}]` };
        }

        return { valid: true, value, error: null };
    }

    /**
     * Validate slot index for multi-slot blocks
     * @param {string|number} slotId - The slot identifier (e.g., "in1", "in2")
     * @param {number} maxSlots - Maximum number of slots available
     * @returns {Object} {valid: boolean, index: number|null, error: string|null}
     */
    function validateSlotIndex(slotId, maxSlots) {
        if (!slotId) {
            return { valid: false, index: null, error: "missing slot identifier" };
        }

        // Handle numeric string (e.g., "1") or prefixed (e.g., "in1")
        let indexStr = slotId;
        if (typeof slotId === 'string' && slotId.match(/^[a-z]+(\d+)$/i)) {
            indexStr = slotId.match(/\d+/)[0];
        }

        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            return { valid: false, index: null, error: `invalid slot index: ${slotId}` };
        }

        if (index < 1 || index > maxSlots) {
            return { valid: false, index: null, error: `slot out of range [1, ${maxSlots}]` };
        }

        return { valid: true, index, error: null };
    }

    /**
     * Validate boolean payload
     * @param {*} payload - The payload to validate
     * @returns {Object} {valid: boolean, value: boolean|null, error: string|null}
     */
    function validateBoolean(payload) {
        if (payload === null || payload === undefined) {
            return { valid: false, value: null, error: "missing boolean payload" };
        }

        if (typeof payload === 'boolean') {
            return { valid: true, value: payload, error: null };
        }

        if (typeof payload === 'string') {
            const lower = payload.toLowerCase();
            if (lower === 'true' || lower === '1' || lower === 'on') {
                return { valid: true, value: true, error: null };
            }
            if (lower === 'false' || lower === '0' || lower === 'off') {
                return { valid: true, value: false, error: null };
            }
        }

        if (typeof payload === 'number') {
            return { valid: true, value: payload !== 0, error: null };
        }

        return { valid: false, value: null, error: "invalid boolean payload" };
    }

    /**
     * Validate integer within range
     * @param {*} payload - The payload to validate
     * @param {Object} options - Validation options {min, max}
     * @returns {Object} {valid: boolean, value: number|null, error: string|null}
     */
    function validateIntRange(payload, options = {}) {
        const { min = -Infinity, max = Infinity } = options;

        if (payload === null || payload === undefined) {
            return { valid: false, value: null, error: "missing payload" };
        }

        const value = parseInt(payload, 10);

        if (isNaN(value)) {
            return { valid: false, value: null, error: "invalid integer payload" };
        }

        if (value < min || value > max) {
            return { valid: false, value: null, error: `value out of range [${min}, ${max}]` };
        }

        return { valid: true, value, error: null };
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
        setStatusBusy,
        validateMessage,
        validateNumericPayload,
        validateSlotIndex,
        validateBoolean,
        validateIntRange,
        registerRegistryNode,
        lookupPointMetadata
    };
}