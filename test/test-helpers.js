/**
 * Shared test helpers for building blocks control nodes.
 * 
 * Keeps test files compact by providing:
 * - Flow builder (constructs Node-RED test flows)
 * - Common assertions (status checks, output checks)
 * - Timer helpers (for delay/timer-based nodes)
 */
const helper = require("node-red-node-test-helper");

// Point to the global Node-RED installation (avoids installing a 2nd copy locally)
// The test helper needs the main entry point so require() works and prefix resolves correctly
helper.init("/usr/lib/node_modules/node-red/lib/red.js");

/**
 * Build a minimal test flow with a single node under test.
 * Includes a flow tab for proper status() support.
 * @param {string} type - Node type name (e.g., "delay-block")
 * @param {Object} config - Node config overrides
 * @param {string} [id] - Node ID (default: "n1")
 * @param {number} [outputs] - Number of outputs (default: 1)
 * @returns {Array} Flow array ready for helper.load()
 */
function buildFlow(type, config = {}, id = "n1", outputs = 1) {
    const wires = [];
    const helpers = [];
    for (let i = 0; i < outputs; i++) {
        const helperId = `out${i === 0 ? "" : i + 1}`;
        wires.push([helperId]);
        helpers.push({ id: helperId, z: "f1", type: "helper" });
    }
    return [
        { id: "f1", type: "tab" },
        { 
            id, 
            z: "f1",
            type, 
            name: "test", 
            wires,
            ...config 
        },
        ...helpers
    ];
}

/**
 * Send a tagged message (msg.context + msg.payload) to a node.
 * @param {Object} node - The node instance
 * @param {string} context - msg.context value (e.g., "in1", "reset")
 * @param {*} payload - msg.payload value
 */
function sendTagged(node, context, payload) {
    node.receive({ context, payload });
}

/**
 * Send a plain payload (no context) to a node.
 * @param {Object} node - The node instance
 * @param {*} payload - msg.payload value
 */
function sendPayload(node, payload) {
    node.receive({ payload });
}

/**
 * Wait for N messages on a helper node, then resolve with them.
 * Times out after `timeoutMs` to prevent hanging tests.
 * @param {Object} helperNode - The helper node to listen on
 * @param {number} count - Number of messages to collect
 * @param {number} [timeoutMs=2000] - Timeout in ms
 * @returns {Promise<Array>} Collected messages
 */
function collectMessages(helperNode, count, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const msgs = [];
        const timer = setTimeout(() => {
            reject(new Error(`Timeout: expected ${count} messages, got ${msgs.length}`));
        }, timeoutMs);

        helperNode.on("input", (msg) => {
            msgs.push(msg);
            if (msgs.length >= count) {
                clearTimeout(timer);
                resolve(msgs);
            }
        });
    });
}

/**
 * Wait for exactly 1 message on a helper node.
 * @param {Object} helperNode - The helper node to listen on
 * @param {number} [timeoutMs=2000] - Timeout in ms
 * @returns {Promise<Object>} The message
 */
function waitForMessage(helperNode, timeoutMs = 2000) {
    return collectMessages(helperNode, 1, timeoutMs).then(msgs => msgs[0]);
}

/**
 * Assert that NO message arrives within a time window.
 * Useful for testing that delayed outputs don't fire prematurely.
 * @param {Object} helperNode - The helper node to listen on
 * @param {number} [windowMs=500] - How long to wait
 * @returns {Promise<void>} Resolves if no message received
 */
function expectNoMessage(helperNode, windowMs = 500) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, windowMs);
        helperNode.on("input", (msg) => {
            clearTimeout(timer);
            reject(new Error(`Unexpected message received: ${JSON.stringify(msg.payload)}`));
        });
    });
}

/**
 * Small promise-based delay for test sequencing.
 * @param {number} ms - Milliseconds to wait
 */
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    helper,
    buildFlow,
    sendTagged,
    sendPayload,
    collectMessages,
    waitForMessage,
    expectNoMessage,
    wait
};
