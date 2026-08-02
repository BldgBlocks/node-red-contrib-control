const assert = require("assert");
const { helper, expectNoMessage, wait, waitForMessage } = require("./test-helpers");
const discoveryNode = require("../nodes/network-point-discover");
const bridgeNode = require("../nodes/network-service-bridge");

describe("network-point-discover", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    function singleFlow(overrides = {}) {
        return [
            { id: "f1", type: "tab" },
            {
                id: "discover", z: "f1", type: "network-point-discover",
                bridgeNodeId: "bridge", wires: [["discover-out"]], ...overrides
            },
            {
                id: "bridge", z: "f1", type: "network-service-bridge",
                startupDelay: 0, wires: [["bridge-out"]]
            },
            { id: "discover-out", z: "f1", type: "helper" },
            { id: "bridge-out", z: "f1", type: "helper" }
        ];
    }

    it("ignores duplicate triggers while discovery is pending", function(done) {
        helper.load([discoveryNode, bridgeNode], singleFlow(), async function() {
            try {
                const discover = helper.getNode("discover");
                const bridgeOut = helper.getNode("bridge-out");
                const requests = [];
                bridgeOut.on("input", msg => requests.push(msg));

                discover.receive({ action: "discover" });
                discover.receive({ action: "discover" });
                await wait(30);

                assert.strictEqual(requests.length, 1);
                assert.strictEqual(discover.pendingRequestId, requests[0].requestId);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("ignores stale responses and clears a correlated remote error", function(done) {
        helper.load([discoveryNode, bridgeNode], singleFlow(), async function() {
            try {
                const discover = helper.getNode("discover");
                const discoverOut = helper.getNode("discover-out");
                const request = waitForMessage(helper.getNode("bridge-out"));
                discover.receive({ action: "discover" });
                const requestId = (await request).requestId;

                helper._RED.events.emit("networkPointDiscover:response", {
                    sourceNodeId: "discover", requestId: "stale", error: false, message: { networkProperties: {} }
                });
                await expectNoMessage(discoverOut, 30);
                assert.strictEqual(discover.pendingRequestId, requestId);

                helper._RED.events.emit("networkPointDiscover:response", {
                    sourceNodeId: "discover", requestId, error: true, errorMessage: "Remote discovery failed"
                });
                assert.strictEqual(discover.pendingRequestId, null);
                assert.strictEqual(discover.discoveryResult, null);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("reports a missing bridge without creating a request", function(done) {
        helper.load(discoveryNode, singleFlow({ bridgeNodeId: "" }).filter(node => node.id !== "bridge" && node.id !== "bridge-out"), async function() {
            try {
                const discover = helper.getNode("discover");
                discover.receive({ action: "discover" });
                await wait(10);
                assert.strictEqual(discover.pendingRequestId, null);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("removes its discovery response listener on close", function(done) {
        helper.load(discoveryNode, singleFlow({ bridgeNodeId: "" }).filter(node => node.id !== "bridge" && node.id !== "bridge-out"), async function() {
            try {
                const RED = helper._RED;
                const eventName = "networkPointDiscover:response";
                const before = RED.events.listenerCount(eventName);
                await helper.unload();
                assert.strictEqual(RED.events.listenerCount(eventName), before - 1);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("allows separate discover nodes to route concurrent replies by request ID", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "discover-a", z: "f1", type: "network-point-discover",
                bridgeNodeId: "bridge", wires: [["discover-a-out"]]
            },
            {
                id: "discover-b", z: "f1", type: "network-point-discover",
                bridgeNodeId: "bridge", wires: [["discover-b-out"]]
            },
            {
                id: "bridge", z: "f1", type: "network-service-bridge",
                startupDelay: 0, wires: [["bridge-out"]]
            },
            { id: "discover-a-out", z: "f1", type: "helper" },
            { id: "discover-b-out", z: "f1", type: "helper" },
            { id: "bridge-out", z: "f1", type: "helper" }
        ];

        helper.load([discoveryNode, bridgeNode], flow, async function() {
            try {
                const discoverA = helper.getNode("discover-a");
                const discoverB = helper.getNode("discover-b");
                const bridge = helper.getNode("bridge");
                const bridgeOut = helper.getNode("bridge-out");
                const discoverAOut = helper.getNode("discover-a-out");
                const discoverBOut = helper.getNode("discover-b-out");
                const requests = [];
                const requestsPromise = new Promise((resolve) => {
                    bridgeOut.on("input", function(msg) {
                        requests.push(msg);
                        if (requests.length === 2) resolve(requests);
                    });
                });

                discoverA.receive({});
                discoverB.receive({});
                await requestsPromise;
                assert.ok(requests.every(request => request.action === "discover"));
                assert.notStrictEqual(requests[0].requestId, requests[1].requestId);

                const resultAPromise = waitForMessage(discoverAOut);
                const resultBPromise = waitForMessage(discoverBOut);
                bridge.receive({
                    action: "discover",
                    requestId: requests[1].requestId,
                    networkProperties: {
                        default: {
                            "furnace/outputs/heat": {
                                store: "default",
                                registry: "Main",
                                path: "furnace/outputs/heat",
                                type: "number",
                                pointId: 2,
                                writable: false
                            }
                        }
                    }
                });
                bridge.receive({
                    action: "discover",
                    requestId: requests[0].requestId,
                    networkProperties: { persistent: {} }
                });

                const [resultA, resultB] = await Promise.all([resultAPromise, resultBPromise]);
                const resultWithPoint = resultA.payload.default ? resultA : resultB;
                const emptyResult = resultA.payload.persistent ? resultA : resultB;
                assert.strictEqual(resultWithPoint.action, "discoverResult");
                assert.strictEqual(resultWithPoint.payload.default["furnace/outputs/heat"].pointId, 2);
                assert.deepStrictEqual(emptyResult.payload, { persistent: {} });
                done();
            } catch (error) {
                done(error);
            }
        });
    });
});