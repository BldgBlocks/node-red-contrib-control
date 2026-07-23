let resultsEndpointRegistered = false;

module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
    }

    function resultsPage(result) {
        const properties = result?.networkProperties || {};
        const rows = [];
        for (const [scope, paths] of Object.entries(properties)) {
            for (const [key, point] of Object.entries(paths || {})) {
                rows.push(`<tr><td>${escapeHtml(scope)}</td><td>${escapeHtml(point.store)}</td><td>${escapeHtml(point.registry)}</td><td>${escapeHtml(point.path || key)}</td><td>${escapeHtml(point.type)}</td><td>${escapeHtml(point.pointId)}</td><td>${escapeHtml(point.writable)}</td></tr>`);
            }
        }
        const body = rows.length ? rows.join("") : '<tr><td colspan="7">No network points discovered.</td></tr>';
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Network Point Discovery</title><style>body{font:14px sans-serif;margin:24px;color:#202124;background:#fff}h1{margin:0 0 6px}p{color:#5f6368;margin:0 0 20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #dadce0;padding:8px;text-align:left}th{background:#f1f3f4}tr:nth-child(even){background:#fafafa}@media (prefers-color-scheme:dark){body{color:#e8eaed;background:#202124}p{color:#bdc1c6}th,td{border-color:#5f6368}th{background:#303134}tr:nth-child(even){background:#292a2d}}</style></head><body><h1>Network Point Discovery</h1><p>${rows.length} point record${rows.length === 1 ? "" : "s"} found${result?.timestamp ? ` at ${escapeHtml(new Date(result.timestamp).toLocaleString())}` : ""}.</p><table><thead><tr><th>Scope</th><th>Store</th><th>Registry</th><th>Path</th><th>Type</th><th>Point ID</th><th>Writable</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    }

    if (!resultsEndpointRegistered && RED.httpAdmin) {
        resultsEndpointRegistered = true;
        RED.httpAdmin.get("/network-point-discover/:id/results", RED.auth.needsPermission("flows.read"), function(req, res) {
            const node = RED.nodes.getNode(req.params.id);
            if (!node || !node.discoveryResult) {
                res.status(404).send("No discovery results are available for this node.");
                return;
            }
            res.type("html").send(resultsPage(node.discoveryResult));
        });
    }

    function NetworkPointDiscoverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.bridgeNodeId = config.bridgeNodeId;
        node.pendingRequestId = null;
        node.discoveryResult = null;

        const triggerDiscovery = function() {
            if (node.pendingRequestId) {
                utils.setStatusWarn(node, "Discovery already pending");
                return;
            }
            if (!node.bridgeNodeId) {
                utils.setStatusError(node, "bridge missing");
                return;
            }
            const requestId = `${node.id}_discover_${Date.now()}`;
            node.pendingRequestId = requestId;
            RED.events.emit('networkPointDiscover:request', {
                sourceNodeId: node.id,
                bridgeNodeId: node.bridgeNodeId,
                requestId: requestId
            });
            utils.setStatusUnchanged(node, "Discovering network points...");
        };

        node.on("input", function(msg, send, done) {
            if (!msg || msg.action === undefined || msg.action === "discover") {
                triggerDiscovery();
            } else {
                send(msg);
            }
            if (done) done();
        });

        const responseHandler = function(data) {
            if (data.sourceNodeId !== node.id) {
                return;
            }
            if (data.requestId !== node.pendingRequestId) {
                return;
            }
            node.pendingRequestId = null;
            if (data.error) {
                utils.setStatusError(node, data.errorMessage || "Discovery failed");
                return;
            }
            node.discoveryResult = data.message;
            const count = Object.values(data.message.networkProperties || {})
                .reduce((total, paths) => total + Object.keys(paths || {}).length, 0);
            utils.setStatusChanged(node, `Discovered ${count} network points`);
            node.send({
                action: "discoverResult",
                payload: data.message.networkProperties || {},
                networkProperties: data.message.networkProperties || {},
                timestamp: data.timestamp
            });
        };

        RED.events.on('networkPointDiscover:response', responseHandler);
        node.on("close", function(done) {
            RED.events.off('networkPointDiscover:response', responseHandler);
            done();
        });
        utils.setStatusOK(node, "Ready to discover");
    }

    RED.nodes.registerType("network-point-discover", NetworkPointDiscoverNode);
};