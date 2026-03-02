const assert = require("assert");
const { helper, buildFlow, sendPayload, sendTagged, collectMessages, waitForMessage, expectNoMessage, wait } = require("./test-helpers");
const edgeNode = require("../nodes/edge-block");

describe("edge-block", function () {
    this.timeout(5000);

    afterEach(function (done) {
        helper.unload().then(() => done()).catch(done);
    });

    // ================================================================
    // Registration
    // ================================================================
    it("should register the node type", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            assert.ok(n1, "node should exist");
            assert.strictEqual(n1.type, "edge-block");
            done();
        });
    });

    // ================================================================
    // false-to-true transition
    // ================================================================
    it("should fire on false-to-true transition", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            out.on("input", function (msg) {
                assert.strictEqual(msg.edge, true);
                done();
            });

            sendPayload(n1, false);
            sendPayload(n1, true);
        });
    });

    it("should NOT fire on true-to-false when algorithm is false-to-true", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, true);
            sendPayload(n1, false);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });

    // ================================================================
    // true-to-false transition
    // ================================================================
    it("should fire on true-to-false transition", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "true-to-false" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            out.on("input", function (msg) {
                assert.strictEqual(msg.edge, true);
                done();
            });

            sendPayload(n1, true);
            sendPayload(n1, false);
        });
    });

    it("should NOT fire on false-to-true when algorithm is true-to-false", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "true-to-false" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, false);
            sendPayload(n1, true);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });

    // ================================================================
    // Message pass-through — original msg is forwarded
    // ================================================================
    it("should forward the original message with all properties", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            out.on("input", function (msg) {
                assert.strictEqual(msg.payload, true, "payload preserved");
                assert.strictEqual(msg.topic, "my/topic", "topic preserved");
                assert.strictEqual(msg.extra, 42, "extra property preserved");
                assert.strictEqual(msg.edge, true, "edge flag added");
                done();
            });

            n1.receive({ payload: false, topic: "my/topic", extra: 42 });
            n1.receive({ payload: true, topic: "my/topic", extra: 42 });
        });
    });

    it("should preserve nested msg properties through transition", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "true-to-false" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            out.on("input", function (msg) {
                assert.strictEqual(msg.payload, false, "payload preserved");
                assert.deepStrictEqual(msg.data, { temp: 72, mode: "heat" }, "nested data preserved");
                assert.strictEqual(msg.edge, true);
                done();
            });

            n1.receive({ payload: true, data: { temp: 72, mode: "heat" } });
            n1.receive({ payload: false, data: { temp: 72, mode: "heat" } });
        });
    });

    // ================================================================
    // No output on first message (no prior state)
    // ================================================================
    it("should not fire on the first message (no prior value)", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, true);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });

    // ================================================================
    // No output on repeated same value
    // ================================================================
    it("should not fire on repeated true values", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            let count = 0;
            out.on("input", function () { count++; });

            sendPayload(n1, false);
            sendPayload(n1, true);  // fires
            sendPayload(n1, true);  // should NOT fire again
            sendPayload(n1, true);  // should NOT fire again

            wait(300).then(function () {
                assert.strictEqual(count, 1, "should fire only once on the transition");
                done();
            }).catch(done);
        });
    });

    it("should not fire on repeated false values", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "true-to-false" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            let count = 0;
            out.on("input", function () { count++; });

            sendPayload(n1, true);
            sendPayload(n1, false);  // fires
            sendPayload(n1, false);  // should NOT fire again

            wait(300).then(function () {
                assert.strictEqual(count, 1, "should fire only once");
                done();
            }).catch(done);
        });
    });

    // ================================================================
    // Multiple transitions — fire each time
    // ================================================================
    it("should fire on each false→true transition", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            let count = 0;
            out.on("input", function () { count++; });

            sendPayload(n1, false);
            sendPayload(n1, true);   // fire 1
            sendPayload(n1, false);
            sendPayload(n1, true);   // fire 2
            sendPayload(n1, false);
            sendPayload(n1, true);   // fire 3

            wait(300).then(function () {
                assert.strictEqual(count, 3, "should fire on each transition");
                done();
            }).catch(done);
        });
    });

    // ================================================================
    // Non-boolean inputs — no output
    // ================================================================
    it("should not fire on non-boolean inputs", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, 0);
            sendPayload(n1, 1);
            sendPayload(n1, "true");
            sendPayload(n1, null);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });

    // ================================================================
    // Config: algorithm change via msg.context
    // ================================================================
    it("should change algorithm via context message", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            // Switch to true-to-false
            sendTagged(n1, "algorithm", "true-to-false");

            out.on("input", function (msg) {
                assert.strictEqual(msg.edge, true);
                assert.strictEqual(msg.payload, false);
                done();
            });

            sendPayload(n1, true);
            sendPayload(n1, false); // now fires because algorithm changed
        });
    });

    // ================================================================
    // Config: reset via msg.context
    // ================================================================
    it("should reset state via context message", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            // Establish state
            sendPayload(n1, false);

            // Reset
            sendTagged(n1, "reset", true);

            // Now send true — should NOT fire because prior state was cleared
            sendPayload(n1, true);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });

    it("should fire again after reset + new sequence", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, false);
            sendTagged(n1, "reset", true);

            out.on("input", function (msg) {
                assert.strictEqual(msg.edge, true);
                done();
            });

            // After reset: false establishes state, true triggers transition
            sendPayload(n1, false);
            sendPayload(n1, true);
        });
    });

    // ================================================================
    // Custom input property
    // ================================================================
    it("should read from custom input property", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true", inputProperty: "data.active" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            out.on("input", function (msg) {
                assert.strictEqual(msg.edge, true);
                assert.deepStrictEqual(msg.data, { active: true, info: "kept" });
                done();
            });

            n1.receive({ data: { active: false, info: "kept" } });
            n1.receive({ data: { active: true, info: "kept" } });
        });
    });

    // ================================================================
    // Missing input property
    // ================================================================
    it("should not fire when input property is missing", function (done) {
        const flow = buildFlow("edge-block", { algorithm: "false-to-true", inputProperty: "data.value" });
        helper.load(edgeNode, flow, function () {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, false);
            sendPayload(n1, true);

            expectNoMessage(out, 300).then(done).catch(done);
        });
    });
});
