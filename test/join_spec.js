const assert = require("assert");
const { helper, buildFlow, waitForMessage, expectNoMessage } = require("./test-helpers");
const joinNode = require("../nodes/join");

describe("bldgblocks-join", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should emit immediately once the key count is met", function(done) {
        const flow = buildFlow("bldgblocks-join", { count: 2, excludedKeys: "status" });

        helper.load(joinNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            n1.receive({ a: 1 });

            expectNoMessage(out, 200).then(() => {
                const messagePromise = waitForMessage(out, 500);
                n1.receive({ b: 2 });
                return messagePromise;
            }).then(msg => {
                assert.strictEqual(msg.a, 1);
                assert.strictEqual(msg.b, 2);
                done();
            }).catch(done);
        });
    });

    it("should cache values and only emit on trigger when trigger mode is selected", function(done) {
        const flow = buildFlow("bldgblocks-join", {
            count: 2,
            outputMode: "trigger",
            excludedKeys: "status"
        });

        helper.load(joinNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            n1.receive({ a: 1 });
            n1.receive({ b: 2 });

            expectNoMessage(out, 200).then(() => {
                const messagePromise = waitForMessage(out, 500);
                n1.receive({ context: "trigger" });
                return messagePromise;
            }).then(msg => {
                assert.strictEqual(msg.a, 1);
                assert.strictEqual(msg.b, 2);
                assert.strictEqual(msg.context, undefined);
                done();
            }).catch(done);
        });
    });

    it("should not emit on trigger before enough keys are cached", function(done) {
        const flow = buildFlow("bldgblocks-join", {
            count: 2,
            outputMode: "trigger",
            excludedKeys: "status"
        });

        helper.load(joinNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            n1.receive({ a: 1 });
            n1.receive({ context: "trigger" });

            expectNoMessage(out, 300).then(() => done()).catch(done);
        });
    });
});