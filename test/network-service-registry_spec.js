const assert = require("assert");
const EventEmitter = require("events");
const { helper } = require("./test-helpers");
const registryNode = require("../nodes/network-service-registry");

function createHttpHarness() {
    const routes = new Map();
    const nodes = new Map();
    let Constructor;
    const RED = {
        auth: { needsPermission: () => (req, res, next) => next() },
        httpAdmin: {
            get(path, permission, handler) {
                routes.set(path, handler);
            }
        },
        nodes: {
            createNode(node, config) {
                const emitter = new EventEmitter();
                node.id = config.id;
                node.name = config.name;
                node.on = emitter.on.bind(emitter);
                node.emit = emitter.emit.bind(emitter);
            },
            getNode(id) {
                return nodes.get(id);
            },
            registerType(type, constructor) {
                if (type === "network-service-registry") Constructor = constructor;
            }
        }
    };
    registryNode(RED);
    const registry = new Constructor({ id: "registry", name: "Main" });
    nodes.set("registry", registry);
    return { registry, routes };
}

function invoke(handler, params) {
    return new Promise(resolve => handler({ params }, { json: resolve }));
}

describe("network-service-registry", function() {
    afterEach(() => helper.unload());

    it("rejects duplicate owners while allowing updates from the owner", function(done) {
        helper.load(registryNode, [{ id: "registry", type: "network-service-registry", name: "Main" }], function() {
            const registry = helper.getNode("registry");
            assert.strictEqual(registry.register(10, { nodeId: "owner-1", path: "first" }), true);
            assert.strictEqual(registry.register(10, { nodeId: "owner-2", path: "collision" }), false);
            assert.strictEqual(registry.register(10, { nodeId: "owner-1", path: "updated" }), true);
            assert.strictEqual(registry.lookup(10).path, "updated");
            done();
        });
    });

    it("only allows the owning node to unregister a point", function(done) {
        helper.load(registryNode, [{ id: "registry", type: "network-service-registry", name: "Main" }], function() {
            const registry = helper.getNode("registry");
            registry.register(10, { nodeId: "owner-1", path: "point" });
            registry.unregister(10, "owner-2");
            assert.ok(registry.lookup(10));
            registry.unregister(10, "owner-1");
            assert.strictEqual(registry.lookup(10), undefined);
            done();
        });
    });

    ["12abc", "", -1, 1.5, null, undefined].forEach(pointId => {
        it(`rejects invalid point ID ${String(pointId)}`, function(done) {
            helper.load(registryNode, [{ id: "registry", type: "network-service-registry", name: "Main" }], function() {
                const registry = helper.getNode("registry");
                assert.strictEqual(registry.register(pointId, { nodeId: "owner" }), false);
                done();
            });
        });
    });

    it("lists deployed points and returns an empty undeployed list", async function() {
        const { registry, routes } = createHttpHarness();
        registry.register(2, { nodeId: "owner-2", path: "zone/two" });
        registry.register(1, { nodeId: "owner-1", path: "zone/one" });
        const handler = routes.get("/network-point-registry/list/:registryId");
        const deployed = await invoke(handler, { registryId: "registry" });
        assert.deepStrictEqual(deployed.map(point => point.id), [2, 1]);
        const undeployed = await invoke(handler, { registryId: "missing" });
        assert.deepStrictEqual(undeployed, []);
    });

    it("reports assigned, collision, available, invalid, and undeployed IDs", async function() {
        const { registry, routes } = createHttpHarness();
        registry.register(10, { nodeId: "owner-1", path: "zone/one" });
        const handler = routes.get("/network-point-registry/check/:registryId/:pointId/:nodeId");

        assert.strictEqual((await invoke(handler, { registryId: "registry", pointId: "10", nodeId: "owner-1" })).status, "assigned");
        assert.strictEqual((await invoke(handler, { registryId: "registry", pointId: "10", nodeId: "owner-2" })).status, "collision");
        assert.strictEqual((await invoke(handler, { registryId: "registry", pointId: "11", nodeId: "owner-2" })).status, "available");
        assert.strictEqual((await invoke(handler, { registryId: "registry", pointId: "invalid", nodeId: "owner-2" })).status, "invalid");
        assert.strictEqual((await invoke(handler, { registryId: "missing", pointId: "10", nodeId: "owner-1" })).status, "unavailable");
    });
});
