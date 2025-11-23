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
        
        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }  

            let matchAgainst;
            
            // Evaluate typed-input properties    
            try {     
                matchAgainst = RED.util.evaluateNodeProperty( config.property, config.propertyType, node, msg );

                if (matchAgainst === undefined) {
                    node.status({ fill: "red", shape: "ring", text: "property evaluation failed" });
                    if (done) done();
                    return;
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
                if (done) done(err);
                return;
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
                    node.status({ fill: "blue", shape: "dot", text: `Matched: ${rule.value}` });
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
                node.status({ fill: "blue", shape: "ring", text: "No match" });
            } else if (rules.length === 0) {
                node.status({ fill: "yellow", shape: "ring", text: "No rules configured" });
            }

            if (done) done();
        });

        node.on("close", function(done) {
            if (done) done();
        });
    }
    
    RED.nodes.registerType("enum-switch-block", EnumSwitchBlockNode);
};
