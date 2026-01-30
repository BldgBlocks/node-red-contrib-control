module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function FrequencyBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize state
        node.name = config.name || "";
        node.inputProperty = config.inputProperty || "payload";
        node.lastIn = false;
        node.lastEdge = 0;
        node.completeCycle = false;
        node.ppm = 0;
        node.pph = 0;
        node.ppd = 0;
        node.pulseHistory = []; // Array to store {start: timestamp, duration: ms}
        node.currentPulseStart = 0;

        utils.setStatusOK(node, "awaiting first pulse");

        function calculateDutyCycle(now, currentInputValue) {
            const oneHourAgo = now - 3600000;
            
            // Clean up pulses older than 1 hour
            node.pulseHistory = node.pulseHistory.filter(pulse => {
                return (pulse.start + pulse.duration) > oneHourAgo;
            });

            let totalOnTime = 0;
            
            // Sum all pulse durations within the last hour
            node.pulseHistory.forEach(pulse => {
                const pulseEnd = pulse.start + pulse.duration;
                const effectiveStart = Math.max(pulse.start, oneHourAgo);
                const effectiveEnd = Math.min(pulseEnd, now);
                if (effectiveEnd > effectiveStart) {
                    totalOnTime += (effectiveEnd - effectiveStart);
                }
            });

            // Add current ongoing pulse if active
            if (currentInputValue && node.currentPulseStart > 0) {
                const currentPulseTime = Math.max(node.currentPulseStart, oneHourAgo);
                totalOnTime += (now - currentPulseTime);
            }

            return {
                dutyCycle: (totalOnTime / 3600000) * 100,
                onTime: totalOnTime
            };
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid message
            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload for reset");
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        utils.setStatusError(node, "invalid reset");
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        node.lastIn = false;
                        node.lastEdge = 0;
                        node.completeCycle = false;
                        node.ppm = 0;
                        node.pph = 0;
                        node.ppd = 0;
                        node.pulseHistory = [];
                        node.currentPulseStart = 0;
                        utils.setStatusOK(node, "reset");
                    }
                    if (done) done();
                    return;
                } else {
                    utils.setStatusWarn(node, "unknown context");
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Validate input payload
            let inputValue;
            try {
                inputValue = RED.util.getMessageProperty(msg, node.inputProperty);
            } catch (err) {
                inputValue = undefined;
            }
            if (typeof inputValue !== "boolean") {
                utils.setStatusError(node, "invalid or missing input property");
                if (done) done();
                return;
            }

            const now = Date.now();

            // Track pulse edges for duty cycle
            if (inputValue && !node.lastIn) {
                // Rising edge - start new pulse
                node.currentPulseStart = now;
            } else if (!inputValue && node.lastIn) {
                // Falling edge - record completed pulse
                if (node.currentPulseStart > 0) {
                    const duration = now - node.currentPulseStart;
                    node.pulseHistory.push({
                        start: node.currentPulseStart,
                        duration: duration
                    });
                    node.currentPulseStart = 0;
                }
            }

            // Calculate duty cycle for the rolling hour
            const dutyData = calculateDutyCycle(now, inputValue);

            // Initialize output
            let output = {
                ppm: node.ppm,
                pph: node.pph,
                ppd: node.ppd,
                dutyCycle: dutyData.dutyCycle.toFixed(2),
                onTime: dutyData.onTime
            };

            // Detect rising edge
            if (inputValue && !node.lastIn) { 
                // Rising edge: true and lastIn was false
                if (!node.completeCycle) {
                    node.completeCycle = true;
                } else {
                    // Compute period in minutes
                    let periodMs = now - node.lastEdge;
                    let periodMin = periodMs / 60000;
                    if (periodMin > 0.001) {
                        // Minimum 0.6ms period (1000 pulses/sec)
                        output.ppm = 1 / periodMin; // Pulses per minute
                        output.pph = output.ppm * 60; // Pulses per hour
                        output.ppd = output.ppm * 1440; // Pulses per day
                    } else {
                        // Handle ultra-high frequency
                        output.ppm = 1000;
                        output.pph = 60000;
                        output.ppd = 1440000;
                    }
                    node.ppm = output.ppm;
                    node.pph = output.pph;
                    node.ppd = output.ppd;
                }
                node.lastEdge = now;
                node.completeCycle = true;

                const edgeText = `input: ${inputValue}, ppm: ${output.ppm.toFixed(2)}, pph: ${output.pph.toFixed(2)}, ppd: ${output.ppd.toFixed(2)}, duty: ${output.dutyCycle}%`;
                utils.setStatusChanged(node, edgeText);
                send({ payload: output });
            } else {
                const noEdgeText = `input: ${inputValue}, ppm: ${node.ppm.toFixed(2)}, pph: ${node.pph.toFixed(2)}, ppd: ${node.ppd.toFixed(2)}, duty: ${output.dutyCycle}%`;
                utils.setStatusUnchanged(node, noEdgeText);
            }

            // Update lastIn
            node.lastIn = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("frequency-block", FrequencyBlockNode);
};