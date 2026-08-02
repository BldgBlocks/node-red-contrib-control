const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const roundBlock = require("../nodes/round-block");

describe("round-block", function() {
    afterEach(() => helper.unload());

    it("writes to payload by default", function(done) {
        const flow = buildFlow("round-block", { precision: "0.1" });

        helper.load(roundBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: 12.34, topic: "temperature" });
            message.then(result => {
                assert.strictEqual(result.payload, 12.3);
                assert.strictEqual(result.topic, "temperature");
                done();
            }).catch(done);
        });
    });

    it("writes to a nested output property without replacing the input", function(done) {
        const flow = buildFlow("round-block", {
            inputProperty: "source.value",
            outputProperty: "result.value",
            precision: "0.5"
        });

        helper.load(roundBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: 12.3 } });
            message.then(result => {
                assert.strictEqual(result.result.value, 12.5);
                assert.deepStrictEqual(result.source, { value: 12.3 });
                assert.strictEqual(result.payload, undefined);
                done();
            }).catch(done);
        });
    });
});