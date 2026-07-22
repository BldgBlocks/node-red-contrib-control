const assert = require("assert");
const { helper, buildFlow, sendPayload, waitForMessage } = require("./test-helpers");
const compareBlock = require("../nodes/compare-block");

describe("compare-block", function() {
    afterEach(() => helper.unload());

    it("keeps all three outputs enabled for existing flows", function(done) {
        const flow = buildFlow("compare-block", { setpoint: 10 }, "n1", 3);

        helper.load(compareBlock, flow, function() {
            const node = helper.getNode("n1");
            const messages = [
                waitForMessage(helper.getNode("out")),
                waitForMessage(helper.getNode("out2")),
                waitForMessage(helper.getNode("out3"))
            ];

            sendPayload(node, 12);

            Promise.all(messages).then(results => {
                assert.deepStrictEqual(results.map(msg => msg.payload), [true, false, false]);
                done();
            }).catch(done);
        });
    });

    it("emits selected comparisons in their configured port order", function(done) {
        const flow = buildFlow("compare-block", {
            setpoint: 10,
            greaterThan: false,
            equalTo: false,
            lessThan: true
        });

        helper.load(compareBlock, flow, function() {
            const node = helper.getNode("n1");
            const result = waitForMessage(helper.getNode("out"));

            sendPayload(node, 8);

            result.then(msg => {
                assert.strictEqual(msg.payload, true);
                done();
            }).catch(done);
        });
    });
});