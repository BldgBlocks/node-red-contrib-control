const assert = require("assert");
const { helper, buildFlow, waitForMessage, expectNoMessage } = require("./test-helpers");
const discoveryServiceNode = require("../nodes/network-service-discover");

describe("network-service-discover", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("returns registered network point metadata and preserves the request ID", function(done) {
        const flow = buildFlow("network-service-discover");

        helper.load(discoveryServiceNode, flow, async function() {
            try {
                const node = helper.getNode("n1");
                node.context().global.set("site/zone/temp", {
                    metadata: { store: "default", path: "site/zone/temp", type: "number" },
                    network: { registry: "Main", pointId: 17, writable: false }
                });
                node.context().global.set("not-a-point", { value: 42 });

                const resultPromise = waitForMessage(helper.getNode("out"));
                node.receive({ action: "discover", requestId: "request-17" });
                const result = await resultPromise;

                assert.strictEqual(result.action, "discover");
                assert.strictEqual(result.requestId, "request-17");
                assert.deepStrictEqual(result.networkProperties.default["site/zone/temp"], {
                    store: "default",
                    registry: "Main",
                    path: "site/zone/temp",
                    type: "number",
                    pointId: 17,
                    writable: false
                });
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("ignores messages that are not discovery requests", function(done) {
        const flow = buildFlow("network-service-discover");

        helper.load(discoveryServiceNode, flow, async function() {
            try {
                const node = helper.getNode("n1");
                const noMessage = expectNoMessage(helper.getNode("out"), 100);
                node.receive({ action: "read", requestId: "not-a-discovery" });
                await noMessage;
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("uses the context stores configured in the node editor", function(done) {
        const flow = buildFlow("network-service-discover", { contextStores: "default" });

        helper.load(discoveryServiceNode, flow, async function() {
            try {
                const node = helper.getNode("n1");
                assert.deepStrictEqual(node.contextStores, ["default"]);
                const resultPromise = waitForMessage(helper.getNode("out"));
                node.receive({ action: "discover", requestId: "configured-stores" });
                await resultPromise;
                done();
            } catch (error) {
                done(error);
            }
        });
    });
});