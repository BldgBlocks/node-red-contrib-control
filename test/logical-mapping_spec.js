const assert = require("assert");
const { helper, buildFlow, collectMessages, sendPayload, sendTagged } = require("./test-helpers");
const andBlock = require("../nodes/and-block");
const orBlock = require("../nodes/or-block");

describe("logical block mapping mode", function() {
    afterEach(() => helper.unload());

    it("updates AND inputs from mapped message properties", function(done) {
        const flow = buildFlow("and-block", {
            operationMode: "map",
            mappings: [{ property: "schedule", input: 1 }, { property: "override", input: 2 }]
        });
        helper.load(andBlock, flow, function() {
            const node = helper.getNode("n1");
            const messages = collectMessages(helper.getNode("out"), 2);

            node.receive({ schedule: true });
            node.receive({ override: true });

            messages.then(received => {
                assert.deepStrictEqual(received.map(message => message.payload), [false, true]);
                done();
            }).catch(done);
        });
    });

    it("allows multiple mapped properties to update one OR input", function(done) {
        const flow = buildFlow("or-block", {
            operationMode: "map",
            mappings: [{ property: "schedule", input: 1 }, { property: "override", input: 1 }]
        });
        helper.load(orBlock, flow, function() {
            const node = helper.getNode("n1");
            const messages = collectMessages(helper.getNode("out"), 2);

            node.receive({ schedule: false });
            node.receive({ override: true });

            messages.then(received => {
                assert.deepStrictEqual(received.map(message => message.payload), [false, true]);
                done();
            }).catch(done);
        });
    });

    it("preserves context routing for existing nodes", function(done) {
        const flow = buildFlow("or-block", { operationMode: "context" });
        helper.load(orBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = collectMessages(output, 1);

            sendTagged(node, "in2", true);

            message.then(received => {
                assert.strictEqual(received[0].payload, true);
                done();
            }).catch(done);
        });
    });
});