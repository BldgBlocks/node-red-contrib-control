const assert = require("assert");
const { helper, wait, waitForMessage } = require("./test-helpers");
const bridgeNode = require("../nodes/network-service-bridge");

function flow(overrides = {}) {
    return [
        { id: "f1", type: "tab" },
        {
            id: "bridge", z: "f1", type: "network-service-bridge",
            startupDelay: 0, requestTimeout: 25, wires: [["out"]], ...overrides
        },
        { id: "out", z: "f1", type: "helper" }
    ];
}

function captureEvent(RED, eventName) {
    return new Promise(resolve => RED.events.once(eventName, resolve));
}

describe("network-service-bridge", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("forwards requests during startup and marks their responses", function(done) {
        helper.load(bridgeNode, flow({ startupDelay: 1 }), async function() {
            try {
                const bridge = helper.getNode("bridge");
                const outbound = waitForMessage(helper.getNode("out"));
                const response = captureEvent(helper._RED, "pointReference:response");
                helper._RED.events.emit("pointReference:read", {
                    bridgeNodeId: "bridge", sourceNodeId: "reader", pointId: 3, requestId: "startup-read"
                });
                const request = await outbound;
                assert.strictEqual(request.action, "read");
                bridge.receive({
                    action: "read", requestId: request.requestId, value: 72,
                    network: { pointId: 3 }, status: { code: "ok" }
                });
                const result = await response;
                assert.strictEqual(result.value, 72);
                assert.strictEqual(result.isStartupPhase, true);
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("routes correlated remote errors for read, write, and discovery", function(done) {
        helper.load(bridgeNode, flow(), async function() {
            try {
                const bridge = helper.getNode("bridge");
                const out = helper.getNode("out");

                let outbound = waitForMessage(out);
                let response = captureEvent(helper._RED, "pointReference:response");
                helper._RED.events.emit("pointReference:read", {
                    bridgeNodeId: "bridge", sourceNodeId: "reader", pointId: 4, requestId: "read-error"
                });
                await outbound;
                bridge.receive({ action: "read", requestId: "read-error", pointId: 4, status: { code: "error", message: "offline" } });
                assert.strictEqual((await response).errorMessage, "offline");

                outbound = waitForMessage(out);
                response = captureEvent(helper._RED, "pointWrite:response");
                helper._RED.events.emit("pointWrite:write", {
                    bridgeNodeId: "bridge", sourceNodeId: "writer", pointId: 5,
                    priority: 8, value: 20, requestId: "write-error"
                });
                await outbound;
                bridge.receive({ action: "write", requestId: "write-error", pointId: 5, status: { code: "error", message: "denied" } });
                assert.strictEqual((await response).error, "denied");

                outbound = waitForMessage(out);
                response = captureEvent(helper._RED, "networkPointDiscover:response");
                helper._RED.events.emit("networkPointDiscover:request", {
                    bridgeNodeId: "bridge", sourceNodeId: "discoverer", requestId: "discover-error"
                });
                await outbound;
                bridge.receive({
                    action: "discover", requestId: "discover-error", networkProperties: {},
                    status: { code: "error", message: "unavailable" }
                });
                assert.strictEqual((await response).errorMessage, "unavailable");
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("notifies callers when read, write, and discovery requests time out", function(done) {
        helper.load(bridgeNode, flow(), async function() {
            try {
                await wait(5);
                const readResponse = captureEvent(helper._RED, "pointReference:response");
                const writeResponse = captureEvent(helper._RED, "pointWrite:response");
                const discoveryResponse = captureEvent(helper._RED, "networkPointDiscover:response");
                helper._RED.events.emit("pointReference:read", {
                    bridgeNodeId: "bridge", sourceNodeId: "reader", pointId: 6, requestId: "read-timeout"
                });
                helper._RED.events.emit("pointWrite:write", {
                    bridgeNodeId: "bridge", sourceNodeId: "writer", pointId: 7,
                    priority: 8, value: 20, requestId: "write-timeout"
                });
                helper._RED.events.emit("networkPointDiscover:request", {
                    bridgeNodeId: "bridge", sourceNodeId: "discoverer", requestId: "discover-timeout"
                });

                const [readResult, writeResult, discoveryResult] = await Promise.all([
                    readResponse, writeResponse, discoveryResponse
                ]);
                assert.strictEqual(readResult.errorMessage, "Read timeout");
                assert.strictEqual(writeResult.error, "Write timeout");
                assert.strictEqual(discoveryResult.errorMessage, "Discovery timeout");
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("reports statistics and clears them on request", function(done) {
        helper.load(bridgeNode, flow(), async function() {
            try {
                const bridge = helper.getNode("bridge");
                const out = helper.getNode("out");
                let message = waitForMessage(out);
                helper._RED.events.emit("pointReference:read", {
                    bridgeNodeId: "bridge", sourceNodeId: "reader", pointId: 8, requestId: "stats-read"
                });
                await message;
                bridge.receive({ action: "read", requestId: "stats-read", pointId: 8, value: 1, status: { code: "ok" } });

                message = waitForMessage(out);
                bridge.receive({ action: "getBridgeStats" });
                const stats = await message;
                assert.deepStrictEqual(stats.stats, { sent: 1, received: 1 });
                assert.strictEqual(stats.pendingCount, 0);

                bridge.receive({ action: "resetStats" });
                message = waitForMessage(out);
                bridge.receive({ action: "getBridgeStats" });
                assert.deepStrictEqual((await message).stats, { sent: 0, received: 0 });
                done();
            } catch (error) {
                done(error);
            }
        });
    });

    it("flushes pending callers and removes event listeners on close", function(done) {
        helper.load(bridgeNode, flow(), async function() {
            try {
                const RED = helper._RED;
                const eventNames = ["pointReference:read", "pointWrite:write", "networkPointDiscover:request"];
                const listenerCounts = eventNames.map(name => RED.events.listenerCount(name));
                const closedResponse = captureEvent(RED, "pointReference:response");
                RED.events.emit("pointReference:read", {
                    bridgeNodeId: "bridge", sourceNodeId: "reader", pointId: 9, requestId: "close-read"
                });

                await helper.unload();
                const result = await closedResponse;
                assert.strictEqual(result.errorMessage, "Bridge closed");
                eventNames.forEach((name, index) => {
                    assert.strictEqual(RED.events.listenerCount(name), listenerCounts[index] - 1);
                });
                done();
            } catch (error) {
                done(error);
            }
        });
    });
});
