const assert = require("assert");
const { helper, buildFlow, collectMessages, wait } = require("./test-helpers");
const frequencyBlock = require("../nodes/frequency-block");

function measurePeriod(periodMs, verify, done) {
    const flow = buildFlow("frequency-block", {
        inputProperty: "source.pulse",
        outputProperty: "result.frequency"
    });
    helper.load(frequencyBlock, flow, function() {
        const node = helper.getNode("n1");
        const output = helper.getNode("out");
        const messages = collectMessages(output, 2);
        const originalDateNow = Date.now;
        let now = 1000;
        Date.now = () => now;

        node.receive({ source: { pulse: true } });
        now += periodMs / 2;
        node.receive({ source: { pulse: false } });
        now += periodMs / 2;
        node.receive({ source: { pulse: true } });

        messages.then(received => {
            verify(received[1].result.frequency);
            done();
        }).catch(done).finally(() => {
            Date.now = originalDateNow;
        });
    });
}

describe("frequency-block", function() {
    afterEach(() => helper.unload());

    it("measures a one millisecond period in consistent rate units", function(done) {
        measurePeriod(1, result => {
            assert.strictEqual(result.ppm, 60000);
            assert.strictEqual(result.pph, 3600000);
            assert.strictEqual(result.ppd, 86400000);
        }, done);
    });

    it("clamps sub-millisecond periods to one thousand pulses per second", function(done) {
        measurePeriod(0.5, result => {
            assert.strictEqual(result.ppm, 60000);
            assert.strictEqual(result.pph, 3600000);
            assert.strictEqual(result.ppd, 86400000);
        }, done);
    });

    it("reports a completed fifteen-minute pulse as twenty-five percent duty", function(done) {
        const flow = buildFlow("frequency-block");
        helper.load(frequencyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const originalDateNow = Date.now;
            let now = 1000;
            Date.now = () => now;
            const messages = collectMessages(output, 2);

            node.receive({ payload: true });
            now += 15 * 60 * 1000;
            node.receive({ payload: false });
            now += 45 * 60 * 1000;
            node.receive({ payload: true });

            messages.then(received => {
                assert.strictEqual(received[1].payload.dutyCycle, "25.00");
                assert.strictEqual(received[1].payload.onTime, 15 * 60 * 1000);
                done();
            }).catch(done).finally(() => {
                Date.now = originalDateNow;
            });
        });
    });

    it("clips pulse history to one hour for a maximum duty of one hundred percent", function(done) {
        const flow = buildFlow("frequency-block");
        helper.load(frequencyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const originalDateNow = Date.now;
            let now = 1000;
            Date.now = () => now;
            const messages = collectMessages(output, 2);

            node.receive({ payload: true });
            now += 2 * 60 * 60 * 1000;
            node.receive({ payload: false });
            node.receive({ payload: true });

            messages.then(received => {
                assert.strictEqual(received[1].payload.dutyCycle, "100.00");
                assert.strictEqual(received[1].payload.onTime, 60 * 60 * 1000);
                done();
            }).catch(done).finally(() => {
                Date.now = originalDateNow;
            });
        });
    });

    it("reset clears pulse rate and duty history", function(done) {
        const flow = buildFlow("frequency-block");
        helper.load(frequencyBlock, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const originalDateNow = Date.now;
            let now = 1000;
            Date.now = () => now;
            const messages = collectMessages(output, 3);

            node.receive({ payload: true });
            now += 1000;
            node.receive({ payload: false });
            now += 1000;
            node.receive({ payload: true });
            node.receive({ context: "reset", payload: true });
            now += 1000;
            node.receive({ payload: true });

            messages.then(received => {
                assert.ok(received[1].payload.ppm > 0);
                assert.deepStrictEqual(received[2].payload, {
                    ppm: 0,
                    pph: 0,
                    ppd: 0,
                    dutyCycle: "0.00",
                    onTime: 0
                });
                done();
            }).catch(done).finally(() => {
                Date.now = originalDateNow;
            });
        });
    });

    it("warns for an unknown context without reporting an error", function(done) {
        const flow = buildFlow("frequency-block");
        helper.load(frequencyBlock, flow, function() {
            const node = helper.getNode("n1");
            let reportedError = null;
            node.on("call:error", call => {
                reportedError = call.args[0];
            });
            node.receive({ context: "unknown", payload: true });
            wait(30).then(() => {
                assert.strictEqual(reportedError, null);
                done();
            }).catch(done);
        });
    });
});