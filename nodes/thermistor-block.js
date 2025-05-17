module.exports = function(RED) {
    function ThermistorBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            R_fixed: parseFloat(config.R_fixed) || 23500,
            Vsupply: parseFloat(config.Vsupply) || 5.08,
            Vref: parseFloat(config.Vref) || 4.096,
            ADC_max: parseFloat(config.ADC_max) || 32768,
            lastVoltage: context.get("lastVoltage") || 0,
            lastResistance: context.get("lastResistance") || 0
        };

        // Validate configuration
        if (isNaN(node.runtime.R_fixed) || node.runtime.R_fixed <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid r_fixed" });
            node.warn(`Invalid configuration: r_fixed=${node.runtime.R_fixed}`);
            return;
        }
        if (isNaN(node.runtime.Vsupply) || node.runtime.Vsupply <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid vsupply" });
            node.warn(`Invalid configuration: vsupply=${node.runtime.Vsupply}`);
            return;
        }
        if (isNaN(node.runtime.Vref) || node.runtime.Vref <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid vref" });
            node.warn(`Invalid configuration: vref=${node.runtime.Vref}`);
            return;
        }
        if (isNaN(node.runtime.ADC_max) || node.runtime.ADC_max <= 0) {
            node.status({ fill: "red", shape: "ring", text: "invalid adc_max" });
            node.warn(`Invalid configuration: adc_max=${node.runtime.ADC_max}`);
            return;
        }

        // Set initial status
        node.status({
            fill: "green",
            shape: "dot",
            text: `r_fixed: ${node.runtime.R_fixed}, vsupply: ${node.runtime.Vsupply}`
        });

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object") {
                node.status({ fill: "red", shape: "ring", text: "missing message" });
                node.warn(`Missing message`);
                if (done) done();
                return;
            }

            let inputArray;
            if (Buffer.isBuffer(msg.payload)) {
                if (msg.payload.length !== 2) {
                    node.status({ fill: "red", shape: "ring", text: "invalid input: expected 2-byte buffer" });
                    node.warn(`Invalid input: expected 2-byte buffer, got ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
                inputArray = [msg.payload[0], msg.payload[1]];
            } else if (typeof msg.payload === "object" && msg.payload.type === "Buffer" && Array.isArray(msg.payload.data) && msg.payload.data.length === 2) {
                inputArray = msg.payload.data;
                if (typeof inputArray[0] !== "number" || typeof inputArray[1] !== "number") {
                    node.status({ fill: "red", shape: "ring", text: "invalid input: expected numeric [highByte, lowByte]" });
                    node.warn(`Invalid input: expected numeric [highByte, lowByte], got ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
            } else if (Array.isArray(msg.payload) && msg.payload.length === 2 && typeof msg.payload[0] === "number" && typeof msg.payload[1] === "number") {
                inputArray = msg.payload;
            } else {
                node.status({ fill: "red", shape: "ring", text: "invalid input: expected [highByte, lowByte] or 2-byte buffer" });
                node.warn(`Invalid input: expected [highByte, lowByte] or 2-byte buffer, got ${JSON.stringify(msg.payload)}`);
                if (done) done();
                return;
            }

            try {
                // Calculate raw 16-bit value
                const raw = (inputArray[0] << 8) | inputArray[1];
                if (raw < 0 || raw > node.runtime.ADC_max) {
                    node.status({ fill: "red", shape: "ring", text: "raw value out of range" });
                    node.warn(`Raw value ${raw} out of range [0, ${node.runtime.ADC_max}]`);
                    if (done) done();
                    return;
                }

                // Calculate voltage
                const voltage = (raw * node.runtime.Vref) / node.runtime.ADC_max;
                if (voltage >= node.runtime.Vsupply || voltage <= 0) {
                    node.status({ fill: "red", shape: "ring", text: "voltage out of range" });
                    node.warn(`Voltage ${voltage} out of range (0, ${node.runtime.Vsupply})`);
                    if (done) done();
                    return;
                }

                // Calculate thermistor resistance
                const R_thermistor = node.runtime.R_fixed * (voltage / (node.runtime.Vsupply - voltage));
                if (isNaN(R_thermistor) || R_thermistor < 0) {
                    node.status({ fill: "red", shape: "ring", text: "invalid resistance" });
                    node.warn(`Invalid resistance ${R_thermistor}`);
                    if (done) done();
                    return;
                }

                // Check if outputs have changed
                const isUnchanged = voltage === node.runtime.lastVoltage && R_thermistor === node.runtime.lastResistance;
                node.status({
                    fill: "blue",
                    shape: isUnchanged ? "ring" : "dot",
                    text: `in: ${raw}, out: ${voltage.toFixed(2)}, ${R_thermistor.toFixed(2)}`
                });

                if (!isUnchanged) {
                    // Update context and runtime
                    node.runtime.lastVoltage = voltage;
                    node.runtime.lastResistance = R_thermistor;
                    context.set("lastVoltage", voltage);
                    context.set("lastResistance", R_thermistor);

                    // Send outputs
                    send([
                        { payload: voltage },
                        { payload: R_thermistor }
                    ]);
                }

            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: "calculation error" });
                node.warn(`Calculation error: ${error.message}`);
                if (done) done(error);
                return;
            }

            if (done) done();
        });

        node.on("close", function(done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType("thermistor-block", ThermistorBlockNode);
};