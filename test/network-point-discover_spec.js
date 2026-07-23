const assert = require("assert");
const { helper, waitForMessage } = require("./test-helpers");
const discoveryNode = require("../nodes/network-point-discover");
const bridgeNode = require("../nodes/network-service-bridge");

describe("network-point-discover", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
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