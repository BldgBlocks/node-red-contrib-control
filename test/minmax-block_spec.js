const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const minmaxBlock = require("../nodes/minmax-block");

describe("minmax-block", function() {
    afterEach(() => helper.unload());

    it("raises an input below the selected minimum", function(done) {
        const flow = buildFlow("minmax-block", { mode: "minimum", min: 12, minType: "num" });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const result = waitForMessage(output);
            node.receive({ payload: 5 });
            result.then(message => {
                assert.strictEqual(message.payload, 12);
                done();
            }).catch(done);
        });
    });

    it("lowers an input above the selected maximum", function(done) {
        const flow = buildFlow("minmax-block", { mode: "maximum", max: 56, maxType: "num" });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const result = waitForMessage(output);
            node.receive({ payload: 72 });
            result.then(message => {
                assert.strictEqual(message.payload, 56);
                done();
            }).catch(done);
        });
    });
});