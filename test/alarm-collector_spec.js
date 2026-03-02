const assert = require("assert");
const { helper, sendPayload, wait } = require("./test-helpers");
const alarmCollectorNode = require("../nodes/alarm-collector");
const alarmConfigNode = require("../nodes/alarm-config");

/**
 * Build a flow with an alarm-config and alarm-collector wired together.
 * The alarm-collector emits events via RED.events (no wired outputs).
 */
function buildAlarmFlow(collectorOverrides = {}) {
    return [
        { id: "f1", type: "tab" },
        { id: "ac1", z: "f1", type: "alarm-config", name: "test-registry" },
        {
            id: "n1",
            z: "f1",
            type: "alarm-collector",
            name: "test-alarm",
            alarmConfig: "ac1",
            inputMode: "value",
            inputField: "payload",
            alarmWhenTrue: true,
            highThreshold: "50",
            lowThreshold: "10",
            compareMode: "high-only",
            hysteresisTime: "100",
            hysteresisMagnitude: "2",
            priority: "normal",
            topic: "Alarms_Test",
            title: "Test Alarm",
            message: "Test condition",
            messageType: "str",
            tags: "",
            units: "°F",
            sourceNodeType: "wired",
            wires: [],
            ...collectorOverrides
        }
    ];
}

/**
 * Collect state-change events emitted by the alarm-collector.
 * Returns { events, cleanup }.
 */
function captureAlarmEvents(RED) {
    const events = [];
    const listener = (evt) => events.push(evt);
    RED.events.on("bldgblocks:alarms:state-change", listener);
    return {
        events,
        cleanup: () => RED.events.off("bldgblocks:alarms:state-change", listener)
    };
}

/**
 * Send a payload and wait for the async input handler to complete.
 * The alarm-collector's on("input") is async (uses await evaluateNodeProperty),
 * so we need a small delay for the microtask to settle.
 */
async function sendAndSettle(node, payload, ms = 15) {
    sendPayload(node, payload);
    await wait(ms);
}

