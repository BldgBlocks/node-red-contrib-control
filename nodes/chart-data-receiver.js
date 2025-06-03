module.exports = function(RED) {
    function ChartDataReceiverNode(config) {
        RED.nodes.createNode(this, config);
        this.chartConfig = RED.nodes.getNode(config.chartConfig);
        this.seriesName = config.seriesName;
        this.storageType = config.storageType || 'memory';
        const node = this;

        node.on('input', function(msg) {

            // Validate configuration
            if (!node.chartConfig) {
                node.error("Missing chart configuration", msg);
                return;
            }
            if (!node.seriesName) {
                node.error("Missing series name", msg);
                return;
            }
            if (!node.chartConfig.name) {
                node.error("Missing bucket name in chart configuration", msg);
                return;
            }

            // Validate and process payload
            let payloadValue;
            try {
                payloadValue = parseFloat(msg.payload);
                if (isNaN(payloadValue)) {
                    node.warn(`Invalid payload value: ${msg.payload}`);
                    return;
                }
            } catch (e) {
                node.warn(`Payload parsing error: ${e.message}`);
                return;
            }

            // Construct line protocol
            const bucket = node.chartConfig.name;
            const formattedValue = payloadValue.toFixed(2);
            const msNow = new Date().getTime();
            const timestamp = msNow * 1e6;

            // Escape commas, spaces, and equals signs in seriesName
            const escapedSeriesName = node.seriesName.replace(/[, =]/g, '\\$&');
            const line = `sensor_data,seriesName=${escapedSeriesName} value=${formattedValue} ${timestamp}`;

            // Handle storage type
            if (node.storageType === 'memory') {
                const contextKey = `chart_data_${bucket}`;
                let bucketData = node.context().flow.get(contextKey) || [];
                bucketData.push(line);

                const maxMemoryBytes = (node.chartConfig.maxMemoryMb || 10) * 1024 * 1024;
                let totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                while (totalSize > maxMemoryBytes && bucketData.length > 0) {
                    bucketData.shift();
                    totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
                }

                node.context().flow.set(contextKey, bucketData);
            } else if (node.storageType === 'passthrough') {
                msg.payload = [line];
                msg.bucket = bucket;
                node.send(msg);
            } else if (node.storageType === 'custom') {
                msg.payload = { bucket, seriesName: node.seriesName, line };
                node.send(msg);
            }
        });
    }
    RED.nodes.registerType("chart-data-receiver", ChartDataReceiverNode);
};