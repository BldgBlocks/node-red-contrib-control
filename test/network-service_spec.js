const assert = require("assert");
const { helper, waitForMessage } = require("./test-helpers");
const registryNode = require("../nodes/network-service-registry");
const serviceNode = require("../nodes/network-service");

describe("network-service", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    function flow() {
        return [
            { id: "f1", type: "tab" },
            { id: "registry", type: "network-service-registry", name: "Main" },
            {
                id: "service", z: "f1", type: "network-service", registry: "registry",
                wires: [["out"]]
            },
            { id: "out", z: "f1", type: "helper" }
        ];
    }

    it("returns the documented help for a help action", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const service = helper.getNode("service");
                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "help" });
                const msg = await response;

                assert.ok(msg.payload.read.includes("pointId"));
                assert.ok(msg.payload.write.includes("priority"));
                assert.ok(msg.payload.discover.includes("Discover"));
                assert.ok(msg.payload.help.includes("Display"));
                assert.deepStrictEqual(msg.help, msg.payload);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("returns an empty discovery response for an empty registry", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const service = helper.getNode("service");
                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "discover", requestId: "discover-1" });
                const msg = await response;

                assert.strictEqual(msg.action, "discover");
                assert.strictEqual(msg.requestId, "discover-1");
                assert.deepStrictEqual(msg.networkProperties, {});
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("preserves the request envelope on successful reads", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                registry.register(0, { nodeId: "test", path: "points/zero", store: "default", writable: false });
                service.context().global.set("points/zero", {
                    value: 42,
                    metadata: { path: "points/zero", store: "default", type: "number" },
                    network: { pointId: 0, writable: false }
                });

                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "read", pointId: 0, requestId: "read-zero" });
                const msg = await response;

                assert.strictEqual(msg.action, "read");
                assert.strictEqual(msg.requestId, "read-zero");
                assert.strictEqual(msg.status.pointId, 0);
                assert.strictEqual(msg.value, 42);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("initializes missing metadata on a writable point", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                registry.register(5, { nodeId: "test", path: "points/five", store: "default", writable: true });
                service.context().global.set("points/five", {
                    priority: Array(17).fill(null),
                    fallback: 10,
                    defaultValue: 0
                });

                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "write", pointId: 5, priority: 8, value: 25 });
                const msg = await response;

                assert.strictEqual(msg.status.code, "ok");
                assert.strictEqual(msg.value, 25);
                assert.strictEqual(msg.activePriority, "8");
                assert.ok(msg.metadata.lastSet);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("rejects writes to read-only points", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                registry.register(6, { nodeId: "test", path: "points/six", store: "default", writable: false });

                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "write", pointId: 6, priority: 8, value: 25 });
                const msg = await response;

                assert.strictEqual(msg.status.code, "error");
                assert.ok(msg.status.message.includes("Not Writable"));
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("uses fallback after releasing the active priority", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                const out = helper.getNode("out");
                registry.register(7, { nodeId: "test", path: "points/seven", store: "default", writable: true });
                service.context().global.set("points/seven", {
                    priority: Array(17).fill(null),
                    fallback: 10,
                    defaultValue: 0,
                    metadata: { path: "points/seven", store: "default", type: "number" }
                });

                let response = waitForMessage(out);
                service.receive({ action: "write", pointId: 7, priority: "fallback", value: 15 });
                assert.strictEqual((await response).activePriority, "fallback");

                response = waitForMessage(out);
                service.receive({ action: "write", pointId: 7, priority: 8, value: 25 });
                assert.strictEqual((await response).activePriority, "8");

                response = waitForMessage(out);
                service.receive({ action: "write", pointId: 7, priority: 8, value: "null" });
                const released = await response;
                assert.strictEqual(released.value, 15);
                assert.strictEqual(released.activePriority, "fallback");
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("rejects values that do not match point metadata type", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                registry.register(8, { nodeId: "test", path: "points/eight", store: "default", writable: true });
                service.context().global.set("points/eight", {
                    priority: Array(17).fill(null),
                    fallback: 10,
                    metadata: { path: "points/eight", store: "default", type: "number" }
                });

                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "write", pointId: 8, priority: 8, value: "25" });
                const msg = await response;

                assert.strictEqual(msg.status.code, "error");
                assert.strictEqual(msg.status.message, "Type Mismatch: Expected number");
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("returns valid discovery entries while skipping incomplete points", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const service = helper.getNode("service");
                registry.register(9, { nodeId: "valid", path: "points/nine", store: "default", writable: true });
                registry.register(10, { nodeId: "incomplete", path: "points/ten", store: "default", writable: false });
                service.context().global.set("points/nine", {
                    metadata: { path: "points/nine", store: "default", type: "number" },
                    network: { registry: "Main", pointId: 9, writable: true }
                });
                service.context().global.set("points/ten", { value: 10 });

                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "discover" });
                const msg = await response;

                assert.deepStrictEqual(Object.keys(msg.networkProperties.default), ["points/nine"]);
                assert.strictEqual(msg.networkProperties.default["points/nine"].pointId, 9);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("reports an invalid action as an error response", function(done) {
        helper.load([registryNode, serviceNode], flow(), async function() {
            try {
                const service = helper.getNode("service");
                const response = waitForMessage(helper.getNode("out"));
                service.receive({ action: "unknown" });
                const msg = await response;

                assert.strictEqual(msg.status.code, "error");
                assert.strictEqual(msg.status.message, "Invalid or missing action");
                done();
            } catch (error) {
                done(error);
            }
        });
    });
});
