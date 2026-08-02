const assert = require("assert");
const { helper, waitForMessage } = require("./test-helpers");
const registryNode = require("../nodes/network-service-registry");
const registerNode = require("../nodes/network-point-register");

function flow(registerOverrides = {}) {
    return [
        { id: "f1", type: "tab" },
        { id: "registry", type: "network-service-registry", name: "Main" },
        {
            id: "point", z: "f1", type: "network-point-register",
            registry: "registry", pointId: "12", writable: true,
            wires: [["out"]], ...registerOverrides
        },
        { id: "out", z: "f1", type: "helper" }
    ];
}

describe("network-point-register", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("rejects a second node that claims an owned point ID", function(done) {
        const collisionFlow = flow();
        collisionFlow.splice(3, 0, {
            id: "collision", z: "f1", type: "network-point-register",
            registry: "registry", pointId: "12", writable: false, wires: []
        });
        helper.load([registryNode, registerNode], collisionFlow, function() {
            const registry = helper.getNode("registry");
            const owner = helper.getNode("point");
            const collision = helper.getNode("collision");
            assert.strictEqual(owner.isRegistered, true);
            assert.strictEqual(collision.isRegistered, false);
            assert.strictEqual(registry.lookup(12).nodeId, "point");
            done();
        });
    });

    it("enriches global state and emits updates on later passthroughs", function(done) {
        helper.load([registryNode, registerNode], flow(), async function() {
            try {
                const point = helper.getNode("point");
                const registry = helper.getNode("registry");
                const out = helper.getNode("out");
                point.context().global.set("zones/office/temp", {
                    value: 72,
                    activePriority: "fallback",
                    metadata: { path: "zones/office/temp", store: "default", type: "number" }
                });

                let response = waitForMessage(out);
                point.receive({
                    value: 72, activePriority: "fallback", units: "F",
                    metadata: { path: "zones/office/temp", store: "default", type: "number" }
                });
                const enriched = await response;
                assert.deepStrictEqual(enriched.network, { registry: "Main", pointId: 12, writable: true });
                assert.strictEqual(registry.lookup(12).path, "zones/office/temp");

                const update = new Promise(resolve => helper._RED.events.once("bldgblocks:network:point-update", resolve));
                response = waitForMessage(out);
                point.receive({
                    value: 73, activePriority: 8, units: "F",
                    metadata: { path: "zones/office/temp", store: "default", type: "number" }
                });
                const [passthrough, event] = await Promise.all([response, update]);
                assert.strictEqual(passthrough.value, 73);
                assert.strictEqual(event.pointId, 12);
                assert.strictEqual(event.value, 73);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("preserves registration on redeploy and unregisters on removal", function(done) {
        helper.load([registryNode, registerNode], flow(), async function() {
            try {
                const registry = helper.getNode("registry");
                const point = helper.getNode("point");
                const closeHandler = point._closeCallbacks[0];
                assert.ok(registry.lookup(12));

                await new Promise(resolve => closeHandler(false, resolve));
                assert.ok(registry.lookup(12));

                await new Promise(resolve => closeHandler(true, resolve));
                assert.strictEqual(registry.lookup(12), undefined);
                done();
            } catch (error) {
                done(error);
            }
        });
    });
});
