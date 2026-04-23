const assert = require("assert");
const { helper, buildFlow, sendPayload, waitForMessage, collectMessages, expectNoMessage, wait } = require("./test-helpers");
const changeoverNode = require("../nodes/changeover-block");

// ============================================================================
// Default configs for each algorithm
// ============================================================================
const SINGLE_DEFAULTS = {
    algorithm: "single", algorithmType: "dropdown",
    setpoint: "70", setpointType: "num",
    deadband: "2", deadbandType: "num",
    extent: "0", extentType: "num",
    swapTime: "60", swapTimeType: "num",
    minTempSetpoint: "55", minTempSetpointType: "num",
    maxTempSetpoint: "90", maxTempSetpointType: "num",
    initWindow: "0",
    operationMode: "auto", operationModeType: "dropdown",
    inputProperty: "payload",
};

const SPLIT_DEFAULTS = {
    ...SINGLE_DEFAULTS,
    algorithm: "split",
    heatingSetpoint: "68", heatingSetpointType: "num",
    coolingSetpoint: "74", coolingSetpointType: "num",
    extent: "1", extentType: "num",
};

const SPECIFIED_DEFAULTS = {
    ...SINGLE_DEFAULTS,
    algorithm: "specified",
    heatingOn: "66", heatingOnType: "num",
    coolingOn: "76", coolingOnType: "num",
};

/**
 * Capture the last status set on a node via the call:status event.
 * Returns an object with a .last property that updates on each status call.
 */
function trackStatus(node) {
    const tracker = { last: null };
    node.on("call:status", (call) => {
        if (call && call.args && call.args[0]) {
            tracker.last = call.args[0];
        }
    });
    return tracker;
}

