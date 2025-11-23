module.exports = function(RED) {
    function requiresEvaluation(type) { return type === "flow" || type === "global" || type === "msg"; }

    
    // const utils = require('./utils')(RED);

    return {
        requiresEvaluation
    };
}