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
