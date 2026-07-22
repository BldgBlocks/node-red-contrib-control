const assert = require("assert");
const { helper, buildFlow, collectMessages, sendPayload } = require("./test-helpers");
const accumulateBlock = require("../nodes/accumulate-block");

describe("accumulate-block", function() {
    afterEach(() => helper.unload());

    it("resets the deployed count through its runtime action", function(done) {
        const flow = buildFlow("accumulate-block", { mode: "flows" });
        helper.load(accumulateBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const messages = collectMessages(output, 3);

            sendPayload(node, "first");
            sendPayload(node, "second");
            const result = node.resetCount();
            sendPayload(node, "third");

            messages.then(received => {
                assert.strictEqual(result.count, 0);
                assert.deepStrictEqual(received.map(msg => msg.payload), [1, 2, 1]);
                done();
            }).catch(done);
        });
    });
});