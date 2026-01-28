module.exports = function(RED) {
    function FrequencyBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize runtime state
        node.runtime = {
            name: config.name || "",
            inputProperty: config.inputProperty || "payload",
            lastIn: false,
            lastEdge: 0,
            completeCycle: false,
            ppm: 0,
            pph: 0,
            ppd: 0,
            pulseHistory: [], // Array to store {start: timestamp, duration: ms}
            currentPulseStart: 0
        };

        node.status({ 
            fill: "green", 
            shape: "dot", 
            text: "awaiting first pulse" 
        });

        function calculateDutyCycle(now, currentInputValue) {
            const oneHourAgo = now - 3600000;
            
            // Clean up pulses older than 1 hour
            node.runtime.pulseHistory = node.runtime.pulseHistory.filter(pulse => {
                return (pulse.start + pulse.duration) > oneHourAgo;
            });

            let totalOnTime = 0;
            
            // Sum all pulse durations within the last hour
            node.runtime.pulseHistory.forEach(pulse => {
                const pulseEnd = pulse.start + pulse.duration;
                const effectiveStart = Math.max(pulse.start, oneHourAgo);
                const effectiveEnd = Math.min(pulseEnd, now);
                if (effectiveEnd > effectiveStart) {
                    totalOnTime += (effectiveEnd - effectiveStart);
                }
            });

            // Add current ongoing pulse if active
            if (currentInputValue && node.runtime.currentPulseStart > 0) {
                const currentPulseTime = Math.max(node.runtime.currentPulseStart, oneHourAgo);
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
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                if (done) done();
                return;
            }

            // Handle context updates
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    node.status({ fill: "red", shape: "ring", text: "missing payload for reset" });
                    if (done) done();
                    return;
                }
                if (msg.context === "reset") {
                    if (typeof msg.payload !== "boolean") {
                        node.status({ fill: "red", shape: "ring", text: "invalid reset" });
                        if (done) done();
                        return;
                    }
                    if (msg.payload === true) {
                        node.runtime.lastIn = false;
                        node.runtime.lastEdge = 0;
                        node.runtime.completeCycle = false;
                        node.runtime.ppm = 0;
                        node.runtime.pph = 0;
                        node.runtime.ppd = 0;
                        node.runtime.pulseHistory = [];
                        node.runtime.currentPulseStart = 0;
                        node.status({ fill: "green", shape: "dot", text: "reset" });
                    }
                    if (done) done();
                    return;
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "unknown context" });
                    if (done) done("Unknown context");
                    return;
                }
            }

            // Validate input payload
            const inputValue = RED.util.getMessageProperty(msg, node.runtime.inputProperty);
            if (typeof inputValue !== "boolean") {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                if (done) done();
                return;
            }

            const now = Date.now();

            // Track pulse edges for duty cycle
            if (inputValue && !node.runtime.lastIn) {
                // Rising edge - start new pulse
                node.runtime.currentPulseStart = now;
            } else if (!inputValue && node.runtime.lastIn) {
                // Falling edge - record completed pulse
                if (node.runtime.currentPulseStart > 0) {
                    const duration = now - node.runtime.currentPulseStart;
                    node.runtime.pulseHistory.push({
                        start: node.runtime.currentPulseStart,
                        duration: duration
                    });
                    node.runtime.currentPulseStart = 0;
                }
            }

            // Calculate duty cycle for the rolling hour
            const dutyData = calculateDutyCycle(now, inputValue);

            // Initialize output
            let output = {
                ppm: node.runtime.ppm,
                pph: node.runtime.pph,
                ppd: node.runtime.ppd,
                dutyCycle: dutyData.dutyCycle.toFixed(2),
                onTime: dutyData.onTime
            };

            // Detect rising edge
            if (inputValue && !node.runtime.lastIn) { 
                // Rising edge: true and lastIn was false
                if (!node.runtime.completeCycle) {
                    node.runtime.completeCycle = true;
                } else {
                    // Compute period in minutes
                    let periodMs = now - node.runtime.lastEdge;
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
                    node.runtime.ppm = output.ppm;
                    node.runtime.pph = output.pph;
                    node.runtime.ppd = output.ppd;
                }
                node.runtime.lastEdge = now;
                node.runtime.completeCycle = true;

                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `input: ${inputValue}, ppm: ${output.ppm.toFixed(2)}, pph: ${output.pph.toFixed(2)}, ppd: ${output.ppd.toFixed(2)}, duty: ${output.dutyCycle}%`
                });
                send({ payload: output });
            } else {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: `input: ${inputValue}, ppm: ${node.runtime.ppm.toFixed(2)}, pph: ${node.runtime.pph.toFixed(2)}, ppd: ${node.runtime.ppd.toFixed(2)}, duty: ${output.dutyCycle}%`
                });
            }

            // Update lastIn
            node.runtime.lastIn = inputValue;

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("frequency-block", FrequencyBlockNode);
};