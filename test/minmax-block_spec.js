const assert = require("assert");
const { helper, buildFlow, expectNoMessage, waitForMessage } = require("./test-helpers");
const minmaxBlock = require("../nodes/minmax-block");

describe("minmax-block", function() {
    afterEach(() => helper.unload());

    it("raises an input below the selected minimum", function(done) {
        const flow = buildFlow("minmax-block", { mode: "min", min: 12, minType: "num" });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const result = waitForMessage(output);
            node.receive({ payload: 5 });
            result.then(message => {
                assert.strictEqual(message.payload, 12);
                done();
            }).catch(done);
        });
    });

    it("lowers an input above the selected maximum", function(done) {
        const flow = buildFlow("minmax-block", { mode: "max", max: 56, maxType: "num" });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const result = waitForMessage(output);
            node.receive({ payload: 72 });
            result.then(message => {
                assert.strictEqual(message.payload, 56);
                done();
            }).catch(done);
        });
    });

    it("constrains inputs to the configured minimum and maximum range", function(done) {
        const flow = buildFlow("minmax-block", { mode: "minmax", min: 12, minType: "num", max: 56, maxType: "num" });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const belowRange = waitForMessage(output);
            node.receive({ payload: 5 });
            belowRange.then(message => {
                assert.strictEqual(message.payload, 12);
                const aboveRange = waitForMessage(output);
                node.receive({ payload: 72 });
                return aboveRange;
            }).then(message => {
                assert.strictEqual(message.payload, 56);
                done();
            }).catch(done);
        });
    });

    it("evaluates dynamic limits from the current message", function(done) {
        const flow = buildFlow("minmax-block", {
            mode: "minmax",
            min: "limits.low",
            minType: "msg",
            max: "limits.high",
            maxType: "msg"
        });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: 15, limits: { low: 20, high: 30 }, topic: "temperature" });
            message.then(result => {
                assert.strictEqual(result.payload, 20);
                assert.strictEqual(result.topic, "temperature");
                done();
            }).catch(done);
        });
    });

    it("applies valid runtime limit updates at the boundary", function(done) {
        const flow = buildFlow("minmax-block", {
            mode: "minmax",
            min: 0,
            minType: "num",
            max: 100,
            maxType: "num"
        });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "min", payload: 25 });
            const message = waitForMessage(output);
            node.receive({ payload: 25, topic: "boundary" });
            message.then(result => {
                assert.strictEqual(result.payload, 25);
                assert.strictEqual(result.topic, "boundary");
                done();
            }).catch(done);
        });
    });

    it("rejects an invalid runtime range without changing its limits", function(done) {
        const flow = buildFlow("minmax-block", {
            mode: "minmax",
            min: 0,
            minType: "num",
            max: 100,
            maxType: "num"
        });
        helper.load(minmaxBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "min", payload: 101 });
            expectNoMessage(output, 30).then(() => {
                const message = waitForMessage(output);
                node.receive({ payload: 50 });
                return message;
            }).then(result => {
                assert.strictEqual(result.payload, 50);
                done();
            }).catch(done);
        });
    });
});