const assert = require("assert");
const { helper, buildFlow, expectNoMessage, waitForMessage } = require("./test-helpers");
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

    it("replaces an existing context label", function(done) {
        const flow = buildFlow("contextual-label-block", {
            contextPropertyName: "in2",
            inputProperty: "source.value"
        });
        helper.load(contextualLabelNode, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ context: "in1", source: { value: 7 }, topic: "source" });
            message.then(msg => {
                assert.strictEqual(msg.context, "in2");
                assert.strictEqual(msg.payload, 7);
                assert.strictEqual(msg.topic, "source");
                done();
            }).catch(done);
        });
    });

    it("removes an existing context label", function(done) {
        const flow = buildFlow("contextual-label-block", { removeLabel: true });
        helper.load(contextualLabelNode, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ context: "in1", payload: 7 });
            message.then(msg => {
                assert.strictEqual(msg.context, undefined);
                assert.strictEqual(msg.payload, 7);
                done();
            }).catch(done);
        });
    });

    it("does not emit when a nested input property is missing", function(done) {
        const flow = buildFlow("contextual-label-block", { inputProperty: "source.value" });
        helper.load(contextualLabelNode, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ source: {} });
            expectNoMessage(output, 50).then(() => done()).catch(done);
        });
    });
});