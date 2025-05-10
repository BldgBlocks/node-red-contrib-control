module.exports = function (RED) {
    function ThermistorBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize configuration
        node.name = config.name || "";
        node.R_fixed = parseFloat(config.R_fixed) || 23500;
        node.Vsupply = parseFloat(config.Vsupply) || 5.08;
        node.Vref = parseFloat(config.Vref) || 4.096;
        node.ADC_max = parseFloat(config.ADC_max) || 32768;

        // Initialize context
        node.lastVoltage = context.get("lastVoltage") || 0;
        node.lastResistance = context.get("lastResistance") || 0;
        context.set("lastVoltage", node.lastVoltage);
        context.set("lastResistance", node.lastResistance);

        // Validate configuration
        if (isNaN(node.R_fixed) || node.R_fixed <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid r_fixed" });
            console.log(`invalid configuration for thermistor-block node ${node.id}: r_fixed=${node.R_fixed}`);
            return;
        }
        if (isNaN(node.Vsupply) || node.Vsupply <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid vsupply" });
            console.log(`invalid configuration for thermistor-block node ${node.id}: vsupply=${node.Vsupply}`);
            return;
        }
        if (isNaN(node.Vref) || node.Vref <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid vref" });
            console.log(`invalid configuration for thermistor-block node ${node.id}: vref=${node.Vref}`);
            return;
        }
        if (isNaN(node.ADC_max) || node.ADC_max <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid adc_max" });
            console.log(`invalid configuration for thermistor-block node ${node.id}: adc_max=${node.ADC_max}`);
            return;
        }

        // Set initial status
        node.status({
            fill: "blue",
            shape: "dot",
            text: `volt: ${node.lastVoltage.toFixed(2)}, res: ${node.lastResistance.toFixed(2)}`
        });
        console.log(`initialized thermistor-block node ${node.id}: r_fixed=${node.R_fixed}, vsupply=${node.Vsupply}, vref=${node.Vref}, adc_max=${node.ADC_max}`);

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                console.log(`error in thermistor-block node ${node.id}: missing message`);
                if (done) done();
                return;
            }

            let inputArray;
            if (Buffer.isBuffer(msg.payload)) {
                if (msg.payload.length !== 2) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `invalid input: expected 2-byte buffer`
                    });
                    console.log(`error in thermistor-block node ${node.id}: invalid input: ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
                inputArray = [msg.payload[0], msg.payload[1]];
            } else if (typeof msg.payload === "object" && msg.payload.type === "Buffer" && Array.isArray(msg.payload.data) && msg.payload.data.length === 2) {
                inputArray = msg.payload.data;
                if (typeof inputArray[0] !== "number" || typeof inputArray[1] !== "number") {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `invalid input: expected numeric [highByte, lowByte]`
                    });
                    console.log(`error in thermistor-block node ${node.id}: invalid input: ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
            } else if (Array.isArray(msg.payload) && msg.payload.length === 2 && typeof msg.payload[0] === "number" && typeof msg.payload[1] === "number") {
                inputArray = msg.payload;
            } else {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `invalid input: expected [highByte, lowByte] or 2-byte buffer`
                });
                console.log(`error in thermistor-block node ${node.id}: invalid input: ${JSON.stringify(msg.payload)}`);
                if (done) done();
                return;
            }

            try {
                // Calculate raw 16-bit value
                const raw = (inputArray[0] << 8) | inputArray[1];
                if (raw < 0 || raw > node.ADC_max) {
                    node.status({ fill: "red", shape: "ring", text: "raw value out of range" });
                    console.log(`error in thermistor-block node ${node.id}: raw=${raw} out of range [0, ${node.ADC_max}]`);
                    if (done) done();
                    return;
                }

                // Calculate voltage
                const voltage = (raw * node.Vref) / node.ADC_max;
                if (voltage >= node.Vsupply || voltage <= 0) {
                    node.status({ fill: "red", shape: "ring", text: "voltage out of range" });
                    console.log(`error in thermistor-block node ${node.id}: voltage=${voltage} out of range (0, ${node.Vsupply})`);
                    if (done) done();
                    return;
                }

                // Calculate thermistor resistance
                const R_thermistor = node.R_fixed * (voltage / (node.Vsupply - voltage));
                if (isNaN(R_thermistor) || R_thermistor < 0) {
                    node.status({ fill: "red", shape: "ring", text: "invalid resistance" });
                    console.log(`error in thermistor-block node ${node.id}: invalid resistance=${R_thermistor}`);
                    if (done) done();
                    return;
                }

                // Update context and status
                node.lastVoltage = voltage;
                node.lastResistance = R_thermistor;
                context.set("lastVoltage", node.lastVoltage);
                context.set("lastResistance", node.lastResistance);

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `volt: ${voltage.toFixed(2)}, res: ${R_thermistor.toFixed(2)}`
                });

                // Send outputs
                send([
                    { payload: voltage },
                    { payload: R_thermistor }
                ]);
                console.log(`processed thermistor-block node ${node.id}: voltage=${voltage.toFixed(2)} v, resistance=${R_thermistor.toFixed(2)} ohms`);

            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "calculation error" });
                console.error(`error in thermistor-block node ${node.id}: ${error.message}`);
                if (done) done(error);
                return;
            }

            if (done) done();
        });

        node.on("close", function (done) {
            node.status({});
            console.log(`closed thermistor-block node ${node.id}`);
            done();
        });
    }

    RED.nodes.registerType("thermistor-block", ThermistorBlockNode);

    // HTTP endpoint for editor reflection
    RED.httpAdmin.get("/thermistor-block/:id", RED.auth.needsPermission("thermistor-block.read"), function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (node && node.type === "thermistor-block") {
            res.json({
                name: node.name || "",
                R_fixed: node.R_fixed || 23500,
                Vsupply: node.Vsupply || 5.08,
                Vref: node.Vref || 4.096,
                ADC_max: node.ADC_max || 32768
            });
        } else {
            res.status(404).json({ error: "node not found" });
        }
    });
};