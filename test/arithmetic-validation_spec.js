const assert = require("assert");
const { helper, buildFlow, wait, waitForMessage } = require("./test-helpers");

const arithmeticNodes = {
    "add-block": require("../nodes/add-block"),
    "subtract-block": require("../nodes/subtract-block"),
    "multiply-block": require("../nodes/multiply-block"),
    "divide-block": require("../nodes/divide-block"),
    "modulo-block": require("../nodes/modulo-block")
};

describe("arithmetic input validation", function() {
    afterEach(() => helper.unload());

    const cases = [
        ["add-block", 5],
        ["subtract-block", 5],
        ["multiply-block", 5],
        ["divide-block", 5],
        ["modulo-block", 0]
    ];

    cases.forEach(([type, expected]) => {
        it(`${type} rejects non-finite context input without changing state`, function(done) {
            const flow = buildFlow(type, { slots: 2, operationMode: "context" });
            helper.load(arithmeticNodes[type], flow, function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                const received = [];
                output.on("input", msg => received.push(msg));

                node.receive({ context: "in1", payload: Infinity });

                wait(30).then(() => {
                    assert.strictEqual(received.length, 0);
                    const message = waitForMessage(output);
                    node.receive({ context: "in1", payload: 5 });
                    return message;
                }).then(msg => {
                    assert.strictEqual(msg.payload, expected);
                    done();
                }).catch(done);
            });
        });
    });
});