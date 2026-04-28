const assert = require("assert");
const { helper, buildFlow, collectMessages, waitForMessage, wait } = require("./test-helpers");
const rateOfChangeNode = require("../nodes/rate-of-change-block");

function trackStatus(node) {
    const tracker = { last: null };
    node.on("call:status", (call) => {
        if (call && call.args && call.args[0]) {
            tracker.last = call.args[0];
        }
    });
    return tracker;
}

describe("rate-of-change-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should default missing legacy config fields at runtime", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            sampleSize: 32,
            units: "minutes",
            minValid: -40,
            minValidType: "num",
            maxValid: 150,
            maxValidType: "num"
        });

        helper.load(rateOfChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const base = Date.UTC(2026, 0, 1, 0, 0, 0);

            waitForMessage(out, 1000).then((msg) => {
                assert.strictEqual(msg.payload, 0);
                assert.strictEqual(msg.method, "linear-regression");
                assert.strictEqual(msg.minimumWindowSpan, 30);
                assert.strictEqual(msg.warming, true);
                done();
            }).catch(done);

            n1.receive({
                payload: 70,
                timestamp: base
            });
        });
    });

    it("should emit immediately at 0.00 and settle a flat noisy signal near zero", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            sampleSize: 32,
            units: "minutes",
            algorithm: "linear-regression",
            minimumWindowSpan: 30,
            minValid: -40,
            minValidType: "num",
            maxValid: 150,
            maxValidType: "num"
        });

        helper.load(rateOfChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const status = trackStatus(n1);
            const base = Date.UTC(2026, 0, 1, 0, 0, 0);
            const values = Array.from({ length: 32 }, (_, index) => 70 + ((index % 4) - 1.5) * 0.004);

            (async () => {
                const outputPromise = collectMessages(out, values.length, 2000);

                for (let index = 0; index < values.length; index += 1) {
                    n1.receive({
                        payload: values[index],
                        timestamp: base + index * 4000
                    });
                    await wait(10);
                }

                const msgs = await outputPromise;
                const firstMsg = msgs[0];
                const lastMsg = msgs[msgs.length - 1];
                assert.strictEqual(firstMsg.payload, 0);
                assert.strictEqual(firstMsg.rawRate, 0);
                assert.strictEqual(firstMsg.warming, true);
                assert.strictEqual(firstMsg.samples, 1);
                assert.ok(Math.abs(lastMsg.payload) <= 0.01);
                assert.ok(Math.abs(lastMsg.rawRate) <= 0.03);
                assert.strictEqual(lastMsg.samples, 32);
                assert.strictEqual(lastMsg.timeSpan, 124);
                assert.strictEqual(lastMsg.warming, false);
                assert.ok(status.last.text.includes("0.00") || status.last.text.includes("0.01"));
                done();
            })().catch(done);
        });
    });

    it("should hold 0.00 during warmup and then converge to the linear-regression trend", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            sampleSize: 32,
            units: "minutes",
            algorithm: "linear-regression",
            minimumWindowSpan: 30,
            minValid: -40,
            minValidType: "num",
            maxValid: 150,
            maxValidType: "num"
        });

        helper.load(rateOfChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const base = Date.UTC(2026, 0, 1, 0, 0, 0);
            const values = Array.from({ length: 32 }, (_, index) => 70 + index * 0.004);

            (async () => {
                const outputPromise = collectMessages(out, values.length, 2000);

                for (let index = 0; index < values.length; index += 1) {
                    n1.receive({
                        payload: values[index],
                        timestamp: base + index * 4000
                    });
                    await wait(10);
                }

                const msgs = await outputPromise;
                const firstMsg = msgs[0];
                const warmupMsg = msgs[7];
                const firstLiveMsg = msgs[8];
                const lastMsg = msgs[msgs.length - 1];
                assert.strictEqual(firstMsg.payload, 0);
                assert.strictEqual(firstMsg.rawRate, 0);
                assert.strictEqual(warmupMsg.payload, 0);
                assert.strictEqual(warmupMsg.warming, true);
                assert.strictEqual(firstLiveMsg.warming, false);
                assert.ok(firstLiveMsg.payload > 0);
                assert.strictEqual(lastMsg.payload, 0.06);
                assert.ok(Math.abs(lastMsg.rawRate - 0.06) < 1e-9);
                assert.strictEqual(lastMsg.samples, 32);
                assert.strictEqual(lastMsg.timeSpan, 124);
                assert.ok(Math.abs(lastMsg.timeSpanUnits - (124 / 60)) < 1e-9);
                done();
            })().catch(done);
        });
    });

    it("should allow robust-slope mode to resist a single lower sample", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            sampleSize: 32,
            units: "minutes",
            algorithm: "robust-slope",
            minimumWindowSpan: 0,
            minValid: -40,
            minValidType: "num",
            maxValid: 150,
            maxValidType: "num"
        });

        helper.load(rateOfChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const base = Date.UTC(2026, 0, 1, 0, 0, 0);
            const risingValues = Array.from({ length: 32 }, (_, index) => 70 + index * 0.004);

            (async () => {
                let outputPromise = waitForMessage(out, 1000);

                for (let index = 0; index < risingValues.length; index += 1) {
                    n1.receive({
                        payload: risingValues[index],
                        timestamp: base + index * 4000
                    });
                    await wait(10);
                }

                await outputPromise;

                outputPromise = waitForMessage(out, 1000);
                n1.receive({
                    payload: risingValues[risingValues.length - 1] - 0.01,
                    timestamp: base + risingValues.length * 4000
                });

                const msg = await outputPromise;
                assert.ok(msg.rawRate > 0);
                assert.ok(msg.payload >= 0);
                assert.strictEqual(msg.method, "robust-slope");
                done();
            })().catch(done);
        });
    });

    it("should allow alpha-beta mode to build momentum on a steady ramp", function(done) {
        const flow = buildFlow("rate-of-change-block", {
            sampleSize: 32,
            units: "minutes",
            algorithm: "alpha-beta",
            minimumWindowSpan: 30,
            minValid: -40,
            minValidType: "num",
            maxValid: 150,
            maxValidType: "num"
        });

        helper.load(rateOfChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const base = Date.UTC(2026, 0, 1, 0, 0, 0);
            const values = Array.from({ length: 32 }, (_, index) => 70 + index * 0.004);

            (async () => {
                const msgsPromise = collectMessages(out, values.length, 2000);

                for (let index = 0; index < values.length; index += 1) {
                    n1.receive({
                        payload: values[index],
                        timestamp: base + index * 4000
                    });
                    await wait(10);
                }

                const msgs = await msgsPromise;
                const firstMsg = msgs[0];
                const lastMsg = msgs[msgs.length - 1];
                assert.strictEqual(firstMsg.payload, 0);
                assert.strictEqual(firstMsg.warming, true);
                assert.strictEqual(lastMsg.method, "alpha-beta");
                assert.strictEqual(lastMsg.warming, false);
                assert.ok(lastMsg.payload > 0);
                assert.ok(Math.abs(lastMsg.rawRate - 0.06) < 0.03);
                done();
            })().catch(done);
        });
    });
});