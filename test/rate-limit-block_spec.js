const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const rateLimitNode = require("../nodes/rate-limit-block");

describe("rate-limit-block", function() {
    afterEach(() => helper.unload());

    it("uses separate up and down rates in rate-limit mode", function(done) {
        const flow = buildFlow("rate-limit-block", {
            mode: "rate-limit",
            rateUp: 1,
            rateDown: 5,
            interval: 100
        });

        helper.load(rateLimitNode, flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            (async () => {
                // Force ~1 second elapsed to make each immediate update deterministic.
                n1.currentValue = 0;
                n1.lastUpdate = Date.now() - 1000;
                const upPromise = waitForMessage(out, 1000);
                n1.receive({ payload: 10 });
                const upMsg = await upPromise;

                n1.currentValue = 10;
                n1.lastUpdate = Date.now() - 1000;
                const downPromise = waitForMessage(out, 1000);
                n1.receive({ payload: 0 });
                const downMsg = await downPromise;

                const upStep = upMsg.payload;
                const downStep = 10 - downMsg.payload;

                assert.ok(upStep > 0);
                assert.ok(downStep > 0);
                assert.ok(downStep > upStep * 3, `expected down step (${downStep}) > 3x up step (${upStep})`);
                done();
            })().catch(done);
        });
    });

    it("applies legacy rate context to both directions", function(done) {
        const flow = buildFlow("rate-limit-block", {
            mode: "rate-limit",
            rateUp: 2,
            rateDown: 3,
            interval: 100
        });

        helper.load(rateLimitNode, flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const n1 = helper.getNode("n1");
            n1.receive({ context: "rate", payload: 4.5 });

            assert.strictEqual(n1.rateUp, 4.5);
            assert.strictEqual(n1.rateDown, 4.5);
            done();
        });
    });
});
