const assert = require("assert");
const { helper, buildFlow, collectMessages, waitForMessage } = require("./test-helpers");

const arithmeticNodes = {
    "add-block": require("../nodes/add-block"),
    "subtract-block": require("../nodes/subtract-block"),
    "multiply-block": require("../nodes/multiply-block"),
    "divide-block": require("../nodes/divide-block"),
    "modulo-block": require("../nodes/modulo-block")
};

describe("arithmetic map mode", function() {
    afterEach(() => helper.unload());

    const cases = [
        ["add-block", 10, 12],
        ["subtract-block", 10, 8],
        ["multiply-block", 10, 20],
        ["divide-block", 10, 5],
        ["modulo-block", 0, 0]
    ];

    cases.forEach(([type, firstExpected, finalExpected]) => {
        it(`maps message properties for ${type}`, function(done) {
            const flow = buildFlow(type, {
                slots: 2,
                operationMode: "map",
                outputProperty: "result.value",
                mappings: [
                    { property: "first", input: 1 },
                    { property: "second", input: 2 }
                ]
            });

            helper.load(arithmeticNodes[type], flow, function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                const messages = collectMessages(output, 2);

                node.receive({ first: 10 });
                node.receive({ second: 2 });

                messages.then(results => {
                    assert.strictEqual(results[0].result.value, firstExpected);
                    assert.strictEqual(results[1].result.value, finalExpected);
                    assert.strictEqual(results[0].payload, undefined);
                    done();
                }).catch(done);
            });
        });
    });

    Object.entries(arithmeticNodes).forEach(([type, nodeModule]) => {
        it(`keeps existing ${type} configurations in context mode`, function(done) {
            const flow = buildFlow(type, { slots: 2 });

            helper.load(nodeModule, flow, function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                const message = waitForMessage(output);

                node.receive({ context: "in1", payload: 6 });
                message.then(result => {
                    assert.strictEqual(typeof result.payload, "number");
                    done();
                }).catch(done);
            });
        });
    });
});