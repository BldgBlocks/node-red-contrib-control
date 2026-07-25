const assert = require("assert");
const { helper, waitForMessage } = require("./test-helpers");
const contextualLabelNode = require("../nodes/contextual-label-block");
const priorityNode = require("../nodes/priority-block");

describe("contextual-label-block", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should extract a nested property for a legacy priority input", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "label",
                z: "f1",
                type: "contextual-label-block",
                inputProperty: "payload.temperature",
                contextPropertyName: "priority15",
                wires: [["priority"]]
            },
            {
                id: "priority",
                z: "f1",
                type: "priority-block",
                operationMode: "context",
                wires: [["out"]]
            },
            { id: "out", z: "f1", type: "helper" }
        ];

        helper.load([contextualLabelNode, priorityNode], flow, function() {
            const label = helper.getNode("label");
            const out = helper.getNode("out");
            const promise = waitForMessage(out);

            label.receive({ payload: { temperature: 68.25 }, topic: "zone-2" });

            promise.then(msg => {
                assert.strictEqual(msg.payload, 68.25);
                assert.strictEqual(msg.topic, "zone-2");
                assert.strictEqual(msg.context, "priority15");
                assert.strictEqual(msg.diagnostics.activePriority, "priority15");
                done();
            }).catch(done);
        });
    });
});