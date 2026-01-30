module.exports = function(RED) {
    const utils = require('./utils')(RED);
    function ThermistorBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const context = this.context();

        // Initialize runtime state
        // Initialize state
        node.name = config.name;
        node.R_fixed = parseFloat(config.R_fixed);
        node.Vsupply = parseFloat(config.Vsupply);
        node.Vref = parseFloat(config.Vref);
        node.ADC_max = parseFloat(config.ADC_max);
        node.lastVoltage = context.get("lastVoltage");
        node.lastResistance = context.get("lastResistance");

        // Validate configuration
        if (isNaN(node.R_fixed) || node.R_fixed <= 0) {
            utils.setStatusError(node, "invalid r_fixed");
            node.warn(`Invalid configuration: r_fixed=${node.R_fixed}`);
            return;
        }
        if (isNaN(node.Vsupply) || node.Vsupply <= 0) {
            utils.setStatusError(node, "invalid vsupply");
            node.warn(`Invalid configuration: vsupply=${node.Vsupply}`);
            return;
        }
        if (isNaN(node.Vref) || node.Vref <= 0) {
            utils.setStatusError(node, "invalid vref");
            node.warn(`Invalid configuration: vref=${node.Vref}`);
            return;
        }
        if (isNaN(node.ADC_max) || node.ADC_max <= 0) {
            utils.setStatusError(node, "invalid adc_max");
            node.warn(`Invalid configuration: adc_max=${node.ADC_max}`);
            return;
        }

        // Set initial status
        utils.setStatusOK(node, `r_fixed: ${node.R_fixed}, vsupply: ${node.Vsupply}`);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Validate input
            if (!msg || typeof msg !== "object") {
                utils.setStatusError(node, "missing message");
                node.warn(`Missing message`);
                if (done) done();
                return;
            }

            let inputArray;
            if (Buffer.isBuffer(msg.payload)) {
                if (msg.payload.length !== 2) {
                    utils.setStatusError(node, "invalid input: expected 2-byte buffer");
                    node.warn(`Invalid input: expected 2-byte buffer, got ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
                inputArray = [msg.payload[0], msg.payload[1]];
            } else if (typeof msg.payload === "object" && msg.payload.type === "Buffer" && Array.isArray(msg.payload.data) && msg.payload.data.length === 2) {
                inputArray = msg.payload.data;
                if (typeof inputArray[0] !== "number" || typeof inputArray[1] !== "number") {
                    utils.setStatusError(node, "invalid input: expected numeric [highByte, lowByte]");
                    node.warn(`Invalid input: expected numeric [highByte, lowByte], got ${JSON.stringify(msg.payload)}`);
                    if (done) done();
                    return;
                }
            } else if (Array.isArray(msg.payload) && msg.payload.length === 2 && typeof msg.payload[0] === "number" && typeof msg.payload[1] === "number") {
                inputArray = msg.payload;
            } else {
                utils.setStatusError(node, "invalid input: expected [highByte, lowByte] or 2-byte buffer");
                node.warn(`Invalid input: expected [highByte, lowByte] or 2-byte buffer, got ${JSON.stringify(msg.payload)}`);
                if (done) done();
                return;
            }

            try {
                // Calculate raw 16-bit value
                const raw = (inputArray[0] << 8) | inputArray[1];
                if (raw < 0 || raw > node.ADC_max) {
                    utils.setStatusError(node, "raw value out of range");
                    node.warn(`Raw value ${raw} out of range [0, ${node.ADC_max}]`);
                    if (done) done();
                    return;
                }

                // Calculate voltage
                const voltage = (raw * node.Vref) / node.ADC_max;
                if (voltage >= node.Vsupply || voltage <= 0) {
                    utils.setStatusError(node, "voltage out of range");
                    node.warn(`Voltage ${voltage} out of range (0, ${node.Vsupply})`);
                    if (done) done();
                    return;
                }

                // Calculate thermistor resistance
                const R_thermistor = node.R_fixed * (voltage / (node.Vsupply - voltage));
                if (isNaN(R_thermistor) || R_thermistor < 0) {
                    utils.setStatusError(node, "invalid resistance");
                    node.warn(`Invalid resistance ${R_thermistor}`);
                    if (done) done();
                    return;
                }

                // Check if outputs have changed
                const isUnchanged = voltage === node.lastVoltage && R_thermistor === node.lastResistance;
                if (isUnchanged) {
                    utils.setStatusUnchanged(node, `in: ${raw}, out: ${voltage.toFixed(2)}, ${R_thermistor.toFixed(2)}`);
                } else {
                    utils.setStatusChanged(node, `in: ${raw}, out: ${voltage.toFixed(2)}, ${R_thermistor.toFixed(2)}`);
                }

                if (!isUnchanged) {
                    // Update context and runtime
                    node.lastVoltage = voltage;
                    node.lastResistance = R_thermistor;
                    context.set("lastVoltage", voltage);
                    context.set("lastResistance", R_thermistor);

                    // Send outputs
                    send([
                        { payload: voltage },
                        { payload: R_thermistor }
                    ]);
                }

            } catch (error) {
                utils.setStatusError(node, "calculation error");
                node.warn(`Calculation error: ${error.message}`);
                if (done) done(error);
                return;
            }

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("thermistor-block", ThermistorBlockNode);
};