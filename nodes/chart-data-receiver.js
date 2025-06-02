module.exports = function(RED) {
    function ChartDataReceiverNode(config) {
        RED.nodes.createNode(this, config);
        this.chartConfig = RED.nodes.getNode(config.chartConfig);
        this.seriesName = config.seriesName;
        const node = this;

        node.on('input', function(msg) {
            node.log(`Received msg: ${JSON.stringify(msg)}`);
            if (!node.chartConfig) {
                node.error("No chart configuration defined");
                return;
            }
            if (!node.seriesName) {
                node.error("No series name selected");
                return;
            }

            const payloadValue = parseFloat(msg.payload);
            if (isNaN(payloadValue)) {
                node.warn(`Invalid payload: ${msg.payload}`);
                return;
            }

            const bucket = node.chartConfig.name || 'default';
            const contextKey = `chart_data_${bucket}`;
            const now = Date.now() / 1000;
            const dataPoint = { timestamp: now, value: payloadValue };

            let bucketData = node.context().flow.get(contextKey) || {};
            if (!bucketData[node.seriesName]) {
                bucketData[node.seriesName] = [];
            }

            bucketData[node.seriesName].push(dataPoint);

            const maxMemoryBytes = (node.chartConfig.maxMemoryMb || 10) * 1024 * 1024;
            let totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
            while (totalSize > maxMemoryBytes && Object.keys(bucketData).length > 0) {
                let oldestSeries = Object.keys(bucketData)[0];
                bucketData[oldestSeries].shift();
                if (bucketData[oldestSeries].length === 0) {
                    delete bucketData[oldestSeries];
                }
                totalSize = Buffer.byteLength(JSON.stringify(bucketData), 'utf8');
            }

            node.context().flow.set(contextKey, bucketData);
            node.log(`Stored data for ${bucket}/${node.seriesName}: ${JSON.stringify(dataPoint)}`);
        });
    }
    RED.nodes.registerType("chart-data-receiver", ChartDataReceiverNode);
};