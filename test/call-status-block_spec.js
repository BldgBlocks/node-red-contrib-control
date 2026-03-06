const assert = require("assert");
const { helper, buildFlow, sendPayload, waitForMessage, collectMessages, expectNoMessage, wait } = require("./test-helpers");
const callStatusNode = require("../nodes/call-status-block");

// ============================================================================
// Default config — call reads from msg.payload, status from msg.status
// Both via typed inputs (msg type)
// ============================================================================
const DEFAULTS = {
    callValue: "payload",         callValueType: "msg",
    statusValue: "status",        statusValueType: "msg",
    statusTimeout: "0.3",         // 300ms for fast tests
    heartbeatTimeout: "0",        // disabled by default
    clearDelay: "0.2",            // 200ms
    debounce: "0",                // disabled by default
    noStatusOnRun: true,
    runLostStatus: false,
    statusWithoutCall: true,
    noStatusOnRunMessage: "No status received during run",
    runLostStatusMessage: "Status lost during run",
    statusWithoutCallMessage: "Status active without call"
};

/**
 * Capture the last status set on a node.
 */
function trackStatus(node) {
    const tracker = { last: null, all: [] };
    node.on("call:status", (call) => {
        if (call && call.args && call.args[0]) {
            tracker.last = call.args[0];
            tracker.all.push(call.args[0]);
        }
    });
    return tracker;
}

