module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function normalizeAlgorithm(value) {
        return value === "robust-slope" || value === "alpha-beta" ? value : "linear-regression";
    }

    function normalizeMinimumWindowSpan(value) {
        const parsed = parseFloat(value);
        return isNaN(parsed) || parsed < 0 ? 30 : parsed;
    }

    function getTimeScale(units) {
        switch (units) {
            case "seconds":
                return 1000;
            case "hours":
                return 1000 * 60 * 60;
            case "minutes":
            default:
                return 1000 * 60;
        }
    }

    function quantizeRate(rate, step = 0.01) {
        if (rate === null || !Number.isFinite(rate)) {
            return rate;
        }
        const quantized = Math.round(rate / step) * step;
        return Object.is(quantized, -0) ? 0 : quantized;
    }

    function median(values) {
        if (!values.length) {
            return 0;
        }

        const sorted = values.slice().sort((left, right) => left - right);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        }

        return sorted[middle];
    }

    function calculateLinearRegressionRate(samples, units) {
        if (samples.length < 2) {
            return {
                rawRate: 0,
                timeSpanUnits: 0
            };
        }

        const n = samples.length;
        const timeScale = getTimeScale(units);
        const baseTime = samples[0].timestamp;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;

        samples.forEach((sample) => {
            const x = (sample.timestamp - baseTime) / timeScale;
            const y = sample.value;

            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        });

        const timeSpanUnits = (samples[samples.length - 1].timestamp - samples[0].timestamp) / timeScale;
        const denominator = n * sumXX - sumX * sumX;

        if (Math.abs(denominator) > 1e-10) {
            return {
                rawRate: (n * sumXY - sumX * sumY) / denominator,
                timeSpanUnits
            };
        }

        return {
            rawRate: timeSpanUnits > 0 ? (samples[samples.length - 1].value - samples[0].value) / timeSpanUnits : 0,
            timeSpanUnits
        };
    }

    // Theil-Sen slope estimator.
    // Application here: the input has already been filtered upstream and may
    // still arrive as a quantized staircase. Using the median of all pairwise
    // slopes across the retained sample window produces a robust alternative
    // when one or two points would otherwise distort the recent trend.
    function calculateTheilSenRate(samples, units) {
        if (samples.length < 2) {
            return {
                rawRate: 0,
                timeSpanUnits: 0
            };
        }

        const timeScale = getTimeScale(units);
        const slopes = [];

        for (let startIndex = 0; startIndex < samples.length - 1; startIndex += 1) {
            for (let endIndex = startIndex + 1; endIndex < samples.length; endIndex += 1) {
                const deltaUnits = (samples[endIndex].timestamp - samples[startIndex].timestamp) / timeScale;
                if (!(deltaUnits > 0)) {
                    continue;
                }

                slopes.push((samples[endIndex].value - samples[startIndex].value) / deltaUnits);
            }
        }

        return {
            rawRate: median(slopes),
            timeSpanUnits: (samples[samples.length - 1].timestamp - samples[0].timestamp) / timeScale
        };
    }

    function createAlphaBetaState() {
        return {
            initialized: false,
            sampleCount: 0,
            lastTimestamp: null,
            estimatedValue: null,
            estimatedRate: 0,
            residual: 0,
            deltaUnits: 0
        };
    }

    function updateAlphaBetaState(state, inputValue, timestamp, units, sampleSize) {
        const span = Math.max(2, sampleSize);
        const alpha = (2 * ((2 * span) - 1)) / (span * (span + 1));
        const beta = 6 / (span * (span + 1));
        const timeScale = getTimeScale(units);

        if (!state.initialized) {
            return {
                rawRate: 0,
                state: {
                    initialized: true,
                    sampleCount: 1,
                    lastTimestamp: timestamp,
                    estimatedValue: inputValue,
                    estimatedRate: 0,
                    residual: 0,
                    deltaUnits: 0
                }
            };
        }

        const deltaUnits = (timestamp - state.lastTimestamp) / timeScale;
        if (!(deltaUnits > 0)) {
            return {
                rawRate: state.estimatedRate,
                state: {
                    ...state,
                    lastTimestamp: timestamp,
                    residual: 0,
                    deltaUnits: 0
                }
            };
        }

        if (state.sampleCount === 1) {
            return {
                rawRate: (inputValue - state.estimatedValue) / deltaUnits,
                state: {
                    initialized: true,
                    sampleCount: 2,
                    lastTimestamp: timestamp,
                    estimatedValue: inputValue,
                    estimatedRate: (inputValue - state.estimatedValue) / deltaUnits,
                    residual: 0,
                    deltaUnits
                }
            };
        }

        const predictedValue = state.estimatedValue + state.estimatedRate * deltaUnits;
        const residual = inputValue - predictedValue;
        const estimatedValue = predictedValue + alpha * residual;
        const estimatedRate = state.estimatedRate + (beta * residual) / deltaUnits;

        return {
            rawRate: estimatedRate,
            state: {
                initialized: true,
                sampleCount: state.sampleCount + 1,
                lastTimestamp: timestamp,
                estimatedValue,
                estimatedRate,
                residual,
                deltaUnits
            }
        };
    }

    function calculateRate(samples, units, algorithm, sampleSize) {
        if (algorithm === "robust-slope") {
            return calculateTheilSenRate(samples, units);
        }

        return calculateLinearRegressionRate(samples, units);
    }

    function RateOfChangeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.isBusy = false;
        
        // Initialize state
        node.maxSamples = parseInt(config.sampleSize);
        node.inputProperty = config.inputProperty || "payload";
        node.samples = []; // Array of {timestamp: Date, value: number}
        node.units = config.units || "minutes"; // minutes, seconds, hours
        node.algorithm = normalizeAlgorithm(config.algorithm);
        node.minimumWindowSpan = normalizeMinimumWindowSpan(config.minimumWindowSpan);
        node.lastRate = null;
        node.minValid = parseFloat(config.minValid);
        node.maxValid = parseFloat(config.maxValid);
        node.alphaBetaState = createAlphaBetaState();

        node.on("input", async function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            // Guard against invalid msg
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

                // Begin evaluations
                const evaluations = [];                    
                
                evaluations.push(
                    utils.requiresEvaluation(config.minValidType) 
                        ? utils.evaluateNodeProperty(config.minValid, config.minValidType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.minValid),
                );

                evaluations.push(
                    utils.requiresEvaluation(config.maxValidType) 
                        ? utils.evaluateNodeProperty(config.maxValid, config.maxValidType, node, msg)
                            .then(val => parseFloat(val))
                        : Promise.resolve(node.maxValid),
                );

                const results = await Promise.all(evaluations);   

                // Update runtime with evaluated values
                if (!isNaN(results[0])) node.minValid = results[0];
                if (!isNaN(results[1])) node.maxValid = results[1];   
            } catch (err) {
                node.error(`Error evaluating properties: ${err.message}`);
                if (done) done();
                return;
            } finally {
                // Release, all synchronous from here on
                node.isBusy = false;
            }

            // Acceptable fallbacks
            if (isNaN(node.maxSamples) || node.maxSamples < 2) {
                node.maxSamples = 10;
                utils.setStatusError(node, "invalid sample size, using 10");
            }

            // Validate values
            if (isNaN(node.maxValid) || isNaN(node.minValid) || node.maxValid <= node.minValid ) {
                utils.setStatusError(node, `invalid evaluated values ${node.minValid}, ${node.maxValid}`);
                if (done) done();
                return;
            }

            // Handle configuration messages
            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, "missing payload");
                    if (done) done();
                    return;
                }
                
                switch (msg.context) {
                    case "reset":
                        if (typeof msg.payload !== "boolean") {
                            utils.setStatusError(node, "invalid reset");
                            if (done) done();
                            return;
                        }
                        if (msg.payload === true) {
                            node.samples = [];
                            node.lastRate = null;
                            node.alphaBetaState = createAlphaBetaState();
                            utils.setStatusOK(node, "state reset");
                        }
                        break;
                        
                    case "sampleSize":
                        let newMaxSamples = parseInt(msg.payload);
                        if (isNaN(newMaxSamples) || newMaxSamples < 2) {
                            utils.setStatusError(node, "sample size must be at least 2");
                            if (done) done();
                            return;
                        }
                        node.maxSamples = newMaxSamples;
                        node.alphaBetaState = createAlphaBetaState();
                        // Trim samples if new window is smaller
                        if (node.samples.length > newMaxSamples) {
                            node.samples = node.samples.slice(-newMaxSamples);
                        }
                        utils.setStatusOK(node, `samples: ${newMaxSamples}`);
                        break;
                        
                    case "units":
                        const validUnits = ["seconds", "minutes", "hours"];
                        if (typeof msg.payload === "string" && validUnits.includes(msg.payload.toLowerCase())) {
                            node.units = msg.payload.toLowerCase();
                            node.alphaBetaState = createAlphaBetaState();
                            utils.setStatusOK(node, `units: ${msg.payload}`);
                        } else {
                            utils.setStatusError(node, "invalid units");
                        }
                        break;

                    case "algorithm":
                        if (msg.payload === "linear-regression" || msg.payload === "robust-slope" || msg.payload === "alpha-beta") {
                            node.algorithm = normalizeAlgorithm(msg.payload);
                            node.alphaBetaState = createAlphaBetaState();
                            utils.setStatusOK(node, `algorithm: ${msg.payload}`);
                        } else {
                            utils.setStatusError(node, "invalid algorithm");
                        }
                        break;

                    case "minimumWindowSpan": {
                        const parsedMinimumWindowSpan = parseFloat(msg.payload);
                        if (isNaN(parsedMinimumWindowSpan) || parsedMinimumWindowSpan < 0) {
                            utils.setStatusError(node, "invalid minimum window span");
                            if (done) done();
                            return;
                        }
                        node.minimumWindowSpan = normalizeMinimumWindowSpan(parsedMinimumWindowSpan);
                        utils.setStatusOK(node, `warmup: ${node.minimumWindowSpan}s`);
                        break;
                    }
                        
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        break;
                }                
                if (done) done();
                return;
            }

            // Check for missing payload
            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
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

            // Process input
            const inputValue = parseFloat(input);
            const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();
            
            if (isNaN(inputValue) || inputValue < node.minValid || inputValue > node.maxValid) {
                utils.setStatusWarn(node, "out of range");
                if (done) done();
                return;
            }

            // Add new sample
            node.samples.push({ timestamp: timestamp, value: inputValue });
            
            // Maintain sample window
            if (node.samples.length > node.maxSamples + 1) {
                node.samples = node.samples.slice(-node.maxSamples);
            } else if (node.samples.length > node.maxSamples) {
                node.samples.shift();
            }

            // Calculate rate of change (temperature per time unit)
            let rate = 0;
            let timeSpanUnits = 0;
            let rawRate = 0;
            const timeSpanSeconds = node.samples.length >= 2 ?
                (node.samples[node.samples.length - 1].timestamp - node.samples[0].timestamp) / 1000 : 0;

            let estimatedValue = inputValue;
            let residual = null;

            if (node.algorithm === "alpha-beta") {
                const alphaBetaUpdate = updateAlphaBetaState(node.alphaBetaState, inputValue, timestamp, node.units, node.maxSamples);
                node.alphaBetaState = alphaBetaUpdate.state || node.alphaBetaState;
                rawRate = alphaBetaUpdate.rawRate;
                timeSpanUnits = node.samples.length >= 2 ?
                    (node.samples[node.samples.length - 1].timestamp - node.samples[0].timestamp) / getTimeScale(node.units) : 0;
                estimatedValue = node.alphaBetaState.estimatedValue;
                residual = node.alphaBetaState.residual;
            } else {
                const calculation = calculateRate(node.samples, node.units, node.algorithm, node.maxSamples);
                rawRate = calculation.rawRate;
                timeSpanUnits = calculation.timeSpanUnits;
            }

            const isWarming = timeSpanSeconds < node.minimumWindowSpan;
            rate = isWarming ? 0 : quantizeRate(rawRate);

            const isUnchanged = rate === node.lastRate;

            // Send new message
            const unitsDisplay = {
                seconds: "/sec",
                minutes: "/min",
                hours: "/hr"
            };

            const statusText = isWarming
                ? `rate: ${rate.toFixed(2)} ${unitsDisplay[node.units] || "/min"} [warming ${Math.round(timeSpanSeconds)}/${node.minimumWindowSpan}s]`
                : `rate: ${rate.toFixed(2)} ${unitsDisplay[node.units] || "/min"}`;

            if (isUnchanged) {
                utils.setStatusUnchanged(node, statusText);
            } else {
                utils.setStatusChanged(node, statusText);
            }
            
            node.lastRate = rate;
            
            // Enhanced output with metadata
            const outputMsg = {
                payload: rate,
                rawRate: rawRate,
                samples: node.samples.length,
                units: `${unitsDisplay[node.units] || "/min"}`,
                currentValue: inputValue,
                timeSpan: timeSpanSeconds,
                timeSpanUnits: timeSpanUnits,
                estimatedValue: estimatedValue,
                residual: residual,
                method: node.algorithm,
                warming: isWarming,
                minimumWindowSpan: node.minimumWindowSpan
            };
            
            send(outputMsg);

            if (done) done();
        });

        node.on("close", function(done) {
            done();
        });
    }

    RED.nodes.registerType("rate-of-change-block", RateOfChangeNode);
};
