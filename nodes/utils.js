module.exports = function(RED) {
    function requiresEvaluation(type) { return type === "flow" || type === "global" || type === "msg"; }

    
    function evaluateProperties(node, config, properties, msg = null, initialize = true) {
        const results = {};
        
        properties.forEach(prop => {
            const type = config[`${prop}Type`];
            let value;            

            if (type === "msg" && msg === null) {
                value = null;
            } else if (initialize || requiresEvaluation(type)) {
                value = RED.util.evaluateNodeProperty(config[prop], type, node, msg);
            } else {
                value = config[prop];
            }
            results[prop] = value;
        });
        
        return results;
    }

    // const utils = require('./utils')(RED);

    return {
        requiresEvaluation,
        evaluateProperties
    };
}