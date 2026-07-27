const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const booleanToNumberBlock = require("../nodes/boolean-to-number-block");

describe("boolean-to-number-block", function() {
    afterEach(() => helper.unload());

    it("writes the converted value back to the configured property", function(done) {
        const flow = buildFlow("boolean-to-number-block", { inputProperty: "state.enabled" });

        helper.load(booleanToNumberBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: "unchanged", state: { enabled: true } });
            message.then(result => {
                assert.strictEqual(result.state.enabled, 1);
                assert.strictEqual(result.payload, "unchanged");
                done();
            }).catch(done);
        });
    });
});