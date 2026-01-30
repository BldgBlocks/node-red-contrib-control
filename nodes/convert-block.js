module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function ConvertBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const validConversions = [
            "F to C", 
            "C to F", 
            "K to C",
            "C to K", 
            "K to F",
            "F to K",
            "R to F",
            "F to R",
            "decimal to %", 
            "% to decimal", 
            "Pa to inH₂O", 
            "inH₂O to Pa", 
            "Pa to inHg", 
            "inHg to Pa", 
            "Pa to bar", 
            "bar to Pa", 
            "Pa to psi", 
            "psi to Pa",
            "m to ft",
            "ft to m",
            "m to in",
            "in to m",
            "mm to in",
            "in to mm",
            "kg to lb",
            "lb to kg",
            "L to gal",
            "gal to L",
            "kW to hp",
            "hp to kW",
            "rad to deg",
            "deg to rad",
            "s to min",
            "min to s"
        ];

        // Initialize runtime state
        // Initialize state
        node.inputProperty = config.inputProperty || "payload";
        node.conversion = validConversions.includes(config.conversion) ? config.conversion : "C to F";

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "missing message");
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context")) {
                if (typeof msg.context !== "string") {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done();
                    return;
                }
                if (msg.context === "conversion") {
                    if (!msg.hasOwnProperty("payload") || !validConversions.includes(msg.payload)) {
                        utils.setStatusError(node, "invalid conversion");
                        if (done) done();
                        return;
                    }
                    node.conversion = msg.payload;
                    utils.setStatusOK(node, `conversion: ${node.conversion}`);
                    if (done) done();
                    return;
                }
                
                if (done) done();
                return;
            }

            // Get input from configured property
            let input;
            try {
                input = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                input = undefined;
            }
            if (input === undefined) {
                utils.setStatusError(node, "missing or invalid input property");
                if (done) done();
                return;
            }

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || !isFinite(inputValue)) {
                utils.setStatusError(node, "invalid input");
                if (done) done();
                return;
            }

            // Perform conversion
            let output, inUnit, outUnit;
            switch (node.conversion) {
                case "F to C":
                    output = (inputValue - 32) * 5 / 9;
                    inUnit = "°F";
                    outUnit = "°C";
                    break;
                case "C to F":
                    output = (inputValue * 9 / 5) + 32;
                    inUnit = "°C";
                    outUnit = "°F";
                    break;
                case "decimal to %":
                    output = inputValue * 100;
                    inUnit = "";
                    outUnit = "%";
                    break;
                case "% to decimal":
                    output = inputValue / 100;
                    inUnit = "%";
                    outUnit = "";
                    break;
                case "Pa to inH₂O":
                    output = inputValue * 0.00401463;
                    inUnit = "Pa";
                    outUnit = "inH₂O";
                    break;
                case "inH₂O to Pa":
                    output = inputValue / 0.00401463;
                    inUnit = "inH₂O";
                    outUnit = "Pa";
                    break;
                case "Pa to inHg":
                    output = inputValue * 0.0002953;
                    inUnit = "Pa";
                    outUnit = "inHg";
                    break;
                case "inHg to Pa":
                    output = inputValue / 0.0002953;
                    inUnit = "inHg";
                    outUnit = "Pa";
                    break;
                case "Pa to bar":
                    output = inputValue * 0.00001;
                    inUnit = "Pa";
                    outUnit = "bar";
                    break;
                case "bar to Pa":
                    output = inputValue / 0.00001;
                    inUnit = "bar";
                    outUnit = "Pa";
                    break;
                case "Pa to psi":
                    output = inputValue * 0.000145038;
                    inUnit = "Pa";
                    outUnit = "psi";
                    break;
                case "psi to Pa":
                    output = inputValue / 0.000145038;
                    inUnit = "psi";
                    outUnit = "Pa";
                    break;
                case "K to C":
                    output = inputValue - 273.15;
                    inUnit = "K";
                    outUnit = "°C";
                    break;
                case "C to K":
                    output = inputValue + 273.15;
                    inUnit = "°C";
                    outUnit = "K";
                    break;
                case "K to F":
                    output = (inputValue * 9/5) - 459.67;
                    inUnit = "K";
                    outUnit = "°F";
                    break;
                case "F to K":
                    output = (inputValue + 459.67) * 5/9;
                    inUnit = "°F";
                    outUnit = "K";
                    break;
                case "R to F":
                    output = inputValue - 459.67;
                    inUnit = "°R";
                    outUnit = "°F";
                    break;
                case "F to R":
                    output = inputValue + 459.67;
                    inUnit = "°F";
                    outUnit = "°R";
                    break;
                case "m to ft":
                    output = inputValue * 3.28084;
                    inUnit = "m";
                    outUnit = "ft";
                    break;
                case "ft to m":
                    output = inputValue / 3.28084;
                    inUnit = "ft";
                    outUnit = "m";
                    break;
                case "m to in":
                    output = inputValue * 39.3701;
                    inUnit = "m";
                    outUnit = "in";
                    break;
                case "in to m":
                    output = inputValue / 39.3701;
                    inUnit = "in";
                    outUnit = "m";
                    break;
                case "mm to in":
                    output = inputValue / 25.4;
                    inUnit = "mm";
                    outUnit = "in";
                    break;
                case "in to mm":
                    output = inputValue * 25.4;
                    inUnit = "in";
                    outUnit = "mm";
                    break;
                case "kg to lb":
                    output = inputValue * 2.20462;
                    inUnit = "kg";
                    outUnit = "lb";
                    break;
                case "lb to kg":
                    output = inputValue / 2.20462;
                    inUnit = "lb";
                    outUnit = "kg";
                    break;
                case "L to gal":
                    output = inputValue * 0.264172;
                    inUnit = "L";
                    outUnit = "gal";
                    break;
                case "gal to L":
                    output = inputValue / 0.264172;
                    inUnit = "gal";
                    outUnit = "L";
                    break;
                case "kW to hp":
                    output = inputValue * 1.34102;
                    inUnit = "kW";
                    outUnit = "hp";
                    break;
                case "hp to kW":
                    output = inputValue / 1.34102;
                    inUnit = "hp";
                    outUnit = "kW";
                    break;
                case "rad to deg":
                    output = inputValue * (180 / Math.PI);
                    inUnit = "rad";
                    outUnit = "°";
                    break;
                case "deg to rad":
                    output = inputValue * (Math.PI / 180);
                    inUnit = "°";
                    outUnit = "rad";
                    break;
                case "s to min":
                    output = inputValue / 60;
                    inUnit = "s";
                    outUnit = "min";
                    break;
                case "min to s":
                    output = inputValue * 60;
                    inUnit = "min";
                    outUnit = "s";
                    break;
            }

            // Format status numbers
            let num = Number(msg.payload);
            let inDisplay = 0
            if (isNaN(num)) {
                inDisplay = 0;
            } else {
                inDisplay = num % 1 === 0 ? num : num.toFixed(2);
                msg.payload = inDisplay;
            }
            const outDisplay = output % 1 === 0 ? output : output.toFixed(2);

            // Update status and send output
            utils.setStatusOK(node, `${inDisplay} ${inUnit} → ${outDisplay} ${outUnit}`);

            msg.payload = output;
            send(msg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("convert-block", ConvertBlockNode);
};