describe("changeover-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    // ========================================================================
    // Operation mode: heat lock
    // ========================================================================
    describe("heat mode", function() {

        it("should always output isHeating=true regardless of temperature", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                operationMode: "heat", operationModeType: "dropdown",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    const promise = collectMessages(out, 3);

                    sendPayload(n1, 90);
                    await wait(50);
                    sendPayload(n1, 50);
                    await wait(50);
                    sendPayload(n1, 70);

                    const temps = [90, 50, 70];
                    const msgs = await promise;
                    msgs.forEach((msg, i) => {
                        assert.strictEqual(msg.payload, temps[i], `msg[${i}] payload should be temperature`);
                        assert.strictEqual(msg.isHeating, true, `msg[${i}] isHeating should be true`);
                        assert.strictEqual(msg.status.mode, "heating");
                        assert.strictEqual(msg.status.operationMode, "heat");
                    });
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should not show pending countdown", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                operationMode: "heat", operationModeType: "dropdown",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                const promise = waitForMessage(out);
                sendPayload(n1, 95);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 95, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    assert.ok(st.last, "status should have been set");
                    assert.ok(st.last.text.includes("above cool>71.0"),
                        `Status should show relation to cooling swap point, got: ${st.last.text}`);
                    assert.ok(!st.last.text.includes("pending"),
                        `Status should not show pending, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Operation mode: cool lock
    // ========================================================================
    describe("cool mode", function() {

        it("should always output isHeating=false regardless of temperature", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                operationMode: "cool", operationModeType: "dropdown",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    const promise = collectMessages(out, 3);

                    sendPayload(n1, 50);
                    await wait(50);
                    sendPayload(n1, 90);
                    await wait(50);
                    sendPayload(n1, 70);

                    const temps = [50, 90, 70];
                    const msgs = await promise;
                    msgs.forEach((msg, i) => {
                        assert.strictEqual(msg.payload, temps[i], `msg[${i}] payload should be temperature`);
                        assert.strictEqual(msg.isHeating, false, `msg[${i}] isHeating should be false`);
                        assert.strictEqual(msg.status.mode, "cooling");
                    });
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Operation mode via msg property (typed input)
    // ========================================================================
    describe("msg-typed operationMode", function() {

        it("should respect msg.operationMode = 'heat' and lock to heating", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                operationMode: "operationMode", operationModeType: "msg",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Send a high temperature (95) that would normally trigger cooling,
                    // but with msg.operationMode = "heat" it must stay heating
                    const promise = waitForMessage(out);
                    n1.receive({ payload: 95, operationMode: "heat" });
                    const msg = await promise;

                    assert.strictEqual(msg.payload, 95, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true, "should output isHeating=true");
                    assert.strictEqual(msg.status.mode, "heating");
                    assert.strictEqual(msg.status.operationMode, "heat");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should respect msg.operationMode = 'cool' and lock to cooling", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                operationMode: "operationMode", operationModeType: "msg",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Send a low temperature (50) that would normally be heating,
                    // but with msg.operationMode = "cool" it must stay cooling
                    const promise = waitForMessage(out);
                    n1.receive({ payload: 50, operationMode: "cool" });
                    const msg = await promise;

                    assert.strictEqual(msg.payload, 50, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, false, "should output isHeating=false");
                    assert.strictEqual(msg.status.mode, "cooling");
                    assert.strictEqual(msg.status.operationMode, "cool");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    describe("msg-typed algorithm", function() {

        it("should respect msg.algorithm = 'split' and use split setpoints", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                algorithm: "algorithm", algorithmType: "msg",
                heatingSetpoint: "68", heatingSetpointType: "num",
                coolingSetpoint: "74", coolingSetpointType: "num",
                extent: "1", extentType: "num",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Send temperature above cooling threshold (coolingSetpoint + extent = 75)
                    const promise = waitForMessage(out);
                    n1.receive({ payload: 76, algorithm: "split" });
                    const msg = await promise;

                    assert.strictEqual(msg.payload, 76, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, false, "should output isHeating=false for cooling");
                    assert.strictEqual(msg.status.algorithm, "split");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should respect msg.algorithm = 'specified' and use heatingOn/coolingOn", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                algorithm: "algorithm", algorithmType: "msg",
                heatingOn: "66", heatingOnType: "num",
                coolingOn: "76", coolingOnType: "num",
            });

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                try {
                    // Send temperature above coolingOn (76)
                    const promise = waitForMessage(out);
                    n1.receive({ payload: 80, algorithm: "specified" });
                    const msg = await promise;

                    assert.strictEqual(msg.payload, 80, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, false, "should output isHeating=false for cooling");
                    assert.strictEqual(msg.status.algorithm, "specified");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // Auto mode: single setpoint algorithm
    // ========================================================================
    describe("auto mode - single setpoint", function() {

        it("should start in heating mode by default", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                // setpoint=70, deadband=2, extent=0 → heat<69, cool>71
                // temp=70 is in deadband → stays in default heating
                const promise = waitForMessage(out);
                sendPayload(n1, 70);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 70, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    done();
                }).catch(done);
            });
        });

        it("should detect heating on init when temp is below threshold", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 65); // below 69

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 65, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    assert.strictEqual(msg.status.mode, "heating");
                    done();
                }).catch(done);
            });
        });

        it("should NOT immediately switch mode — swap timer required", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                try {
                    const promise = collectMessages(out, 2);

                    sendPayload(n1, 65);
                    await wait(50);
                    sendPayload(n1, 80);

                    const msgs = await promise;
                    assert.strictEqual(msgs[0].isHeating, true, "first: heating");
                    assert.strictEqual(msgs[1].isHeating, true, "second: still heating (swap timer)");
                    assert.strictEqual(msgs[0].payload, 65, "first payload should be temperature");
                    assert.strictEqual(msgs[1].payload, 80, "second payload should be temperature");
                    assert.ok(st.last.text.includes("→"),
                        `Should show pending countdown, got: ${st.last.text}`);
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should report correct thresholds for single algorithm", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 70);

                promise.then(msg => {
                    // setpoint=70, deadband=2 → heat=69, cool=71
                    assert.strictEqual(msg.status.heatingSetpoint, 69);
                    assert.strictEqual(msg.status.coolingSetpoint, 71);
                    done();
                }).catch(done);
            });
        });

        it("should bypass a pending swap immediately via msg.context", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                try {
                    const first = waitForMessage(out);
                    sendPayload(n1, 65);
                    const msg1 = await first;
                    assert.strictEqual(msg1.isHeating, true, "should start in heating");

                    const second = waitForMessage(out);
                    sendPayload(n1, 80);
                    const msg2 = await second;
                    assert.strictEqual(msg2.isHeating, true, "should still be heating while swap timer runs");
                    assert.ok(st.last.text.includes("→"), `Should show pending countdown, got: ${st.last.text}`);

                    const bypass = waitForMessage(out);
                    n1.receive({ context: "bypass timer" });
                    const msg3 = await bypass;

                    assert.strictEqual(msg3.payload, 80, "bypass output should reuse the last temperature");
                    assert.strictEqual(msg3.isHeating, false, "bypass should switch immediately to cooling");
                    assert.strictEqual(msg3.status.mode, "cooling");
                    assert.ok(!st.last.text.includes("→"), `Pending countdown should clear after bypass, got: ${st.last.text}`);
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it("should ignore bypass command when no swap is pending", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                try {
                    const first = waitForMessage(out);
                    sendPayload(n1, 65);
                    await first;

                    n1.receive({ context: "bypass timer" });

                    await expectNoMessage(out, 200);
                    assert.ok(st.last, "status should have been updated");
                    assert.strictEqual(st.last.fill, "yellow");
                    assert.ok(st.last.text.includes("no pending mode change"), `Unexpected status text: ${st.last.text}`);
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });
    });

    // ========================================================================
    // Auto mode: split setpoint algorithm
    // ========================================================================
    describe("auto mode - split setpoint", function() {

        it("should use heatingSetpoint - extent as heating threshold", function(done) {
            const flow = buildFlow("changeover-block", SPLIT_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 66); // below 67 (68-1)

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 66, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    assert.strictEqual(msg.status.heatingSetpoint, 67);
                    assert.strictEqual(msg.status.coolingSetpoint, 75);
                    done();
                }).catch(done);
            });
        });

        it("should show extent-adjusted switch point in status", function(done) {
            const flow = buildFlow("changeover-block", SPLIT_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                const promise = waitForMessage(out);
                sendPayload(n1, 66);

                promise.then(msg => {
                    assert.strictEqual(msg.isHeating, true);
                    assert.ok(st.last, "status should be set");
                    assert.ok(st.last.text.includes("below cool>75.0"), `should show extent-adjusted cooling switch point, got: ${st.last.text}`);
                    assert.ok(!st.last.text.includes("(on)"), `status should not show hysteresis labels, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Auto mode: specified algorithm
    // ========================================================================
    describe("auto mode - specified algorithm", function() {

        it("should use heatingOn/coolingOn directly as thresholds", function(done) {
            const flow = buildFlow("changeover-block", SPECIFIED_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 65); // below heatingOn(66)

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 65, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    assert.strictEqual(msg.status.heatingSetpoint, 66);
                    assert.strictEqual(msg.status.coolingSetpoint, 76);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Init window
    // ========================================================================
    describe("init window", function() {

        it("should suppress output during init window", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                initWindow: "1",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                sendPayload(n1, 65);

                expectNoMessage(out, 300).then(() => {
                    done();
                }).catch(done);
            });
        });

        it("should output after init window expires", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                initWindow: "0.2",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                sendPayload(n1, 65); // during init

                wait(300).then(() => {
                    const promise = waitForMessage(out);
                    sendPayload(n1, 65);
                    return promise;
                }).then(msg => {
                    assert.strictEqual(msg.payload, 65, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    done();
                }).catch(done);
            });
        });

        it("should use cached temp for initial mode decision", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                initWindow: "0.2",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                sendPayload(n1, 80); // cached, above cooling threshold

                wait(300).then(() => {
                    const promise = waitForMessage(out);
                    sendPayload(n1, 80);
                    return promise;
                }).then(msg => {
                    // initWindow expired, evaluateInitialMode saw 80 > 71 → cooling
                    assert.strictEqual(msg.payload, 80, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, false);
                    assert.strictEqual(msg.status.mode, "cooling");
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Validation
    // ========================================================================
    describe("validation", function() {

        it("should not output on NaN temperature", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                sendPayload(n1, "not_a_number");

                expectNoMessage(out, 300).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    done();
                }).catch(done);
            });
        });

        it("should not output on missing payload", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                n1.receive({});

                expectNoMessage(out, 300).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    done();
                }).catch(done);
            });
        });

        it("should clamp swapTime to minimum 60s", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SINGLE_DEFAULTS,
                swapTime: "10", swapTimeType: "num",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 70);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 70, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true);
                    done();
                }).catch(done);
            });
        });

        it("should error when coolingSetpoint <= heatingSetpoint (split)", function(done) {
            const flow = buildFlow("changeover-block", {
                ...SPLIT_DEFAULTS,
                heatingSetpoint: "74", heatingSetpointType: "num",
                coolingSetpoint: "68", coolingSetpointType: "num",
            });

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                sendPayload(n1, 70);

                expectNoMessage(out, 300).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("coolingSetpoint") || st.last.text.includes("invalid"),
                        `Should mention error, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Output message structure
    // ========================================================================
    describe("output structure", function() {

        it("should include isHeating property and full status object", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");

                const promise = waitForMessage(out);
                sendPayload(n1, 68);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, 68, "payload should be temperature");
                    assert.strictEqual(msg.isHeating, true, "isHeating should be on msg");
                    assert.ok(msg.status, "should have status object");
                    assert.ok(msg.status.hasOwnProperty("mode"));
                    assert.ok(msg.status.hasOwnProperty("operationMode"));
                    assert.ok(msg.status.hasOwnProperty("isHeating"));
                    assert.ok(msg.status.hasOwnProperty("heatingSetpoint"));
                    assert.ok(msg.status.hasOwnProperty("coolingSetpoint"));
                    assert.ok(msg.status.hasOwnProperty("temperature"));
                    assert.strictEqual(msg.status.temperature, 68);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Swap timer behavior
    // ========================================================================
    describe("swap timer", function() {

        it("should cancel pending swap when temp returns to current mode range", function(done) {
            const flow = buildFlow("changeover-block", SINGLE_DEFAULTS);

            helper.load(changeoverNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const out = helper.getNode("out");
                const st = trackStatus(n1);

                try {
                    const promise = collectMessages(out, 3);

                    sendPayload(n1, 65);
                    await wait(50);
                    sendPayload(n1, 80);
                    await wait(50);
                    sendPayload(n1, 65);

                    const temps = [65, 80, 65];
                    const msgs = await promise;
                    msgs.forEach((msg, i) => {
                        assert.strictEqual(msg.payload, temps[i], `msg[${i}] payload should be temperature`);
                        assert.strictEqual(msg.isHeating, true, `msg[${i}] should remain heating`);
                    });
                    assert.ok(!st.last.text.includes("pending"),
                        `Pending should be cancelled, got: ${st.last.text}`);
                    done();
                } catch(e) { done(e); }
            });
        });
    });
});
