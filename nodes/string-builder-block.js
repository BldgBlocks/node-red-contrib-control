module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function StringBuilderBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        node.name = config.name;
        node.in1 = config.in1;
        node.in2 = config.in2;
        node.in3 = config.in3;
        node.in4 = config.in4;

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Evaluate dynamic properties
            try {

                // Check busy lock
                if (node.isBusy) {
                    // Update status to let user know they are pushing too fast
                    node.status({ fill: "yellow", shape: "ring", text: "busy - dropped msg" });
                    if (done) done(); 
                    return;
                }

                // Lock node during evaluation
                node.isBusy = true;

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.in1Type) 
                        ? utils.evaluateNodeProperty(config.in1, config.in1Type, node, msg)
                        : Promise.resolve(node.in1),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.in2Type) 
                        ? utils.evaluateNodeProperty(config.in2, config.in2Type, node, msg)
                        : Promise.resolve(node.in2),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.in3Type) 
                        ? utils.evaluateNodeProperty(config.in3, config.in3Type, node, msg)
                        : Promise.resolve(node.in3),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.in4Type) 
                        ? utils.evaluateNodeProperty(config.in4, config.in4Type, node, msg)
                        : Promise.resolve(node.in4),
                );

                const results = await Promise.all(evaluations);

                // Update runtime with evaluated values
                if (results[0] != null) node.in1 = results[0];
                if (results[1] != null) node.in2 = results[1];
                if (results[2] != null) node.in3 = results[2];
                if (results[3] != null) node.in4 = results[3];
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
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
            node.status({ fill: "blue", shape: "dot", text: `${ output.payload }` });
            send(output);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("string-builder-block", StringBuilderBlockNode);
};
