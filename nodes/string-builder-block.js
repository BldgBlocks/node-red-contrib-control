module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function StringBuilderBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;

        node.name = config.name;
        const legacyEntries = [1, 2, 3, 4].map(index => ({
            value: config[`in${index}`] == null ? "" : config[`in${index}`],
            type: config[`in${index}Type`] || "str"
        }));
        const hasConfiguredEntries = config.entriesConfigured === true ||
            config.entriesConfigured === "true" ||
            (Array.isArray(config.entries) && config.entries.length > 0);
        node.entries = hasConfiguredEntries && Array.isArray(config.entries)
            ? config.entries.map(entry => ({
                value: entry && entry.value != null ? entry.value : "",
                type: entry && entry.type ? entry.type : "str"
            }))
            : legacyEntries;
        node.values = node.entries.map(entry => entry.value);
        node.outputProperty = typeof config.outputProperty === "string" && config.outputProperty.trim() ? config.outputProperty.trim() : "payload";

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

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

                const evaluations = node.entries.map((entry, index) =>
                    utils.requiresEvaluation(entry.type)
                        ? utils.evaluateNodeProperty(entry.value, entry.type, node, msg)
                        : Promise.resolve(node.values[index])
                );

                const results = await Promise.all(evaluations);

                results.forEach((result, index) => {
                    if (result != null) node.values[index] = result;
                });
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
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }

                // Process input slot
                if (msg.context.startsWith("in")) {
                    let index = parseInt(msg.context.slice(2), 10);
                    if (!isNaN(index) && index >= 1 && index <= node.entries.length) {
                        if (node.entries[index - 1].type === "str") {
                            node.values[index - 1] = msg.payload;
                        } else {
                            utils.setStatusError(node, `Field type is ${node.entries[index - 1].type}`);
                            if (done) done();
                            return;
                        }
                    } else {
                        utils.setStatusError(node, `invalid input index ${index || "NaN"}`);
                        if (done) done();
                        return;
                    }
                }                
            }

            const output = node.values.join("");
            RED.util.setMessageProperty(msg, node.outputProperty, output, true);
            utils.setStatusOK(node, output);
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("string-builder-block", StringBuilderBlockNode);
};
