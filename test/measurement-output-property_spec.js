const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const averageBlock = require("../nodes/average-block");
const frequencyBlock = require("../nodes/frequency-block");
const rateOfChangeBlock = require("../nodes/rate-of-change-block");

describe("measurement output properties", function() {
    afterEach(() => helper.unload());

    it("average preserves the message and writes to a nested output property", function(done) {
        const flow = buildFlow("average-block", {
            inputProperty: "source.value",
            outputProperty: "result.average",
            sampleSize: 3,
            minValid: -100,
            minValidType: "num",
            maxValid: 100,
            maxValidType: "num"
        });

        helper.load(averageBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: 12 }, topic: "temperature" });
            message.then(result => {
                assert.strictEqual(result.result.average, 12);
                assert.deepStrictEqual(result.source, { value: 12 });
                assert.strictEqual(result.topic, "temperature");
                assert.strictEqual(result.payload, undefined);
                done();
            }).catch(done);
        });
    });

    it("frequency preserves the message and writes statistics to a nested output property", function(done) {
        const flow = buildFlow("frequency-block", {
            inputProperty: "source.pulse",
            outputProperty: "result.frequency"
        });

        helper.load(frequencyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { pulse: true }, topic: "meter" });
            message.then(result => {
                assert.strictEqual(result.result.frequency.ppm, 0);
                assert.deepStrictEqual(result.source, { pulse: true });
                assert.strictEqual(result.topic, "meter");
                assert.strictEqual(result.payload, undefined);
                done();
            }).catch(done);
        });
    });

    it("rate of change preserves diagnostics and writes the rate to a nested output property", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            inputProperty: "source.value",
            outputProperty: "result.rate",
            sampleSize: 3,
            units: "seconds",
            algorithm: "linear-regression",
            minimumWindowSpan: 0,
            minValid: -100,
            minValidType: "num",
            maxValid: 100,
            maxValidType: "num"
        });

        helper.load(rateOfChangeBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ source: { value: 10 }, topic: "temperature", timestamp: 1000 });
            message.then(result => {
                assert.strictEqual(result.result.rate, 0);
                assert.deepStrictEqual(result.source, { value: 10 });
                assert.strictEqual(result.topic, "temperature");
                assert.strictEqual(result.samples, 1);
                assert.strictEqual(result.payload, undefined);
                done();
            }).catch(done);
        });
    });
});
