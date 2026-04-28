const assert = require("assert");
const { helper, buildFlow, sendTagged, sendPayload, collectMessages, expectNoMessage, waitForMessage } = require("./test-helpers");
const pulseNode = require("../nodes/pulse-block");

describe("pulse-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should repeat false without treating it as empty", function(done) {
        const flow = buildFlow("pulse-block", {
            interval: 60,
            intervalUnits: "milliseconds"
        });

        helper.load(pulseNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            const promise = collectMessages(out, 2, 400);
            sendPayload(n1, false);

            promise.then((msgs) => {
                assert.strictEqual(msgs[0].payload, false);
                assert.strictEqual(msgs[1].payload, false);
                done();
            }).catch(done);
        });
    });

    it("should repeat zero without coercing it away", function(done) {
        const flow = buildFlow("pulse-block", {
            interval: 60,
            intervalUnits: "milliseconds"
        });

        helper.load(pulseNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            const promise = collectMessages(out, 2, 400);
            sendPayload(n1, 0);

            promise.then((msgs) => {
                assert.strictEqual(msgs[0].payload, 0);
                assert.strictEqual(msgs[1].payload, 0);
                done();
            }).catch(done);
        });
    });

    it("should update the cached value when a new payload arrives", function(done) {
        const flow = buildFlow("pulse-block", {
            interval: 120,
            intervalUnits: "milliseconds"
        });

        helper.load(pulseNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, true);

            waitForMessage(out, 200).then(() => {
                const promise = collectMessages(out, 2, 400);
                sendPayload(n1, false);
                return promise;
            }).then((msgs) => {
                assert.strictEqual(msgs[0].payload, false);
                assert.strictEqual(msgs[1].payload, false);
                done();
            }).catch(done);
        });
    });

    it("should stop and restart the repeater from the cached value", function(done) {
        const flow = buildFlow("pulse-block", {
            interval: 70,
            intervalUnits: "milliseconds"
        });

        helper.load(pulseNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, 1);

            waitForMessage(out, 200).then(() => {
                sendTagged(n1, "command", "stop");
                return expectNoMessage(out, 180);
            }).then(() => {
                const promise = collectMessages(out, 2, 400);
                sendTagged(n1, "command", "start");
                return promise;
            }).then((msgs) => {
                assert.strictEqual(msgs[0].payload, 1);
                assert.strictEqual(msgs[1].payload, 1);
                done();
            }).catch(done);
        });
    });

    it("should apply interval updates while running", function(done) {
        const flow = buildFlow("pulse-block", {
            interval: 50,
            intervalUnits: "milliseconds"
        });

        helper.load(pulseNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendPayload(n1, true);

            waitForMessage(out, 200).then(() => {
                n1.receive({ context: "interval", payload: 200, units: "milliseconds" });
                return expectNoMessage(out, 120);
            }).then(() => {
                return waitForMessage(out, 200);
            }).then((msg) => {
                assert.strictEqual(msg.payload, true);
                done();
            }).catch(done);
        });
    });
});