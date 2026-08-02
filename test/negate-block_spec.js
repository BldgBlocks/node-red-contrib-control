const assert = require("assert");
const { helper, buildFlow, expectNoMessage, waitForMessage } = require("./test-helpers");
const negateBlock = require("../nodes/negate-block");

describe("negate-block", function() {
    afterEach(() => helper.unload());

    it("writes the negated value to the configured output property", function(done) {
        const flow = buildFlow("negate-block", {
            inputProperty: "source.value",
            outputProperty: "result.value"
        });

        helper.load(negateBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: 5 } });
            message.then(result => {
                assert.strictEqual(result.result.value, -5);
                assert.deepStrictEqual(result.source, { value: 5 });
                assert.strictEqual(result.payload, undefined);
                done();
            }).catch(done);
        });
    });

    it("negates boolean values and preserves message properties", function(done) {
        const flow = buildFlow("negate-block");
        helper.load(negateBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: false, topic: "enabled" });
            message.then(result => {
                assert.strictEqual(result.payload, true);
                assert.strictEqual(result.topic, "enabled");
                done();
            }).catch(done);
        });
    });

    [null, "5", { value: 5 }].forEach(value => {
        it(`rejects unsupported input ${JSON.stringify(value)}`, function(done) {
            const flow = buildFlow("negate-block");
            helper.load(negateBlock, flow, function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                node.receive({ payload: value });
                expectNoMessage(output, 50).then(() => done()).catch(done);
            });
        });
    });
});