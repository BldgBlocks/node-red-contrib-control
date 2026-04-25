const assert = require("assert");
const { helper, wait, waitForMessage, expectNoMessage } = require("./test-helpers");
const alarmCollectorNode = require("../nodes/alarm-collector");
const alarmConfigNode = require("../nodes/alarm-config");
const alarmServiceNode = require("../nodes/alarm-service");

function buildServiceFlow(overrides = {}) {
    return [
        { id: "f1", type: "tab" },
        { id: "ac1", z: "f1", type: "alarm-config", name: "test-registry" },
        {
            id: "collector",
            z: "f1",
            type: "alarm-collector",
            name: "attic-humidity",
            alarmConfig: "ac1",
            inputMode: "value",
            inputField: "value",
            inputFieldType: "msg",
            alarmWhenTrue: true,
            highThreshold: "50",
            lowThreshold: "10",
            compareMode: "either",
            hysteresisTime: "0.12",
            hysteresisTimeUnit: "seconds",
            hysteresisMagnitude: "2",
            priority: "high",
            topic: "Alarms_Default",
            title: "Alarm",
            onMessage: "The attic humidity is high/low",
            onMessageType: "str",
            offMessage: "The attic humidity is normal again",
            offMessageType: "str",
            tags: "",
            units: "%",
            sourceNodeType: "wired",
            wires: [],
            ...overrides
        },
        {
            id: "svc",
            z: "f1",
            type: "alarm-service",
            name: "alarm-relay",
            filterTopic: "",
            filterPriority: "",
            wires: [["out"]]
        },
        { id: "out", z: "f1", type: "helper" }
    ];
}

function sendValue(node, value) {
    node.receive({ value });
}

describe("alarm-service integration", function () {
    this.timeout(10000);

    afterEach(function (done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should not emit before hysteresis time elapses", function (done) {
        const flow = buildServiceFlow({ hysteresisTime: "0.16" });
        helper.load([alarmConfigNode, alarmCollectorNode, alarmServiceNode], flow, async function () {
            const collector = helper.getNode("collector");
            const out = helper.getNode("out");

            sendValue(collector, 55);

            await expectNoMessage(out, 120);

            const msg = await waitForMessage(out, 200);
            assert.strictEqual(msg.status.state, "active");
            assert.strictEqual(msg.alarm.state, true);
            done();
        });
    });

    it("should emit one active message for repeated above-threshold updates", function (done) {
        const flow = buildServiceFlow({ hysteresisTime: "0.1" });
        helper.load([alarmConfigNode, alarmCollectorNode, alarmServiceNode], flow, async function () {
            const collector = helper.getNode("collector");
            const out = helper.getNode("out");

            sendValue(collector, 55);
            const activeMsg = await waitForMessage(out, 250);
            assert.strictEqual(activeMsg.status.state, "active");

            sendValue(collector, 58);
            sendValue(collector, 61);
            sendValue(collector, 57);

            await expectNoMessage(out, 180);
            done();
        });
    });

    it("should not emit a clear message when the value briefly dips below the band", function (done) {
        const flow = buildServiceFlow({ hysteresisTime: "0.14", compareMode: "high-only", hysteresisMagnitude: "0" });
        helper.load([alarmConfigNode, alarmCollectorNode, alarmServiceNode], flow, async function () {
            const collector = helper.getNode("collector");
            const out = helper.getNode("out");

            sendValue(collector, 55);
            const activeMsg = await waitForMessage(out, 250);
            assert.strictEqual(activeMsg.status.state, "active");

            sendValue(collector, 45);
            await wait(60);
            sendValue(collector, 56);

            await expectNoMessage(out, 220);
            done();
        });
    });

    it("should emit active then cleared when both transitions persist long enough", function (done) {
        const flow = buildServiceFlow({ hysteresisTime: "0.1", compareMode: "high-only" });
        helper.load([alarmConfigNode, alarmCollectorNode, alarmServiceNode], flow, async function () {
            const collector = helper.getNode("collector");
            const out = helper.getNode("out");

            sendValue(collector, 55);
            const activeMsg = await waitForMessage(out, 250);
            assert.strictEqual(activeMsg.status.state, "active");
            assert.strictEqual(activeMsg.activeAlarmCount, 1);
            assert.strictEqual(activeMsg.alarm.message, "The attic humidity is high/low");

            sendValue(collector, 40);
            const clearedMsg = await waitForMessage(out, 250);
            assert.strictEqual(clearedMsg.status.state, "cleared");
            assert.strictEqual(clearedMsg.alarm.state, false);
            assert.strictEqual(clearedMsg.activeAlarmCount, 0);
            assert.strictEqual(clearedMsg.alarm.message, "The attic humidity is normal again");
            done();
        });
    });

    it("should activate from a single stale sample once hysteresis time expires", function (done) {
        const flow = buildServiceFlow({ hysteresisTime: "0.12", compareMode: "high-only" });
        helper.load([alarmConfigNode, alarmCollectorNode, alarmServiceNode], flow, async function () {
            const collector = helper.getNode("collector");
            const out = helper.getNode("out");

            sendValue(collector, 55);

            const activeMsg = await waitForMessage(out, 250);
            assert.strictEqual(activeMsg.status.state, "active");
            assert.strictEqual(activeMsg.alarm.value, 55);

            sendValue(collector, 40);
            const clearedMsg = await waitForMessage(out, 250);
            assert.strictEqual(clearedMsg.status.state, "cleared");
            done();
        });
    });
});