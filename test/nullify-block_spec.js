const assert = require("assert");
const { helper, buildFlow, waitForMessage, sendPayload } = require("./test-helpers");
const nullifyBlock = require("../nodes/nullify-block");

describe("nullify-block", function() {
    afterEach(() => helper.unload());

    it("outputs a new empty message when delete all is enabled", function(done) {
        const flow = buildFlow("nullify-block", { deleteAll: true });
        helper.load(nullifyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);

            node.receive({ payload: 42, topic: "source", nested: { value: true } });

            message.then(received => {
                assert.deepStrictEqual(Object.keys(received), ["_msgid"]);
                assert.strictEqual(typeof received._msgid, "string");
                done();
            }).catch(done);
        });
    });

    it("nullifies configured nested properties while preserving the message", function(done) {
        const flow = buildFlow("nullify-block", {
            rules: [{ property: "source.value", propertyType: "msg" }]
        });
        helper.load(nullifyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: 42, units: "F" }, topic: "temperature" });
            message.then(received => {
                assert.deepStrictEqual(received.source, { value: null, units: "F" });
                assert.strictEqual(received.topic, "temperature");
                done();
            }).catch(done);
        });
    });

    it("creates a null value for a configured missing path", function(done) {
        const flow = buildFlow("nullify-block", {
            rules: [{ property: "source.value", propertyType: "msg" }]
        });
        helper.load(nullifyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ topic: "temperature" });
            message.then(received => {
                assert.strictEqual(received.source?.value, null);
                assert.strictEqual(received.topic, "temperature");
                done();
            }).catch(done);
        });
    });

    it("falls back to nullifying payload for an invalid configured rule", function(done) {
        const flow = buildFlow("nullify-block", {
            rules: [{ property: "source.value", propertyType: "flow" }]
        });
        helper.load(nullifyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            sendPayload(node, 42);
            message.then(received => {
                assert.strictEqual(received.payload, null);
                done();
            }).catch(done);
        });
    });
});