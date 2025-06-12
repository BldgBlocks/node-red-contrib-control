module.exports = function(RED) {
    function ConvertBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            conversion: config.conversion || "C to F"
        };

        // Validate configuration
        const validConversions = ["F to C", "C to F", "decimal to %", "% to decimal", "Pa to inH₂O", "inH₂O to Pa", "Pa to inHg", "inHg to Pa", "Pa to bar", "bar to Pa", "Pa to psi", "psi to Pa"];
        if (!validConversions.includes(node.runtime.conversion)) {
            node.runtime.conversion = "C to F";
            node.status({ fill: "red", shape: "ring", text: "invalid conversion, using C to F" });
            node.warn(`Invalid configuration: conversion=${config.conversion}, using C to F`);
        } else {
            node.status({ fill: "green", shape: "dot", text: `conversion: ${node.runtime.conversion}` });
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn("Missing message");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.context) {
                if (typeof msg.context !== "string" || !msg.context.trim()) {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    node.warn(`Unknown context: ${msg.context}`);
                    if (done) done();
                    return;
                }
                if (msg.context === "conversion") {
                    if (!msg.hasOwnProperty("payload") || !validConversions.includes(msg.payload)) {
                        node.status({ fill: "red", shape: "ring", text: "invalid conversion" });
                        node.warn(`Invalid conversion: ${msg.payload}`);
                        if (done) done();
                        return;
                    }
                    node.runtime.conversion = msg.payload;
                    node.status({ fill: "green", shape: "dot", text: `conversion: ${node.runtime.conversion}` });
                    if (done) done();
                    return;
                }
                // Ignore unknown context for passthrough node
                node.warn(`Ignored context: ${msg.context}`);
                if (done) done();
                return;
            }

            // Validate input payload
            if (!msg.hasOwnProperty("payload")) {
                node.status({ fill: "red", shape: "ring", text: "missing payload" });
                node.warn("Missing payload");
                if (done) done();
                return;
            }
            if (typeof msg.payload !== "number" || isNaN(msg.payload) || !isFinite(msg.payload)) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                node.warn(`Invalid payload: ${msg.payload}`);
                if (done) done();
                return;
            }

            // Perform conversion
            let output, inUnit, outUnit;
            switch (node.runtime.conversion) {
                case "F to C":
                    output = (msg.payload - 32) * 5 / 9;
                    inUnit = "°F";
                    outUnit = "°C";
                    break;
                case "C to F":
                    output = (msg.payload * 9 / 5) + 32;
                    inUnit = "°C";
                    outUnit = "°F";
                    break;
                case "decimal to %":
                    output = msg.payload * 100;
                    inUnit = "";
                    outUnit = "%";
                    break;
                case "% to decimal":
                    output = msg.payload / 100;
                    inUnit = "%";
                    outUnit = "";
                    break;
                case "Pa to inH₂O":
                    output = msg.payload * 0.00401463;
                    inUnit = "Pa";
                    outUnit = "inH₂O";
                    break;
                case "inH₂O to Pa":
                    output = msg.payload / 0.00401463;
                    inUnit = "inH₂O";
                    outUnit = "Pa";
                    break;
                case "Pa to inHg":
                    output = msg.payload * 0.0002953;
                    inUnit = "Pa";
                    outUnit = "inHg";
                    break;
                case "inHg to Pa":
                    output = msg.payload / 0.0002953;
                    inUnit = "inHg";
                    outUnit = "Pa";
                    break;
                case "Pa to bar":
                    output = msg.payload * 0.00001;
                    inUnit = "Pa";
                    outUnit = "bar";
                    break;
                case "bar to Pa":
                    output = msg.payload / 0.00001;
                    inUnit = "bar";
                    outUnit = "Pa";
                    break;
                case "Pa to psi":
                    output = msg.payload * 0.000145038;
                    inUnit = "Pa";
                    outUnit = "psi";
                    break;
                case "psi to Pa":
                    output = msg.payload / 0.000145038;
                    inUnit = "psi";
                    outUnit = "Pa";
                    break;
            }

            // Format status numbers
            const inDisplay = msg.payload % 1 === 0 ? msg.payload : msg.payload.toFixed(2);
            const outDisplay = output % 1 === 0 ? output : output.toFixed(2);

            // Update status and send output
            node.status({
                fill: "blue",
                shape: "dot",
                text: `in: ${inDisplay} ${inUnit} out: ${outDisplay} ${outUnit}`
            });
            const outputMsg = RED.util.cloneMessage(msg);
            outputMsg.payload = output;
            send(outputMsg);

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("convert-block", ConvertBlockNode);

    // HTTP endpoint for editor reflection
    RED.httpAdmin.get("/convert-block-runtime/:id", RED.auth.needsPermission("convert-block.read"), function(req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "convert-block") {
            res.json({
                name: node.runtime.name,
                conversion: node.runtime.conversion
            });
        } else {
            res.status(404).json({ error: "Node not found" });
        }
    });
};