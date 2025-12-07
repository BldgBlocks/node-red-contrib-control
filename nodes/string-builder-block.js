module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function StringBuilderBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;

        // Evaluate typed-input properties    
        try {      
            node.in1 = RED.util.evaluateNodeProperty( config.in1, config.in1Type, node );
            node.in2 = RED.util.evaluateNodeProperty( config.in2, config.in2Type, node );
            node.in3 = RED.util.evaluateNodeProperty( config.in3, config.in3Type, node );
            node.in4 = RED.util.evaluateNodeProperty( config.in4, config.in4Type, node );
        } catch (err) {
            node.error(`Error evaluating properties: ${err.message}`);
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }
            
            // Update typed-input properties if needed
            try {           
                if (utils.requiresEvaluation(config.in1Type)) {
                    node.in1 = RED.util.evaluateNodeProperty( config.in1, config.in1Type, node, msg );
                }
                if (utils.requiresEvaluation(config.in2Type)) {
                    node.in2 = RED.util.evaluateNodeProperty( config.in2, config.in2Type, node, msg );
                }
                if (utils.requiresEvaluation(config.in3Type)) {
                    node.in3 = RED.util.evaluateNodeProperty( config.in3, config.in3Type, node, msg );
                }
                if (utils.requiresEvaluation(config.in4Type)) {
                    node.in4 = RED.util.evaluateNodeProperty( config.in4, config.in4Type, node, msg );
                }
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            }

            // Check required properties
            if (msg.hasOwnProperty("context")) {

                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload" });
                    if (done) done();
                    return;
                }

                // Process input slot
                if (msg.context.startsWith("in")) {
                    let index = parseInt(msg.context.slice(2), 10);
                    if (!isNaN(index) && index >= 1 && index <= 4) {
                        if (config[`in${index}Type`] === "str") {
                            node[`in${index}`] = msg.payload;
                        } else {
                            node.status({ fill: "red", shape: "ring", text: `Field type is ${config[`in${index}Type`]}` });
                            if (done) done();
                            return;
                        }
                    } else {
                        node.status({ fill: "red", shape: "ring", text: `invalid input index ${index || "NaN"}` });
                        if (done) done();
                        return;
                    }
                }                
            }

            const output = { payload: `${node.in1}${node.in2}${node.in3}${node.in4}` };
            send(output);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("string-builder-block", StringBuilderBlockNode);
};
