module.exports = function(RED) {
    function ChartConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.series = n.series || [];
        this.name = n.name ? n.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'default';
        this.maxMemoryMb = parseFloat(n.maxMemoryMb) || 10;

        // Handle clear history request
        this.on('clearHistory', function(callback) {
            const contextKey = `chart_data_${this.name}`;
            this.context().flow.set(contextKey, {});
            if (callback) callback();
        });
    }
    RED.nodes.registerType("chart-config", ChartConfigNode);
};