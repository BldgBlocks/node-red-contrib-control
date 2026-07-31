const assert = require("assert");
const { helper, buildFlow, sendTagged, waitForMessage } = require("./test-helpers");
const extremaBlock = require("../nodes/extrema-block");

describe("extrema-block", function() {
    afterEach(() => helper.unload());

    it("outputs the minimum across context-addressed virtual inputs", function(done) {
        const flow = buildFlow("extrema-block", { slots: 3, mode: "minimum", operationMode: "context" });
        helper.load(extremaBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const first = waitForMessage(output);
            sendTagged(node, "in1", 12);
            first.then(message => {
                assert.strictEqual(message.payload, 0);
                const second = waitForMessage(output);
                sendTagged(node, "in2", -3);
                return second;
            }).then(message => {
                assert.strictEqual(message.payload, -3);
                done();
            }).catch(done);
        });
    });

    it("outputs the maximum across mapped message properties", function(done) {
        const flow = buildFlow("extrema-block", {
            slots: 2,
            mode: "maximum",
            operationMode: "map",
            outputProperty: "result",
            mappings: [{ property: "supply", input: 1 }, { property: "return", input: 2 }]
        });
        helper.load(extremaBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const result = waitForMessage(output);
            node.receive({ supply: 48, return: 56 });
            result.then(message => {
                assert.strictEqual(message.result, 56);
                assert.strictEqual(message.payload, undefined);
                done();
            }).catch(done);
        });
    });
});