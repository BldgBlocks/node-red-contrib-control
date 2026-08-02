const assert = require("assert");
const { helper, buildFlow, collectMessages, waitForMessage } = require("./test-helpers");
const andBlock = require("../nodes/and-block");
const orBlock = require("../nodes/or-block");
const booleanSwitchBlock = require("../nodes/boolean-switch-block");
const latchBlock = require("../nodes/latch-block");

describe("shared boolean coercion", function() {
    afterEach(() => helper.unload());

    it("AND treats numeric zero as false and one as true", function(done) {
        const flow = buildFlow("and-block", { slots: 1, operationMode: "context" });
        helper.load(andBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const messages = collectMessages(output, 2);
            node.receive({ context: "in1", payload: 0 });
            node.receive({ context: "in1", payload: 1 });
            messages.then(received => {
                assert.deepStrictEqual(received.map(msg => msg.payload), [false, true]);
                done();
            }).catch(done);
        });
    });

    it("OR map mode treats the string false as false", function(done) {
        const flow = buildFlow("or-block", {
            slots: 1,
            operationMode: "map",
            mappings: [{ input: 1, property: "source.enabled", negate: false }]
        });
        helper.load(orBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { enabled: "false" } });
            message.then(result => {
                assert.strictEqual(result.payload, false);
                done();
            }).catch(done);
        });
    });

    it("boolean switch accepts numeric switch commands", function(done) {
        const flow = buildFlow("boolean-switch-block", {
            operationMode: "context",
            state: true
        }, "n1", 3);
        helper.load(booleanSwitchBlock, flow, function() {
            const node = helper.getNode("n1");
            const control = helper.getNode("out3");
            const message = waitForMessage(control);
            node.receive({ context: "switch", payload: 0 });
            message.then(result => {
                assert.strictEqual(result.payload, false);
                done();
            }).catch(done);
        });
    });

    it("latch accepts numeric set and reset signals", function(done) {
        const flow = buildFlow("latch-block", { state: false });
        helper.load(latchBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const messages = collectMessages(output, 2);
            node.receive({ context: "set", payload: 1 });
            node.receive({ context: "reset", payload: 1 });
            messages.then(received => {
                assert.deepStrictEqual(received.map(msg => msg.payload), [true, false]);
                done();
            }).catch(done);
        });
    });
});
