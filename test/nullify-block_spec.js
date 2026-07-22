const assert = require("assert");
const { helper, buildFlow, waitForMessage, sendPayload } = require("./test-helpers");
const nullifyBlock = require("../nodes/nullify-block");

describe("nullify-block", function() {
    afterEach(() => helper.unload());

    it("outputs a new empty message when delete all is enabled", function(done) {
        const flow = buildFlow("nullify-block", { deleteAll: true });
        helper.load(nullifyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);

            node.receive({ payload: 42, topic: "source", nested: { value: true } });

            message.then(received => {
                assert.deepStrictEqual(Object.keys(received), ["_msgid"]);
                assert.strictEqual(typeof received._msgid, "string");
                done();
            }).catch(done);
        });
    });
});