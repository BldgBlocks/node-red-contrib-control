const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const andBlock = require("../nodes/and-block");
const orBlock = require("../nodes/or-block");

describe("boolean map-mode negation", function() {
    afterEach(() => helper.unload());

    it("inverts selected AND mappings", function(done) {
        const flow = buildFlow("and-block", {
            slots: 2,
            operationMode: "map",
            mappings: [
                { property: "enabled", input: 1 },
                { property: "disabled", input: 2, negate: true }
            ]
        });

        helper.load(andBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ enabled: true, disabled: false });
            message.then(result => {
                assert.strictEqual(result.payload, true);
                done();
            }).catch(done);
        });
    });

    it("inverts selected OR mappings", function(done) {
        const flow = buildFlow("or-block", {
            slots: 2,
            operationMode: "map",
            mappings: [{ property: "disabled", input: 1, negate: true }]
        });

        helper.load(orBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ disabled: false });
            message.then(result => {
                assert.strictEqual(result.payload, true);
                done();
            }).catch(done);
        });
    });
});