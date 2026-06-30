const assert = require("assert");
const { helper, buildFlow, sendTagged, waitForMessage } = require("./test-helpers");
const priorityNode = require("../nodes/priority-block");

describe("priority-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should accept string values in priority slots", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendTagged(n1, "priority3", "occupied");

            waitForMessage(out).then(msg => {
                assert.strictEqual(msg.payload, "occupied");
                assert.strictEqual(msg.diagnostics.activePriority, "priority3");
                done();
            }).catch(done);
        });
    });

    it("should treat string 'clear' as a normal slot value", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendTagged(n1, "priority2", "clear");

            waitForMessage(out).then(msg => {
                assert.strictEqual(msg.payload, "clear");
                assert.strictEqual(msg.diagnostics.activePriority, "priority2");
                done();
            }).catch(done);
        });
    });

    it("should relinquish slot on empty string payload", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendTagged(n1, "priority1", "on");

            waitForMessage(out).then(first => {
                assert.strictEqual(first.payload, "on");
                sendTagged(n1, "priority1", "");
                return waitForMessage(out);
            }).then(second => {
                assert.strictEqual(second.payload, null);
                assert.strictEqual(second.diagnostics.activePriority, null);
                done();
            }).catch(done);
        });
    });

    it("should clear all priority slots via context clear and keep fallback", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendTagged(n1, "priority1", "high");

            waitForMessage(out).then(() => {
                sendTagged(n1, "fallback", "fb");
                return waitForMessage(out);
            }).then(msg2 => {
                assert.strictEqual(msg2.payload, "high");
                assert.strictEqual(msg2.diagnostics.activePriority, "priority1");

                sendTagged(n1, "clear", true);
                return waitForMessage(out);
            }).then(msg3 => {
                assert.strictEqual(msg3.payload, "fb");
                assert.strictEqual(msg3.diagnostics.activePriority, "fallback");
                done();
            }).catch(done);
        });
    });

    it("should ignore runtime writes to default", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");

            sendTagged(n1, "default", "fixed-override-attempt");

            waitForMessage(out).then(msg => {
                assert.strictEqual(msg.payload, null);
                assert.strictEqual(msg.diagnostics.activePriority, null);
                done();
            }).catch(done);
        });
    });

    it("should reject object-based clear payloads", function(done) {
        const flow = buildFlow("priority-block");

        helper.load(priorityNode, flow, function() {
            const n1 = helper.getNode("n1");
            const statusEvents = [];

            n1.on("call:status", call => {
                if (call && call.args && call.args[0]) statusEvents.push(call.args[0]);
            });

            sendTagged(n1, "priority1", { clear: "all" });

            setTimeout(() => {
                const latest = statusEvents[statusEvents.length - 1] || {};
                assert.strictEqual(latest.fill, "red");
                assert.ok(String(latest.text || "").includes("invalid priority1"));
                done();
            }, 50);
        });
    });
});
