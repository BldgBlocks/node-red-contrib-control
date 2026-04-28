module.exports = function(RED) {
    const utils = require("./utils")(RED);

    function parsePositiveNumber(value, fallback) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function intervalToMs(value, units) {
        const interval = parsePositiveNumber(value, NaN);
        if (!Number.isFinite(interval)) {
            return NaN;
        }

        switch (units) {
            case "minutes":
                return interval * 60000;
            case "seconds":
                return interval * 1000;
            default:
                return interval;
        }
    }

    function formatPayload(payload) {
        if (typeof payload === "string") {
            return payload.length > 24 ? `${payload.slice(0, 21)}...` : payload;
        }

        if (payload === null) {
            return "null";
        }

        if (typeof payload === "object") {
            const json = JSON.stringify(payload);
            if (!json) {
                return "[object]";
            }
            return json.length > 24 ? `${json.slice(0, 21)}...` : json;
        }

        return String(payload);
    }

    function formatInterval(intervalMs) {
        if (intervalMs % 1000 === 0) {
            return `${(intervalMs / 1000).toFixed(2)}s`;
        }

        return `${intervalMs.toFixed(0)}ms`;
    }

    function PulseBlockNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;
        node.intervalUnits = config.intervalUnits || "seconds";
        node.intervalMs = intervalToMs(config.interval, node.intervalUnits);
        node.lastMsg = null;
        node.intervalId = null;

        if (!Number.isFinite(node.intervalMs) || node.intervalMs <= 0) {
            node.intervalUnits = "seconds";
            node.intervalMs = 1000;
            utils.setStatusError(node, "invalid interval");
        }

        function stopRepeater(statusText, useWarn = false) {
            if (node.intervalId) {
                clearInterval(node.intervalId);
                node.intervalId = null;
            }

            if (statusText) {
                if (useWarn) {
                    utils.setStatusWarn(node, statusText);
                } else {
                    utils.setStatusOK(node, statusText);
                }
            }
        }

        function emitCached() {
            if (!node.lastMsg) {
                utils.setStatusWarn(node, `idle, every: ${formatInterval(node.intervalMs)}`);
                return;
            }

            const outMsg = RED.util.cloneMessage(node.lastMsg);
            node.send(outMsg);
            utils.setStatusChanged(node, `out: ${formatPayload(outMsg.payload)}, every: ${formatInterval(node.intervalMs)}`);
        }

        function startRepeater(emitNow) {
            if (!node.lastMsg) {
                utils.setStatusWarn(node, `no cached input, every: ${formatInterval(node.intervalMs)}`);
                return false;
            }

            stopRepeater();
            node.intervalId = setInterval(emitCached, node.intervalMs);

            if (emitNow) {
                emitCached();
            } else {
                utils.setStatusOK(node, `armed: ${formatPayload(node.lastMsg.payload)}, every: ${formatInterval(node.intervalMs)}`);
            }

            return true;
        }

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg) {
                utils.setStatusError(node, "invalid message");
                if (done) {
                    done();
                }
                return;
            }

            if (msg.hasOwnProperty("context")) {
                if (!msg.hasOwnProperty("payload")) {
                    utils.setStatusError(node, `missing payload for ${msg.context}`);
                    if (done) {
                        done();
                    }
                    return;
                }

                if (typeof msg.context !== "string") {
                    utils.setStatusError(node, "invalid context");
                    if (done) {
                        done();
                    }
                    return;
                }

                switch (msg.context) {
                    case "interval": {
                        const nextUnits = msg.units || node.intervalUnits || "milliseconds";
                        const nextIntervalMs = intervalToMs(msg.payload, nextUnits);

                        if (!Number.isFinite(nextIntervalMs) || nextIntervalMs <= 0) {
                            utils.setStatusError(node, "invalid interval");
                            if (done) {
                                done();
                            }
                            return;
                        }

                        const wasRunning = !!node.intervalId;
                        node.intervalUnits = nextUnits;
                        node.intervalMs = nextIntervalMs;

                        if (wasRunning) {
                            startRepeater(false);
                        } else if (node.lastMsg) {
                            utils.setStatusOK(node, `cached: ${formatPayload(node.lastMsg.payload)}, every: ${formatInterval(node.intervalMs)}`);
                        } else {
                            utils.setStatusOK(node, `idle, every: ${formatInterval(node.intervalMs)}`);
                        }
                        break;
                    }
                    case "command": {
                        if (typeof msg.payload !== "string") {
                            utils.setStatusError(node, "invalid command");
                            if (done) {
                                done();
                            }
                            return;
                        }

                        const command = msg.payload.toLowerCase();
                        if (command === "start") {
                            startRepeater(true);
                        } else if (command === "stop") {
                            stopRepeater(`stopped, every: ${formatInterval(node.intervalMs)}`, true);
                        } else {
                            utils.setStatusError(node, "invalid command");
                            if (done) {
                                done();
                            }
                            return;
                        }
                        break;
                    }
                    case "reset": {
                        const validation = utils.validateBoolean(msg.payload);
                        if (!validation.valid) {
                            utils.setStatusError(node, validation.error);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        if (validation.value) {
                            node.lastMsg = null;
                            stopRepeater(`reset, every: ${formatInterval(node.intervalMs)}`, true);
                        }
                        break;
                    }
                    default:
                        utils.setStatusWarn(node, "unknown context");
                        if (done) {
                            done();
                        }
                        return;
                }

                if (done) {
                    done();
                }
                return;
            }

            if (!msg.hasOwnProperty("payload")) {
                utils.setStatusError(node, "missing payload");
                if (done) {
                    done();
                }
                return;
            }

            node.lastMsg = RED.util.cloneMessage(msg);
            startRepeater(true);

            if (done) {
                done();
            }
        });

        node.on("close", function(done) {
            stopRepeater();
            node.lastMsg = null;
            done();
        });
    }

    RED.nodes.registerType("pulse-block", PulseBlockNode);
};