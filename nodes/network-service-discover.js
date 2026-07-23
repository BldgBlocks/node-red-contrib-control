module.exports = function(RED) {
    const utils = require('./utils')(RED);

    function NetworkServiceDiscoverNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.contextStores = String(config.contextStores || "default,persistent")
            .split(",")
            .map(store => store.trim())
            .filter((store, index, stores) => store && stores.indexOf(store) === index);

        node.on("input", function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            if (!msg || typeof msg !== "object") {
                utils.setStatusError(node, "invalid message");
                if (done) done();
                return;
            }
            if (msg.action !== "discover") {
                utils.setStatusWarn(node, "waiting for discover");
                if (done) done();
                return;
            }

            const networkProperties = {};
            const globalContext = node.context().global;

            for (const store of node.contextStores) {
                try {
                    const keys = globalContext.keys(store);
                    const properties = {};

                    for (const key of keys) {
                        const storedObject = globalContext.get(key, store);
                        if (!storedObject || typeof storedObject !== "object" ||
                            !Object.prototype.hasOwnProperty.call(storedObject, "metadata") ||
                            !Object.prototype.hasOwnProperty.call(storedObject, "network")) {
                            continue;
                        }

                        properties[key] = {
                            store: storedObject.metadata?.store,
                            registry: storedObject.network?.registry,
                            path: storedObject.metadata?.path,
                            type: storedObject.metadata?.type,
                            pointId: storedObject.network?.pointId,
                            writable: storedObject.network?.writable
                        };
                    }

                    if (Object.keys(properties).length > 0) {
                        networkProperties[store] = properties;
                    }
                } catch (error) {
                    // A configured context store may be unavailable on this runtime.
                }
            }

            const pointCount = Object.values(networkProperties)
                .reduce((count, properties) => count + Object.keys(properties).length, 0);
            msg.networkProperties = networkProperties;
            msg.timestamp = Date.now();
            utils.setStatusChanged(node, `Returned ${pointCount} network point${pointCount === 1 ? "" : "s"}`);
            send(msg);
            if (done) done();
        });

        utils.setStatusOK(node, "Ready to discover");
    }

    RED.nodes.registerType("network-service-discover", NetworkServiceDiscoverNode);
};