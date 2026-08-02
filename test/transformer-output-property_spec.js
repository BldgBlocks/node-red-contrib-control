const assert = require("assert");
const { helper, buildFlow, expectNoMessage, waitForMessage } = require("./test-helpers");
const convertBlock = require("../nodes/convert-block");
const interpolateBlock = require("../nodes/interpolate-block");
const scaleRangeBlock = require("../nodes/scale-range-block");

function expectOutput(nodeModule, type, config, input, verify, done) {
    const flow = buildFlow(type, config);
    helper.load(nodeModule, flow, function() {
        const node = helper.getNode("n1");
        const output = helper.getNode("out");
        const message = waitForMessage(output);
        node.receive(input);
        message.then(result => {
            verify(result);
            done();
        }).catch(done);
    });
}

describe("transformer output properties", function() {
    afterEach(() => helper.unload());

    it("convert writes to a nested output property and preserves its input", function(done) {
        expectOutput(convertBlock, "convert-block", {
            inputProperty: "source.value",
            outputProperty: "result.value",
            conversion: "C to F"
        }, { source: { value: 20 }, topic: "temperature" }, result => {
            assert.strictEqual(result.result.value, 68);
            assert.deepStrictEqual(result.source, { value: 20 });
            assert.strictEqual(result.topic, "temperature");
            assert.strictEqual(result.payload, undefined);
        }, done);
    });

    it("interpolate writes to a nested output property and preserves its input", function(done) {
        expectOutput(interpolateBlock, "interpolate-block", {
            inputProperty: "source.value",
            outputProperty: "result.value",
            points: JSON.stringify([{ x: 0, y: 0 }, { x: 100, y: 10 }])
        }, { source: { value: 50 }, topic: "position" }, result => {
            assert.strictEqual(result.result.value, 5);
            assert.deepStrictEqual(result.source, { value: 50 });
            assert.strictEqual(result.topic, "position");
            assert.strictEqual(result.payload, undefined);
        }, done);
    });

    it("scale range supports nested output and a reversed clamped range", function(done) {
        expectOutput(scaleRangeBlock, "scale-range-block", {
            inputProperty: "source.value",
            outputProperty: "result.value",
            inMin: 0,
            inMax: 100,
            outMin: 100,
            outMax: 0,
            clamp: true
        }, { source: { value: 25 }, topic: "damper" }, result => {
            assert.strictEqual(result.result.value, 75);
            assert.deepStrictEqual(result.source, { value: 25 });
            assert.strictEqual(result.topic, "damper");
            assert.strictEqual(result.payload, undefined);
        }, done);
    });

    it("interpolate supports strictly descending X coordinates", function(done) {
        expectOutput(interpolateBlock, "interpolate-block", {
            points: JSON.stringify([{ x: 100, y: 0 }, { x: 0, y: 10 }])
        }, { payload: 50 }, result => {
            assert.strictEqual(result.payload, 5);
        }, done);
    });

    it("interpolate rejects duplicate X coordinates", function(done) {
        const flow = buildFlow("interpolate-block", {
            points: JSON.stringify([{ x: 0, y: 0 }, { x: 0, y: 10 }])
        });
        helper.load(interpolateBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "points", payload: [{ x: 0, y: 0 }, { x: 0, y: 10 }] });
            expectNoMessage(output, 100).then(() => done()).catch(done);
        });
    });

    it("uses payload when a saved output property is blank", function(done) {
        expectOutput(convertBlock, "convert-block", {
            outputProperty: "",
            conversion: "C to F"
        }, { payload: 0 }, result => {
            assert.strictEqual(result.payload, 32);
        }, done);
    });
});
