const assert = require("assert");
const { helper, buildFlow, sendTagged, waitForMessage, expectNoMessage } = require("./test-helpers");
const enumSelectNode = require("../nodes/enum-select");

function trackStatus(node) {
    const tracker = { last: null };
    node.on("call:status", (call) => {
        if (call && call.args && call.args[0]) {
            tracker.last = call.args[0];
        }
    });
    return tracker;
}

describe("enum-select", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should be loaded", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "unoccupied"]),
            selectedKey: "occupied"
        });

        helper.load(enumSelectNode, flow, function() {
            const n1 = helper.getNode("n1");
            assert.ok(n1);
            done();
        });
    });

    it("should emit the active key message and preserve properties", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "unoccupied"]),
            selectedKey: "occupied"
        });

        helper.load(enumSelectNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            waitForMessage(out).then(msg => {
                assert.strictEqual(msg.payload, 72);
                assert.strictEqual(msg.topic, "space-temp");
                assert.strictEqual(msg.context, "occupied");
                assert.strictEqual(msg.selectedKey, "occupied");
                done();
            }).catch(done);

            n1.receive({ context: "occupied", payload: 72, topic: "space-temp" });
        });
    });

    it("should cache inactive keys and emit cached message on switch change", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "unoccupied"]),
            selectedKey: "occupied"
        });

        helper.load(enumSelectNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            expectNoMessage(out, 200).then(() => {
                const pending = waitForMessage(out);
                sendTagged(n1, "switch", "unoccupied");
                return pending;
            }).then(msg => {
                assert.strictEqual(msg.payload, 65);
                assert.strictEqual(msg.topic, "cached-temp");
                assert.strictEqual(msg.context, "unoccupied");
                assert.strictEqual(msg.selectedKey, "unoccupied");
                done();
            }).catch(done);

            n1.receive({ context: "unoccupied", payload: 65, topic: "cached-temp" });
        });
    });

    it("should not emit when switch is set to the current key", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "unoccupied"]),
            selectedKey: "occupied"
        });

        helper.load(enumSelectNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const status = trackStatus(n1);

            sendTagged(n1, "switch", "occupied");

            expectNoMessage(out, 200).then(() => {
                assert.strictEqual(status.last.fill, "blue");
                assert.strictEqual(status.last.shape, "ring");
                assert.ok(status.last.text.includes("switch: occupied"));
                done();
            }).catch(done);
        });
    });

    it("should clear cached messages on reset", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "unoccupied"]),
            selectedKey: "occupied"
        });

        helper.load(enumSelectNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            n1.receive({ context: "unoccupied", payload: 65, topic: "cached-temp" });
            sendTagged(n1, "reset", true);
            sendTagged(n1, "switch", "unoccupied");

            expectNoMessage(out, 200).then(() => done()).catch(done);
        });
    });
});