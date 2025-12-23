module.exports = function(RED) {
    function HistoryCollectorNode(config) {
        RED.nodes.createNode(this, config);
        this.historyConfig = RED.nodes.getNode(config.historyConfig);
        this.seriesName = config.seriesName;
        this.storageType = config.storageType || 'memory';
        this.tags = config.tags || '';
        const node = this;

        // Parse tags into key-value object
        function parseTags(tagsString) {
            if (!tagsString) return {};
            const tags = {};
            const pairs = tagsString.split(',').map(t => t.trim());
            tags["historyGroup"] = node.historyConfig.name;
            pairs.forEach((pair, index) => {
                if (pair.includes('=') || pair.includes(':')) {
                    const [key, value] = pair.includes('=') ? pair.split('=') : pair.split(':');
                    if (key && value) tags[key.trim()] = value.trim();
                } else {
                    tags[`tag${index}`] = pair;
                }
            });
            return tags;
        }

        node.on('input', function(msg) {
            // Guard against invalid message
            if (!msg) {
                node.status({ fill: "red", shape: "ring", text: "invalid message" });
                node.error('Invalid message received');
                return;
            }

            // Validate configuration
            if (!node.historyConfig) {
                node.status({ fill: "red", shape: "ring", text: "missing history config" });
                node.error('Missing history configuration', msg);
                return;
            }
            if (!node.seriesName) {
                node.status({ fill: "red", shape: "ring", text: "missing series name" });
                node.error('Missing series name', msg);
                return;
            }
            if (!node.historyConfig.name) {
                node.status({ fill: "red", shape: "ring", text: "missing bucket name" });
                node.error('Missing bucket name in history configuration', msg);
                return;
            }

            // Validate payload
            let payloadValue = msg.payload;
            let formattedValue;
            if (typeof payloadValue === 'number') {
                formattedValue = isNaN(payloadValue) ? null : payloadValue;
            } else if (typeof payloadValue === 'boolean') {
                formattedValue = payloadValue;
            } else if (typeof payloadValue === 'string') {
                formattedValue = payloadValue;
                if (payloadValue.endsWith('i') && !isNaN(parseInt(payloadValue))) {
                    formattedValue = parseInt(payloadValue); // Handle InfluxDB integer format
                }
            } else {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                node.warn(`Invalid payload type: ${typeof payloadValue}`);
                return;
            }

            if (formattedValue === null) {
                node.status({ fill: "red", shape: "ring", text: "invalid payload" });
                node.warn(`Invalid payload value: ${msg.payload}`);
                return;
            }

            // Construct line protocol
            const escapedMeasurementName = node.seriesName.replace(/[, =]/g, '\\$&');
            const msNow = Date.now();
            const timestamp = msNow * 1e6;
            const tagsObj = parseTags(node.tags);
            const tagsString = Object.entries(tagsObj)
                .map(([k, v]) => `${k.replace(/[, =]/g, '\\$&')}=${v.replace(/[, =]/g, '\\$&')}`)
                .join(',');
            const valueString = typeof formattedValue === 'string' ? `"${formattedValue}"` : formattedValue;
            const line = `${escapedMeasurementName}${tagsString ? ',' + tagsString : ''} value=${valueString} ${timestamp}`;

            // Set initial status
            node.status({ fill: "green", shape: "dot", text: "configuration received" });

            // Handle storage type
            if (node.storageType === 'memory') {
                const contextKey = `history_data_${node.historyConfig.name}`;
                let bucketData = node.context().global.get(contextKey) || [];
                bucketData.push(line);

                const maxMemoryBytes = (node.historyConfig.maxMemoryMb || 10) * 1024 * 1024;
                let totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                while (totalSize > maxMemoryBytes && bucketData.length > 0) {
                    bucketData.shift();
                    totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                }

                node.context().global.set(contextKey, bucketData);
                node.status({ fill: "blue", shape: "dot", text: `stored: ${valueString}` });
            } else if (node.storageType === 'lineProtocol') {
                msg.measurement = escapedMeasurementName;
                msg.payload = line;
                node.send(msg);
                node.status({ fill: "blue", shape: "dot", text: `sent: ${valueString}` });
            } else if (node.storageType === 'object') {
                msg.measurement = escapedMeasurementName;
                msg.payload = {
                    measurement: escapedMeasurementName,
                    tags: Object.entries(tagsObj).map(([k, v]) => `${k}=${v}`),
                    value: formattedValue,
                    timestamp: timestamp
                };
                node.send(msg);
                node.status({ fill: "blue", shape: "dot", text: `sent: ${valueString}` });
            } else if (node.storageType === 'objectArray') {
                msg.measurement = escapedMeasurementName;
                msg.timestamp = timestamp;
                msg.payload = [
                    { 
                        value: formattedValue 
                    },
                    tagsObj
                ]
                node.send(msg);
                node.status({ fill: "blue", shape: "dot", text: `sent: ${valueString}` });
            } else if (node.storageType === 'batchObject') {
                msg.payload = {
                    measurement: escapedMeasurementName,
                    timestamp: timestamp,
                    fields: { 
                        value: formattedValue 
                    },
                    tags: tagsObj
                }
                node.send(msg);
                node.status({ fill: "blue", shape: "dot", text: `sent: ${valueString}` });
            }
        });

        node.on("close", function(done) {
            done();
        });
    }
    RED.nodes.registerType("history-collector", HistoryCollectorNode);
};