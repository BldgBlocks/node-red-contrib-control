const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const stringBuilderBlock = require("../nodes/string-builder-block");

describe("string-builder-block", function() {
    afterEach(() => helper.unload());

    it("preserves legacy four-field configurations", function(done) {
        const flow = buildFlow("string-builder-block", {
            in1: "one",
            in1Type: "str",
            in2: ",two",
            in2Type: "str",
            in3: ",three",
            in3Type: "str",
            in4: ",four",
            in4Type: "str"
        });

        helper.load(stringBuilderBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ topic: "legacy" });
            message.then(result => {
                assert.strictEqual(result.payload, "one,two,three,four");
                assert.strictEqual(result.topic, "legacy");
                done();
            }).catch(done);
        });
    });

    it("concatenates a dynamic number of typed entries in order", function(done) {
        const flow = buildFlow("string-builder-block", {
            entries: [
                { value: "start", type: "str" },
                { value: ",", type: "str" },
                { value: "source.value", type: "msg" },
                { value: ",middle", type: "str" },
                { value: ",end", type: "str" }
            ],
            outputProperty: "result.text"
        });

        helper.load(stringBuilderBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: "dynamic" }, topic: "preserved" });
            message.then(result => {
                assert.strictEqual(result.result.text, "start,dynamic,middle,end");
                assert.deepStrictEqual(result.source, { value: "dynamic" });
                assert.strictEqual(result.topic, "preserved");
                done();
            }).catch(done);
        });
    });

    it("updates any string entry by its inN context", function(done) {
        const flow = buildFlow("string-builder-block", {
            entries: [
                { value: "1", type: "str" },
                { value: "2", type: "str" },
                { value: "3", type: "str" },
                { value: "4", type: "str" },
                { value: "5", type: "str" }
            ]
        });

        helper.load(stringBuilderBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ context: "in5", payload: "updated" });
            message.then(result => {
                assert.strictEqual(result.payload, "1234updated");
                done();
            }).catch(done);
        });
    });

    it("allows a configured list to be empty without restoring legacy fields", function(done) {
        const flow = buildFlow("string-builder-block", {
            in1: "legacy",
            in1Type: "str",
            entries: [],
            entriesConfigured: true
        });

        helper.load(stringBuilderBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ topic: "empty" });
            message.then(result => {
                assert.strictEqual(result.payload, "");
                assert.strictEqual(result.topic, "empty");
                done();
            }).catch(done);
        });
    });
});
