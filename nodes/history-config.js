module.exports = function(RED) {
    function HistoryConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.series = n.series || [];
        this.name = n.name ? n.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'default';
    }
    RED.nodes.registerType("history-config", HistoryConfigNode);
};