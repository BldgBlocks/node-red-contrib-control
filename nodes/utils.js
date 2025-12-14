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
    
    // Usage:
    // const utils = require('./utils')(RED);

    return {
        requiresEvaluation,
        evaluateNodeProperty
    };
}