describe("alarm-collector", function () {
    this.timeout(10000);

    afterEach(function (done) {
        helper.unload().then(() => done()).catch(done);
    });

    // ========================================================================
    // Basic loading
    // ========================================================================
    it("should be loaded with correct defaults", function (done) {
        const flow = buildAlarmFlow();
        helper.load([alarmConfigNode, alarmCollectorNode], flow, function () {
            const n1 = helper.getNode("n1");
            assert.ok(n1, "alarm-collector node exists");
            assert.strictEqual(n1.name, "test-alarm");
            assert.strictEqual(n1.highThreshold, 50);
            assert.strictEqual(n1.lowThreshold, 10);
            assert.strictEqual(n1.hysteresisTime, 100);
            assert.strictEqual(n1.hysteresisMagnitude, 2);
            assert.strictEqual(n1.compareMode, "high-only");
            done();
        });
    });

    it("should register with alarm-config at startup", function (done) {
        const flow = buildAlarmFlow();
        helper.load([alarmConfigNode, alarmCollectorNode], flow, function () {
            const ac = helper.getNode("ac1");
            const entry = ac.lookup("n1");
            assert.ok(entry, "alarm registered in config");
            assert.strictEqual(entry.status, "cleared");
            assert.strictEqual(entry.name, "test-alarm");
            done();
        });
    });

    // ========================================================================
    // High-only threshold: alarm activates after hysteresis time
    // ========================================================================
    it("should activate alarm after value exceeds high threshold for hysteresisTime", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "100" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Value exceeds threshold (50)
            await sendAndSettle(n1, 55);

            // Alarm should NOT be active yet (hysteresis timer pending)
            assert.strictEqual(n1.alarmState, false);
            assert.strictEqual(n1.conditionMet, true);

            // Wait for hysteresis timer to fire
            await wait(150);
            assert.strictEqual(n1.alarmState, true, "alarm should be active after hysteresis time");
            assert.strictEqual(capture.events.length, 1);
            assert.strictEqual(capture.events[0].state, true);
            assert.strictEqual(capture.events[0].transition, "false → true");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // High-only threshold: alarm does NOT fire if condition clears before timer
    // ========================================================================
    it("should NOT activate alarm if value drops below threshold within hysteresis time", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "200" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Value exceeds threshold
            await sendAndSettle(n1, 55);
            assert.strictEqual(n1.conditionMet, true);

            // Before hysteresis timer fires, drop below threshold
            await wait(50);
            await sendAndSettle(n1, 40);
            assert.strictEqual(n1.conditionMet, false);
            assert.strictEqual(n1.alarmState, false, "alarm should not have activated");

            // Verify alarm never fired even after original timer would have elapsed
            await wait(300);
            assert.strictEqual(n1.alarmState, false);
            assert.strictEqual(capture.events.length, 0, "no events should be emitted");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Magnitude hysteresis: alarm stays active within hysteresis band
    // ========================================================================
    it("should keep alarm active while value is within magnitude hysteresis band", function (done) {
        // highThreshold=50, hysteresisMagnitude=2 → clearThreshold=48
        const flow = buildAlarmFlow({ hysteresisTime: "50", hysteresisMagnitude: "2" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Trigger alarm
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm should be active");

            // Drop to 49 — below threshold (50) but above clearThreshold (48)
            await sendAndSettle(n1, 49);
            assert.strictEqual(n1.alarmState, true, "alarm should stay active (within hysteresis band)");

            // Only one event emitted (activation)
            assert.strictEqual(capture.events.length, 1);
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Magnitude hysteresis: alarm clears once value exits hysteresis band
    // ========================================================================
    it("should clear alarm when value drops below hysteresis band", function (done) {
        // highThreshold=50, hysteresisMagnitude=2 → clearThreshold=48
        const flow = buildAlarmFlow({ hysteresisTime: "50", hysteresisMagnitude: "2" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Trigger alarm
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true);

            // Drop to 49 - within band, alarm stays
            await sendAndSettle(n1, 49);
            assert.strictEqual(n1.alarmState, true, "should stay active at 49");

            // Drop to 47 - below clearThreshold (48), alarm should clear
            await sendAndSettle(n1, 47);
            assert.strictEqual(n1.alarmState, false, "should clear at 47");

            assert.strictEqual(capture.events.length, 2);
            assert.strictEqual(capture.events[1].state, false);
            assert.strictEqual(capture.events[1].transition, "true → false");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // BUG REGRESSION: magnitude hysteresis re-evaluation on subsequent updates
    // Previously, if conditionMet was already false, subsequent values that
    // crossed the hysteresis band never cleared the alarm.
    // ========================================================================
    it("should clear alarm on LATER update that exits hysteresis band (regression)", function (done) {
        // highThreshold=50, hysteresisMagnitude=2 → clearThreshold=48
        const flow = buildAlarmFlow({ hysteresisTime: "50", hysteresisMagnitude: "2" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Trigger alarm
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true);

            // Step 1: Drop to 49 — conditionMet flips false, but magnitude keeps alarm open
            await sendAndSettle(n1, 49);
            assert.strictEqual(n1.conditionMet, false);
            assert.strictEqual(n1.alarmState, true, "magnitude hysteresis keeps alarm open at 49");

            // Step 2: Drop to 48.5 — conditionMet is already false, still in band
            await sendAndSettle(n1, 48.5);
            assert.strictEqual(n1.alarmState, true, "still in hysteresis band at 48.5");

            // Step 3: Drop to 47 — conditionMet already false, SHOULD clear now
            await sendAndSettle(n1, 47);
            assert.strictEqual(n1.alarmState, false, "alarm must clear at 47 (below clearThreshold 48)");

            assert.strictEqual(capture.events.length, 2, "should have activation + clearing events");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // User-reported scenario: alarm at >50, hysteresis magnitude 2, time 60s
    // Value drops below 48 and alarm stays active
    // ========================================================================
    it("should clear alarm in user scenario: threshold=50, hyst=2, value drops to 47 (regression)", function (done) {
        const flow = buildAlarmFlow({
            highThreshold: "50",
            hysteresisMagnitude: "2",
            hysteresisTime: "50",  // shortened for test speed (real: 60000)
            compareMode: "high-only"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Simulate the scenario
            await sendAndSettle(n1, 52);  // Above 50 → condition met, timer starts
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active after hysteresis");

            // Value gradually drops
            await sendAndSettle(n1, 50);  // At threshold (not above) → condition false
            // Value still > clearThreshold (48), magnitude hysteresis keeps alarm open
            assert.strictEqual(n1.alarmState, true, "still in hysteresis band at 50");

            await sendAndSettle(n1, 49);  // Below threshold, but > clearThreshold (48)
            assert.strictEqual(n1.alarmState, true, "still in hysteresis band at 49");

            // At exactly 48: clearThreshold = 48, check is numericValue > 48 → false
            // So shouldClear = true → alarm clears
            await sendAndSettle(n1, 48);
            assert.strictEqual(n1.alarmState, false, "alarm clears at 48 (boundary)");

            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Low-only threshold
    // ========================================================================
    it("should activate alarm when value drops below low threshold (low-only)", function (done) {
        const flow = buildAlarmFlow({
            compareMode: "low-only",
            lowThreshold: "10",
            hysteresisTime: "50",
            hysteresisMagnitude: "2"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Start above threshold — no alarm
            await sendAndSettle(n1, 15);
            assert.strictEqual(n1.conditionMet, false);

            // Drop below threshold
            await sendAndSettle(n1, 8);
            assert.strictEqual(n1.conditionMet, true);

            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active for low threshold");

            // Rise to 11 — above threshold but within hysteresis band (10 + 2 = 12)
            await sendAndSettle(n1, 11);
            assert.strictEqual(n1.alarmState, true, "within low hysteresis band");

            // Rise to 13 — above hysteresis band (12), alarm should clear
            await sendAndSettle(n1, 13);
            assert.strictEqual(n1.alarmState, false, "alarm cleared above hysteresis band");

            assert.strictEqual(capture.events.length, 2);
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Either mode (high OR low)
    // ========================================================================
    it("should activate alarm for either threshold breach", function (done) {
        const flow = buildAlarmFlow({
            compareMode: "either",
            highThreshold: "50",
            lowThreshold: "10",
            hysteresisTime: "50",
            hysteresisMagnitude: "2"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Value in normal range
            await sendAndSettle(n1, 30);
            assert.strictEqual(n1.conditionMet, false);

            // Exceed high threshold
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active for high breach");

            // Clear completely (value 40: above low threshold, below high clear threshold 48)
            // either mode checks both: 40 > 48 = false (high OK), 40 < 12 = false (low OK)
            // shouldClear = true
            await sendAndSettle(n1, 40);
            assert.strictEqual(n1.alarmState, false, "alarm cleared");

            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Boolean mode: alarm when true
    // ========================================================================
    it("should activate alarm on boolean true (alarmWhenTrue)", function (done) {
        const flow = buildAlarmFlow({
            inputMode: "boolean",
            alarmWhenTrue: true,
            hysteresisTime: "50"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, true);
            assert.strictEqual(n1.conditionMet, true);

            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active on true");

            await sendAndSettle(n1, false);
            assert.strictEqual(n1.alarmState, false, "alarm cleared on false");

            assert.strictEqual(capture.events.length, 2);
            capture.cleanup();
            done();
        });
    });

    it("should activate alarm on boolean false (alarmWhenTrue=false)", function (done) {
        const flow = buildAlarmFlow({
            inputMode: "boolean",
            alarmWhenTrue: false,
            hysteresisTime: "50"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, false);
            assert.strictEqual(n1.conditionMet, true);

            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active on false");

            await sendAndSettle(n1, true);
            assert.strictEqual(n1.alarmState, false, "alarm cleared on true");

            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Invalid input: NaN should not crash
    // ========================================================================
    it("should handle NaN input gracefully", function (done) {
        const flow = buildAlarmFlow();
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");

            await sendAndSettle(n1, "not-a-number");
            // Should not throw, alarm state unchanged
            assert.strictEqual(n1.alarmState, false);
            assert.strictEqual(n1.conditionMet, false);
            done();
        });
    });

    // ========================================================================
    // Numeric string input
    // ========================================================================
    it("should parse numeric string input correctly", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, "55");
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm active from string input");
            assert.strictEqual(n1.currentValue, 55);
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Registry update: alarm-config reflects state changes
    // ========================================================================
    it("should update alarm-config registry on state transitions", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const ac = helper.getNode("ac1");

            // Start: status is cleared
            let entry = ac.lookup("n1");
            assert.strictEqual(entry.status, "cleared");

            // Trigger alarm
            await sendAndSettle(n1, 55);
            await wait(80);
            entry = ac.lookup("n1");
            assert.strictEqual(entry.status, "active", "registry should show active");

            // Clear alarm (40 is well below clearThreshold 48)
            await sendAndSettle(n1, 40);
            entry = ac.lookup("n1");
            assert.strictEqual(entry.status, "cleared", "registry should show cleared");

            done();
        });
    });

    // ========================================================================
    // Deduplication: emitAlarmEvent should not re-emit same state
    // ========================================================================
    it("should not emit duplicate events for same state", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Trigger alarm
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true);

            // Send more values above threshold — should not emit again
            await sendAndSettle(n1, 60);
            await sendAndSettle(n1, 65);

            assert.strictEqual(capture.events.length, 1, "only one activation event");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Cleanup: timers and listeners removed on close
    // ========================================================================
    it("should cleanup timers on close", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "500" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");

            // Start a hysteresis timer
            await sendAndSettle(n1, 55);
            assert.strictEqual(n1.conditionMet, true);
            assert.ok(n1.hysteresisTimer, "timer should be set");

            // Unload triggers close on all nodes
            helper.unload().then(() => {
                assert.strictEqual(n1.hysteresisTimer, null, "timer should be cleared");
                done();
            }).catch(done);
        });
    });

    // ========================================================================
    // Event data: verify event payload structure
    // ========================================================================
    it("should emit event with correct structure", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, 55);
            await wait(80);

            const evt = capture.events[0];
            assert.strictEqual(evt.nodeId, "n1");
            assert.strictEqual(evt.nodeName, "test-alarm");
            assert.strictEqual(evt.value, 55);
            assert.strictEqual(evt.highThreshold, 50);
            assert.strictEqual(evt.state, true);
            assert.strictEqual(evt.priority, "normal");
            assert.strictEqual(evt.topic, "Alarms_Test");
            assert.strictEqual(evt.title, "Test Alarm");
            assert.strictEqual(evt.message, "Test condition");
            assert.strictEqual(evt.units, "°F");
            assert.ok(evt.timestamp, "timestamp should exist");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Hysteresis time: condition must stay true for full duration
    // ========================================================================
    it("should reset hysteresis timer if condition toggles", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "150" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // First trigger
            await sendAndSettle(n1, 55);

            // Clear before timer fires
            await wait(50);
            await sendAndSettle(n1, 40);

            // Re-trigger — timer should restart
            await wait(50);
            await sendAndSettle(n1, 55);

            // Check soon after — should not yet be active
            await wait(50);
            assert.strictEqual(n1.alarmState, false, "alarm should not yet be active");

            // Wait for second timer to elapse
            await wait(150);
            assert.strictEqual(n1.alarmState, true, "alarm should be active after second timer");
            assert.strictEqual(capture.events.length, 1);
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Low-only: magnitude hysteresis re-evaluation on subsequent updates
    // ========================================================================
    it("should re-evaluate low threshold magnitude hysteresis on subsequent updates", function (done) {
        const flow = buildAlarmFlow({
            compareMode: "low-only",
            lowThreshold: "10",
            hysteresisTime: "50",
            hysteresisMagnitude: "2"
        });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Trigger low alarm
            await sendAndSettle(n1, 5);
            await wait(80);
            assert.strictEqual(n1.alarmState, true);

            // Rise to 11 — above threshold but below clearThreshold (10 + 2 = 12)
            await sendAndSettle(n1, 11);
            assert.strictEqual(n1.alarmState, true, "within low hysteresis band at 11");

            // Rise to 11.5 — still within band (< 12)
            await sendAndSettle(n1, 11.5);
            assert.strictEqual(n1.alarmState, true, "still within band at 11.5");

            // Rise to 13 — above clear threshold (12), should clear via third branch
            await sendAndSettle(n1, 13);
            assert.strictEqual(n1.alarmState, false, "should clear at 13 via re-evaluation");

            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // No alarm-config: should still function (just no registry)
    // ========================================================================
    it("should work without alarm-config configured", function (done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "n1",
                z: "f1",
                type: "alarm-collector",
                name: "orphan-alarm",
                inputMode: "value",
                inputField: "payload",
                highThreshold: "50",
                lowThreshold: "10",
                compareMode: "high-only",
                hysteresisTime: "50",
                hysteresisMagnitude: "1",
                priority: "normal",
                topic: "Test",
                title: "Test",
                message: "Test",
                messageType: "str",
                sourceNodeType: "wired",
                wires: []
            }
        ];
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "alarm should activate without config node");
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Small magnitude hysteresis: alarm clears quickly past narrow band
    // (Note: hysteresisMagnitude=0 is parsed as default 2 via `|| 2` fallback)
    // ========================================================================
    it("should clear with small magnitude hysteresis", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50", hysteresisMagnitude: "0.5" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true);

            // Drop to 49.8 — below threshold 50, but above clearThreshold (50 - 0.5 = 49.5)
            await sendAndSettle(n1, 49.8);
            assert.strictEqual(n1.alarmState, true, "should stay active in narrow band");

            // Drop to 49 — below clearThreshold (49.5), should clear
            await sendAndSettle(n1, 49);
            assert.strictEqual(n1.alarmState, false, "should clear below narrow band");

            assert.strictEqual(capture.events.length, 2);
            capture.cleanup();
            done();
        });
    });

    // ========================================================================
    // Full cycle: activate → stay active → clear → reactivate
    // ========================================================================
    it("should support full alarm lifecycle", function (done) {
        const flow = buildAlarmFlow({ hysteresisTime: "50", hysteresisMagnitude: "2" });
        helper.load([alarmConfigNode, alarmCollectorNode], flow, async function () {
            const n1 = helper.getNode("n1");
            const capture = captureAlarmEvents(helper._RED);

            // Phase 1: Activate
            await sendAndSettle(n1, 55);
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "phase 1: alarm active");

            // Phase 2: Clear
            await sendAndSettle(n1, 40);
            assert.strictEqual(n1.alarmState, false, "phase 2: alarm cleared");

            // Phase 3: Reactivate
            await sendAndSettle(n1, 60);
            await wait(80);
            assert.strictEqual(n1.alarmState, true, "phase 3: alarm reactivated");

            // Phase 4: Clear again
            await sendAndSettle(n1, 30);
            assert.strictEqual(n1.alarmState, false, "phase 4: alarm cleared again");

            assert.strictEqual(capture.events.length, 4, "4 state transitions");
            capture.cleanup();
            done();
        });
    });
});