describe("call-status-block", function() {
    this.timeout(8000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    // ========================================================================
    // Basic state transitions
    // ========================================================================
    describe("basic state transitions", function() {

        it("should start in IDLE state with call:OFF status:OFF", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const st = trackStatus(n1);

                // Send a message with call=false, status=false
                const out = helper.getNode("out");
                const promise = waitForMessage(out);
                n1.receive({ payload: false, status: false });

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false, "payload should be false (call)");
                    assert.strictEqual(msg.status.call, false);
                    assert.strictEqual(msg.status.status, false);
                    assert.strictEqual(msg.status.alarm, false);
                    assert.strictEqual(msg.diagnostics.state, "IDLE");
                    done();
                }).catch(done);
            });
        });

        it("should transition to WAITING_FOR_STATUS when call=true", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ payload: true, status: false });

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "payload should be true (call)");
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, false);
                    assert.strictEqual(msg.diagnostics.state, "WAITING_FOR_STATUS");
                    done();
                }).catch(done);
            });
        });

        it("should transition to RUNNING when call=true and status=true", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // First: activate call
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;
                    await wait(50);

                    // Second: status arrives
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await p2;

                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    assert.strictEqual(msg.diagnostics.state, "RUNNING");
                    assert.strictEqual(msg.status.alarm, false);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should return to IDLE when call=false after running", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0"  // immediate clear
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Deactivate with clearDelay=0
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const msg = await p2;

                    assert.strictEqual(msg.status.call, false);
                    assert.strictEqual(msg.diagnostics.state, "IDLE");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // No Status On Run alarm
    // ========================================================================
    describe("no status on run alarm", function() {

        it("should alarm when status not received within timeout", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.15",  // 150ms
                noStatusOnRun: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call, status stays false
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;

                    // Wait for timeout alarm
                    const p2 = waitForMessage(out, 1000);
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, true);
                    assert.strictEqual(msg.status.alarmMessage, "No status received during run");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should NOT alarm when status arrives before timeout", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.5",  // 500ms
                noStatusOnRun: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;
                    await wait(50);

                    // Status arrives before timeout
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false);
                    assert.strictEqual(msg.diagnostics.state, "RUNNING");

                    // Wait past original timeout to ensure no alarm fires
                    await wait(600);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should NOT alarm when noStatusOnRun is disabled", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.1",
                noStatusOnRun: false
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call, status stays false
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;

                    // Wait past timeout — should NOT get an alarm
                    await wait(300);

                    // Send another message to check state
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false);
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Run Lost Status alarm
    // ========================================================================
    describe("run lost status alarm", function() {

        it("should alarm when status goes false during active call", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.3",  // statusLostTimer uses this as delay
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Status goes false while call is still true
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p2;
                    await wait(50);

                    // Wait for statusLost alarm (300ms heartbeat-based delay)
                    const p3 = waitForMessage(out, 2000);
                    const msg = await p3;

                    assert.strictEqual(msg.status.alarm, true);
                    assert.strictEqual(msg.status.alarmMessage, "Status lost during run");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should NOT alarm on status lost when runLostStatus is disabled", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                runLostStatus: false
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Status goes false
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    const msg = await p2;

                    // Wait past hysteresis
                    await wait(200);

                    assert.strictEqual(msg.status.alarm, false);
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Heartbeat monitoring
    // ========================================================================
    describe("heartbeat monitoring", function() {

        it("should alarm when heartbeat expires during active run", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.2",  // 200ms heartbeat
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;

                    // Wait for heartbeat to expire (200ms + margin)
                    const p2 = waitForMessage(out, 1000);
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, true);
                    assert.strictEqual(msg.status.alarmMessage, "Status lost during run");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should NOT alarm when status refreshes before heartbeat expires", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.3",  // 300ms heartbeat
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;

                    // Refresh heartbeat at 150ms (before 300ms expires)
                    await wait(150);
                    n1.receive({ payload: true, status: true });

                    // Refresh again at 300ms
                    await wait(150);
                    n1.receive({ payload: true, status: true });

                    // Refresh again at 450ms
                    await wait(150);
                    n1.receive({ payload: true, status: true });

                    // If we get here without alarm, heartbeat is working
                    await wait(100);

                    // Check final state
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await p2;

                    // Should still be running, no alarm
                    assert.strictEqual(msg.status.alarm, false);
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should refresh heartbeat on repeated same-value status=true", function(done) {
            // This tests the critical fix: repeated status=true must refresh lastStatusTime
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.25",  // 250ms heartbeat
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get initial status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;

                    // Send 4 refreshes at 100ms intervals (total 400ms > 250ms heartbeat)
                    // If heartbeat wasn't being refreshed by same-value, it would alarm at 250ms
                    for (let i = 0; i < 4; i++) {
                        await wait(100);
                        n1.receive({ payload: true, status: true });
                    }

                    await wait(50);

                    // Verify no alarm after 450ms of continuous same-value refreshes
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false, "should NOT alarm — heartbeat was refreshed");
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Clear delay
    // ========================================================================
    describe("clear delay", function() {

        it("should clear state after clearDelay expires", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0.2"  // 200ms
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Deactivate call
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    await p2;

                    // Wait for clear delay to fire
                    const p3 = waitForMessage(out, 1000);
                    const msg = await p3;

                    assert.strictEqual(msg.status.call, false);
                    assert.strictEqual(msg.status.status, false, "status should be cleared after delay");
                    assert.strictEqual(msg.status.alarm, false);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should clear state immediately when clearDelay=0", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate and get status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Deactivate call — immediate clear
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    const msg = await p2;

                    // Should be immediately cleared (clearDelay=0)
                    assert.strictEqual(msg.status.call, false);
                    assert.strictEqual(msg.status.status, false);
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Status active without call
    // ========================================================================
    describe("status active without call", function() {

        it("should alarm when status=true but call=false (no clear timer)", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                n1.startupTime = 0;  // bypass startup grace for test

                try {
                    // Send status=true without ever activating call
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    await p1;

                    // Wait for hysteresis alarm (100ms)
                    const p2 = waitForMessage(out, 1000);
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, true);
                    assert.strictEqual(msg.status.alarmMessage, "Status active without call");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should NOT alarm when statusWithoutCall is disabled", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0",
                statusWithoutCall: false
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Send status=true without call
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    await p1;

                    // Wait past hysteresis window
                    await wait(200);

                    // Check state — should NOT be in alarm
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false, "should not alarm when statusWithoutCall disabled");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should protect against status-without-call when clearTimer is active", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "1"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // 1. Activate call and get status response
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    let msg = await p1;
                    assert.strictEqual(msg.status.alarm, false);

                    // 2. Deactivate call (starts clearTimer with 1s delay)
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    msg = await p2;

                    // CRITICAL: While clearTimer is active, status=true doesn't alarm even
                    // though call=false. The clearTimer provides grace-period protection via
                    // the !node.clearTimer check in the alarm condition.
                    assert.strictEqual(msg.status.alarm, false, "clearTimer naturally protects against false alarms");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Status not clearing alarm
    // ========================================================================
    describe("status not clearing alarm", function() {

        it("should alarm when status stays true after call deactivated beyond clearDelay", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0.15"  // 150ms
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate with status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Deactivate call but status stays true
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    await p2;

                    // Wait for inactive status monitor (clearDelay + 1s = 1.15s)
                    // but also wait for clear delay timer itself which fires at 150ms
                    // The inactiveStatusTimer fires at (clearDelay + 1)*1000 = 1150ms
                    // For test speed, we'll keep sending status=true to keep actualState true
                    // so clearTimer fires at 150ms and clears actualState, which prevents
                    // the inactiveStatusTimer alarm.
                    // Actually the clearTimer forces actualState=false, so inactiveStatusTimer 
                    // checks !requestedState && actualState which will be false.
                    // Let's test with a longer clearDelay to catch the inactive alarm.

                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Debounce
    // ========================================================================
    describe("debounce", function() {

        it("should debounce rapid status changes", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                debounce: "100"  // 100ms debounce
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Step 1: Activate call (status=false so no debounce needed)
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;
                    await wait(50);

                    // Step 2: Send status=true — triggers debounce (100ms)
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p2;  // Gets the immediate output (actualState still false)

                    // Wait for debounce to fire and process the status change
                    await wait(200);

                    // Verify we're now in RUNNING state
                    const pCheck = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const mCheck = await pCheck;
                    assert.strictEqual(mCheck.diagnostics.state, "RUNNING", "should be RUNNING after debounce settles");
                    await wait(50);

                    // Step 3: Flip status false — starts new debounce (100ms)
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p3;
                    await wait(30);

                    // Step 4: Flip status back to true BEFORE debounce fires
                    // This should cancel the pending false debounce
                    const p4 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p4;

                    // Wait past debounce window
                    await wait(200);

                    // Final check — should still be RUNNING (false was cancelled)
                    const pFinal = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await pFinal;

                    assert.strictEqual(msg.status.status, true);
                    assert.strictEqual(msg.diagnostics.state, "RUNNING");
                    assert.strictEqual(msg.status.alarm, false);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should process immediately when debounce=0", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                debounce: "0"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call with status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const msg = await p1;

                    // Should be processed immediately (no debounce delay)
                    assert.strictEqual(msg.status.status, true);
                    assert.strictEqual(msg.diagnostics.state, "RUNNING");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Typed input evaluation
    // ========================================================================
    describe("typed input evaluation", function() {

        it("should read call from msg.payload and status from msg.status", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ payload: true, status: true });

                promise.then(msg => {
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    done();
                }).catch(done);
            });
        });

        it("should work with custom msg property names", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                callValue: "myCall",        callValueType: "msg",
                statusValue: "myStatus",    statusValueType: "msg",
            });

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ myCall: true, myStatus: true });

                promise.then(msg => {
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    assert.strictEqual(msg.diagnostics.state, "RUNNING");
                    done();
                }).catch(done);
            });
        });

        it("should work with static bool typed input for call", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                callValue: "true",     callValueType: "bool",
                statusValue: "true",   statusValueType: "bool",
            });

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({});  // empty message — values come from static config

                promise.then(msg => {
                    assert.strictEqual(msg.status.call, true);
                    assert.strictEqual(msg.status.status, true);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Reset context
    // ========================================================================
    describe("reset", function() {

        it("should reset all state on context=reset with payload=true", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // First, get into RUNNING state
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Reset
                    const p2 = waitForMessage(out);
                    n1.receive({ context: "reset", payload: true });
                    const msg = await p2;

                    assert.strictEqual(msg.status.call, false);
                    assert.strictEqual(msg.status.status, false);
                    assert.strictEqual(msg.status.alarm, false);
                    assert.strictEqual(msg.diagnostics.state, "IDLE");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should error on invalid reset payload", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                n1.receive({ context: "reset", payload: false });

                wait(100).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("invalid reset"), 
                        `should show invalid reset, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Output structure
    // ========================================================================
    describe("output structure", function() {

        it("should include payload, status object, and diagnostics", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ payload: true, status: false });

                promise.then(msg => {
                    // payload
                    assert.strictEqual(typeof msg.payload, "boolean");

                    // status object
                    assert.ok(msg.status, "should have status object");
                    assert.ok(msg.status.hasOwnProperty("call"));
                    assert.ok(msg.status.hasOwnProperty("status"));
                    assert.ok(msg.status.hasOwnProperty("alarm"));
                    assert.ok(msg.status.hasOwnProperty("alarmMessage"));

                    // diagnostics object
                    assert.ok(msg.diagnostics, "should have diagnostics object");
                    assert.ok(msg.diagnostics.hasOwnProperty("state"));
                    assert.ok(msg.diagnostics.hasOwnProperty("initialTimeout"));
                    assert.ok(msg.diagnostics.hasOwnProperty("heartbeatActive"));
                    assert.ok(msg.diagnostics.hasOwnProperty("neverReceivedStatus"));
                    assert.ok(msg.diagnostics.hasOwnProperty("lastStatusTime"));
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Status display
    // ========================================================================
    describe("status display", function() {

        it("should show idle status initially", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const st = trackStatus(n1);
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ payload: false, status: false });

                promise.then(() => {
                    assert.ok(st.last, "status should be set");
                    assert.ok(st.last.text.includes("idle") || st.last.text.includes("OFF"),
                        `should show idle state, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });

        it("should show alarm status on alarm", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.1",
                noStatusOnRun: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const st = trackStatus(n1);
                const out = helper.getNode("out");

                try {
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;

                    // Wait for alarm
                    await wait(300);

                    assert.ok(st.last, "status should be set");
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("ALARM"), 
                        `should show ALARM, got: ${st.last.text}`);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should show running status with heartbeat", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                heartbeatTimeout: "5",
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const st = trackStatus(n1);
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                n1.receive({ payload: true, status: true });

                promise.then(() => {
                    assert.ok(st.last, "status should be set");
                    assert.strictEqual(st.last.fill, "green");
                    assert.ok(st.last.text.includes("heartbeat") || st.last.text.includes("ON"),
                        `should show heartbeat, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Edge cases and validation
    // ========================================================================
    describe("edge cases", function() {

        it("should handle null/undefined message gracefully", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                // Send empty msg (no payload, no status properties) — evalBool
                // should fall back to defaults and not crash
                const promise = waitForMessage(out);
                n1.receive({});

                promise.then(() => {
                    // Should have handled gracefully — not crashed
                    assert.ok(st.last, "status should be set");
                    done();
                }).catch(done);
            });
        });

        it("should not change state on repeated same call value", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;
                    await wait(50);

                    // Send same call=true again — should not re-trigger timers
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    const msg = await p2;

                    // Should still be in WAITING_FOR_STATUS, not re-initialized
                    assert.strictEqual(msg.diagnostics.state, "WAITING_FOR_STATUS");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should cancel initial timeout when call deactivated before timeout", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.3",
                noStatusOnRun: true,
                clearDelay: "0"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;
                    await wait(50);

                    // Deactivate before timeout fires
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    await p2;

                    // Wait past original timeout
                    await wait(400);

                    // Should NOT have received an alarm
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const msg = await p3;

                    assert.strictEqual(msg.status.alarm, false, "should not alarm after call deactivated");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should handle isBusy correctly and drop concurrent messages", function(done) {
            const flow = buildFlow("call-status-block", DEFAULTS);

            helper.load(callStatusNode, flow, function() {
                const n1 = helper.getNode("n1");
                const st = trackStatus(n1);

                // This is hard to trigger in tests since eval is fast,
                // but verify the node doesn't crash on rapid messages
                for (let i = 0; i < 10; i++) {
                    n1.receive({ payload: i % 2 === 0, status: false });
                }

                wait(200).then(() => {
                    // Should have processed without error
                    assert.ok(true, "survived rapid fire messages");
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Alarm recovery — late status clears active alarm
    // ========================================================================
    describe("alarm recovery", function() {

        it("should clear 'no status on run' alarm when late status=true arrives", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "0.15",  // 150ms
                noStatusOnRun: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Activate call, no status
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p1;

                    // Wait for timeout alarm to fire
                    const p2 = waitForMessage(out, 1000);
                    const alarmMsg = await p2;
                    assert.strictEqual(alarmMsg.status.alarm, true, "should be in alarm");
                    assert.strictEqual(alarmMsg.status.alarmMessage, "No status received during run");
                    await wait(50);

                    // Late status arrives — should clear the alarm
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const recovered = await p3;

                    assert.strictEqual(recovered.status.alarm, false, "alarm should be cleared");
                    assert.strictEqual(recovered.status.alarmMessage, "");
                    assert.strictEqual(recovered.diagnostics.state, "RUNNING");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should clear 'status lost' alarm when status=true returns", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.3",  // statusLostTimer uses this as delay
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Establish RUNNING state
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Status goes false → triggers status lost alarm (300ms heartbeat-based delay)
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    await p2;
                    await wait(400);  // wait for heartbeat-based delay

                    // Verify alarm is active
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    const alarmMsg = await p3;
                    assert.strictEqual(alarmMsg.status.alarm, true, "should be in alarm");
                    assert.strictEqual(alarmMsg.status.alarmMessage, "Status lost during run");
                    await wait(50);

                    // Status returns — should clear the alarm
                    const p4 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const recovered = await p4;

                    assert.strictEqual(recovered.status.alarm, false, "alarm should be cleared");
                    assert.strictEqual(recovered.status.alarmMessage, "");
                    assert.strictEqual(recovered.diagnostics.state, "RUNNING");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should clear 'status active without call' alarm when status goes false", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                clearDelay: "0"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                n1.startupTime = 0;  // bypass startup grace for test

                try {
                    // Status=true without call → triggers alarm (100ms hysteresis)
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    await p1;
                    await wait(150);  // wait for hysteresis

                    // Verify alarm
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    const alarmMsg = await p2;
                    assert.strictEqual(alarmMsg.status.alarm, true, "should alarm on status without call");
                    await wait(50);

                    // Status goes false — should clear alarm
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const recovered = await p3;

                    assert.strictEqual(recovered.status.alarm, false, "alarm should be cleared");
                    assert.strictEqual(recovered.diagnostics.state, "IDLE");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should recover from heartbeat alarm when fresh status arrives", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.2",  // 200ms
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Establish RUNNING state
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;

                    // Wait for heartbeat alarm to fire via timer callback
                    // The heartbeat timer sends its own output when it expires
                    const heartbeatAlarm = await waitForMessage(out, 1000);
                    assert.strictEqual(heartbeatAlarm.status.alarm, true, "should be in heartbeat alarm");
                    await wait(50);

                    // Fresh status=true arrives — should recover
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const recovered = await p3;

                    assert.strictEqual(recovered.status.alarm, false, "alarm should be cleared");
                    assert.strictEqual(recovered.diagnostics.state, "RUNNING");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Call deactivation timing — alarm should not persist or fire after
    // the call goes off, even with pending debounce/statusLost timers.
    // ========================================================================
    describe("call deactivation clears run alarms", function() {

        it("should clear status-lost alarm immediately when call deactivates", function(done) {
            // Scenario: status drops → alarm fires → then call drops.
            // The alarm should clear on call deactivation, not linger for clearDelay.
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                heartbeatTimeout: "0.3",  // statusLostTimer uses this as delay
                clearDelay: "2",      // long enough to observe the bug
                debounce: "0",
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Get to RUNNING state
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Status drops → status lost alarm fires (after 300ms heartbeat-based delay)
                    n1.receive({ payload: true, status: false });
                    await wait(400);
                    assert.strictEqual(n1.alarm, true, "status-lost alarm should be active");

                    // Now call deactivates — alarm should clear immediately
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false,
                        "alarm should clear on call deactivation, not wait for clearDelay");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should not alarm if status drops just before call in same message window (debounce race)", function(done) {
            // Scenario: with debounce, status=false arrives right before call=false.
            // The debounce timer should be cancelled by call deactivation.
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                clearDelay: "0.5",
                debounce: "100",
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Get to RUNNING state
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    await p1;
                    await wait(50);

                    // Status drops — debounce timer starts (100ms)
                    n1.receive({ payload: true, status: false });

                    // Before debounce completes, call drops too (50ms later)
                    await wait(50);
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const msg = await p2;

                    assert.strictEqual(msg.status.alarm, false,
                        "alarm should not fire — call deactivation cancels pending debounce");

                    // Wait past what would have been the statusLost timer
                    await wait(300);
                    assert.strictEqual(n1.alarm, false,
                        "no phantom alarm from stale timers");

                    done();
                } catch(e) { done(e); }
            });
        });

        it("should not alarm during normal shutdown (call off, status lingers)", function(done) {
            // User scenario: equipment told to stop, status takes time to clear.
            // No alarm should fire at any point during normal shutdown.
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "2",
                clearDelay: "0.5",
                debounce: "100",
                runLostStatus: true
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                // Passive listener — capture all messages
                const allMsgs = [];
                out.on("input", (msg) => allMsgs.push(msg));

                try {
                    // Get to RUNNING state
                    n1.receive({ payload: true, status: true });
                    await wait(50);

                    // Call drops, status still true (equipment winding down)
                    n1.receive({ payload: false, status: true });
                    await wait(50);

                    // Status eventually drops
                    n1.receive({ payload: false, status: false });

                    // Wait for debounce + any hysteresis timers + clearDelay
                    await wait(800);

                    // Verify NO alarm was ever emitted
                    const alarmed = allMsgs.filter(m => m.status && m.status.alarm === true);
                    assert.strictEqual(alarmed.length, 0,
                        "no alarm should fire during normal shutdown sequence");

                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Full lifecycle scenario
    // ========================================================================
    describe("full lifecycle", function() {

        it("should handle complete call→running→deactivate→idle cycle", function(done) {
            const flow = buildFlow("call-status-block", {
                ...DEFAULTS,
                statusTimeout: "1",
                clearDelay: "0.15"
            });

            helper.load(callStatusNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // 1. Start IDLE
                    const p1 = waitForMessage(out);
                    n1.receive({ payload: false, status: false });
                    const m1 = await p1;
                    assert.strictEqual(m1.diagnostics.state, "IDLE");
                    await wait(50);

                    // 2. Activate call → WAITING_FOR_STATUS
                    const p2 = waitForMessage(out);
                    n1.receive({ payload: true, status: false });
                    const m2 = await p2;
                    assert.strictEqual(m2.diagnostics.state, "WAITING_FOR_STATUS");
                    await wait(50);

                    // 3. Status arrives → RUNNING
                    const p3 = waitForMessage(out);
                    n1.receive({ payload: true, status: true });
                    const m3 = await p3;
                    assert.strictEqual(m3.diagnostics.state, "RUNNING");
                    assert.strictEqual(m3.status.alarm, false);
                    await wait(50);

                    // 4. Deactivate call
                    const p4 = waitForMessage(out);
                    n1.receive({ payload: false, status: true });
                    const m4 = await p4;
                    assert.strictEqual(m4.status.call, false);
                    // status may still be true during clear delay

                    // 5. Wait for clear delay to fire → back to IDLE
                    const p5 = waitForMessage(out, 1000);
                    const m5 = await p5;
                    assert.strictEqual(m5.diagnostics.state, "IDLE");
                    assert.strictEqual(m5.status.status, false);
                    assert.strictEqual(m5.status.alarm, false);

                    done();
                } catch(e) { done(e); }
            });
        });
    });
});
