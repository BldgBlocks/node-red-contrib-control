const assert = require("assert");
const { helper, buildFlow, waitForMessage, expectNoMessage, wait } = require("./test-helpers");
const onChangeNode = require("../nodes/on-change-block");

describe("on-change-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should send only changed values in on-change mode", function(done) {
        const flow = buildFlow("on-change-block", {
            mode: "on-change",
            inputProperty: "payload",
            period: 0,
            periodType: "num"
        });

        helper.load(onChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            waitForMessage(out, 300).then(msg => {
                assert.strictEqual(msg.payload, 10);
                n1.receive({ payload: 10 });
                return expectNoMessage(out, 150);
            }).then(() => {
                const next = waitForMessage(out, 300);
                n1.receive({ payload: 11 });
                return next;
            }).then(msg => {
                assert.strictEqual(msg.payload, 11);
                done();
            }).catch(done);

            n1.receive({ payload: 10 });
        });
    });

    it("should drop messages while the gate is closed in rate-limit mode", function(done) {
        const flow = buildFlow("on-change-block", {
            mode: "rate-limit",
            inputProperty: "payload",
            period: 100,
            periodType: "num"
        });

        helper.load(onChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            waitForMessage(out, 300).then(msg => {
                assert.strictEqual(msg.payload, 1);
                n1.receive({ payload: 2 });
                return expectNoMessage(out, 120);
            }).then(async () => {
                await wait(20);
                const next = waitForMessage(out, 300);
                n1.receive({ payload: 3 });
                return next;
            }).then(msg => {
                assert.strictEqual(msg.payload, 3);
                done();
            }).catch(done);

            n1.receive({ payload: 1 });
        });
    });

    it("should require a change after the gate reopens in on-change mode", function(done) {
        const flow = buildFlow("on-change-block", {
            mode: "on-change",
            inputProperty: "payload",
            period: 100,
            periodType: "num"
        });

        helper.load(onChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            waitForMessage(out, 300).then(msg => {
                assert.strictEqual(msg.payload, 1);
                n1.receive({ payload: 2 });
                return expectNoMessage(out, 120);
            }).then(async () => {
                await wait(20);
                n1.receive({ payload: 1 });
                return expectNoMessage(out, 150);
            }).then(() => {
                const next = waitForMessage(out, 300);
                n1.receive({ payload: 2 });
                return next;
            }).then(msg => {
                assert.strictEqual(msg.payload, 2);
                done();
            }).catch(done);

            n1.receive({ payload: 1 });
        });
    });

    it("should ignore the filter period in pass-through mode", function(done) {
        const flow = buildFlow("on-change-block", {
            mode: "pass-through",
            inputProperty: "payload",
            period: 100,
            periodType: "num"
        });

        helper.load(onChangeNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            waitForMessage(out, 300).then(async msg1 => {
                assert.strictEqual(msg1.payload, 1);
                await wait(20);
                const second = waitForMessage(out, 300);
                n1.receive({ payload: 1 });
                const msg2 = await second;
                assert.strictEqual(msg2.payload, 1);
                await wait(20);
                const third = waitForMessage(out, 300);
                n1.receive({ payload: 2 });
                const msg3 = await third;
                assert.strictEqual(msg3.payload, 2);
                done();
            }).catch(done);

            n1.receive({ payload: 1 });
        });
    });
});