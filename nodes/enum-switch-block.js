module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function EnumSwitchBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Parse rules from config
        let rules = [];
        try {
            rules = JSON.parse(config.rules || "[]");
        } catch (e) {
            node.error("Invalid rules configuration");
            rules = [];
        }

        node.isBusy = false;
        
        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }  

            let matchAgainst;

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    utils.setStatusBusy(node, "busy - dropped msg");
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.propertyType) 
                        ? utils.evaluateNodeProperty( config.property, config.propertyType, node, msg )
                        : Promise.resolve(config.property),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                matchAgainst = results[0];   

                if (matchAgainst === undefined) {
                    utils.setStatusError(node, "property evaluation failed");
                    if (done) done();
                    return;
                }
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            const outputs = [];
            let matched = false;

            // Evaluate each rule and set outputs
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                let match = false;

                // Handle different types for comparison
                if (matchAgainst === null || matchAgainst === undefined) {
                    match = (rule.value === null || rule.value === undefined || rule.value === "");
                } else if (typeof matchAgainst === 'string' && typeof rule.value === 'string') {
                    match = matchAgainst === rule.value;
                } else if (typeof matchAgainst === 'number') {
                    const numericRuleValue = parseFloat(rule.value);
                    match = !isNaN(numericRuleValue) && matchAgainst === numericRuleValue;
                } else if (typeof matchAgainst === 'boolean') {
                    const boolRuleValue = rule.value.toLowerCase() === 'true';
                    match = matchAgainst === boolRuleValue;
                } else {
                    match = String(matchAgainst) === String(rule.value);
                }

                outputs[i] = match;
                
                if (match) {
                    matched = true;
                    utils.setStatusChanged(node, `Matched: ${rule.value}`);
                }
            }

            // Send output messages (all outputs as booleans)
            const messages = outputs.map(isMatch => {
                return {
                    ...msg,
                    payload: isMatch,
                    topic: msg.topic
                };
            });

            send(messages);

            if (!matched && rules.length > 0) {
                utils.setStatusUnchanged(node, "No match");
            } else if (rules.length === 0) {
                utils.setStatusWarn(node, "No rules configured");
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (done) done();
        });
    }
    
    RED.nodes.registerType("enum-switch-block", EnumSwitchBlockNode);
};
