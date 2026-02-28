const assert = require("assert");
const { helper, buildFlow, sendPayload, waitForMessage, collectMessages, expectNoMessage, wait } = require("./test-helpers");
const tstatNode = require("../nodes/tstat-block");

// ============================================================================
// Default configs for each algorithm
// ============================================================================
const SINGLE_DEFAULTS = {
    algorithm: "single", algorithmType: "dropdown",
    setpoint: "70", setpointType: "num",
    diff: "2", diffType: "num",
    anticipator: "0.5", anticipatorType: "num",
    ignoreAnticipatorCycles: "1", ignoreAnticipatorCyclesType: "num",
    isHeating: true, isHeatingType: "bool",
    startupDelay: 0,
};

const SPLIT_DEFAULTS = {
    ...SINGLE_DEFAULTS,
    algorithm: "split",
    heatingSetpoint: "68", heatingSetpointType: "num",
    coolingSetpoint: "74", coolingSetpointType: "num",
};

const SPECIFIED_DEFAULTS = {
    ...SINGLE_DEFAULTS,
    algorithm: "specified",
    heatingOn: "66", heatingOnType: "num",
    heatingOff: "68", heatingOffType: "num",
    coolingOn: "74", coolingOnType: "num",
    coolingOff: "72", coolingOffType: "num",
};

/**
 * Capture the last status set on a node.
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

/**
 * Build a 3-output tstat flow.
 */
function tstatFlow(config) {
    return buildFlow("tstat-block", config, "n1", 3);
}

describe("tstat-block", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    // ========================================================================
    // Single algorithm - heating mode
    // ========================================================================
    describe("single algorithm - heating", function() {

        it("should set below=true when temp drops below setpoint - diff/2", function(done) {
            // setpoint=70, diff=2 → on threshold = 69
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 68);  // below 69

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "below should be true");
                    done();
                }).catch(done);
            });
        });

        it("should keep below=false when temp is above on threshold", function(done) {
            // setpoint=70, diff=2 → on threshold = 69
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 70);  // above 69

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false, "below should be false");
                    done();
                }).catch(done);
            });
        });

        it("should turn off heating call when temp rises above off threshold (anticipator)", function(done) {
            // setpoint=70, anticipator=0.5 → off threshold = 70 - 0.5 = 69.5
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                try {
                    const p1 = waitForMessage(outBelow);
                    sendPayload(n1, 68);  // trigger below=true
                    const msg1 = await p1;
                    assert.strictEqual(msg1.payload, true, "below should activate");

                    await wait(50);
                    const p2 = waitForMessage(outBelow);
                    sendPayload(n1, 69.8);  // above off threshold (69.5)
                    const msg2 = await p2;
                    assert.strictEqual(msg2.payload, false, "below should deactivate via anticipator");
                    done();
                } catch(e) { done(e); }
            });
        });

        it("should force above=false in heating mode", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outAbove = helper.getNode("out2");

                const promise = waitForMessage(outAbove);
                sendPayload(n1, 85);  // way above setpoint

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false, "above must be false in heating mode");
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Single algorithm - cooling mode
    // ========================================================================
    describe("single algorithm - cooling", function() {

        it("should set above=true when temp exceeds setpoint + diff/2", function(done) {
            // setpoint=70, diff=2 → on threshold = 71
            const flow = tstatFlow({ ...SINGLE_DEFAULTS, isHeating: false });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outAbove = helper.getNode("out2");

                const promise = waitForMessage(outAbove);
                sendPayload(n1, 72);  // above 71

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "above should be true");
                    done();
                }).catch(done);
            });
        });

        it("should force below=false in cooling mode", function(done) {
            const flow = tstatFlow({ ...SINGLE_DEFAULTS, isHeating: false });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 50);  // way below setpoint

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false, "below must be false in cooling mode");
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Split algorithm
    // ========================================================================
    describe("split algorithm", function() {

        it("should use heatingSetpoint - diff/2 as heating on threshold", function(done) {
            // heatingSetpoint=68, diff=2 → on threshold = 67
            const flow = tstatFlow(SPLIT_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 66);  // below 67

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "below should be true");
                    assert.strictEqual(msg.status.activeSetpoint, 68);
                    done();
                }).catch(done);
            });
        });

        it("should use coolingSetpoint + diff/2 as cooling on threshold", function(done) {
            // coolingSetpoint=74, diff=2 → on threshold = 75
            const flow = tstatFlow({ ...SPLIT_DEFAULTS, isHeating: false });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outAbove = helper.getNode("out2");

                const promise = waitForMessage(outAbove);
                sendPayload(n1, 76);  // above 75

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "above should be true");
                    assert.strictEqual(msg.status.activeSetpoint, 74);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Specified algorithm
    // ========================================================================
    describe("specified algorithm", function() {

        it("should use heatingOn directly as heating threshold", function(done) {
            // heatingOn=66
            const flow = tstatFlow(SPECIFIED_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 65);  // below 66

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "below should be true");
                    done();
                }).catch(done);
            });
        });

        it("should use coolingOn directly as cooling threshold", function(done) {
            // coolingOn=74
            const flow = tstatFlow({ ...SPECIFIED_DEFAULTS, isHeating: false });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outAbove = helper.getNode("out2");

                const promise = waitForMessage(outAbove);
                sendPayload(n1, 75);  // above 74

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true, "above should be true");
                    done();
                }).catch(done);
            });
        });

        it("should turn off heating via heatingOff with anticipator", function(done) {
            // heatingOff=68, anticipator=0.5 → off threshold = 68 - 0.5 = 67.5
            const flow = tstatFlow(SPECIFIED_DEFAULTS);

            helper.load(tstatNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                try {
                    const p1 = waitForMessage(outBelow);
                    sendPayload(n1, 65);  // trigger below=true
                    const msg1 = await p1;
                    assert.strictEqual(msg1.payload, true);

                    await wait(50);
                    const p2 = waitForMessage(outBelow);
                    sendPayload(n1, 68);  // above 67.5 → below=false
                    const msg2 = await p2;
                    assert.strictEqual(msg2.payload, false, "below should turn off via heatingOff - anticipator");
                    done();
                } catch(e) { done(e); }
            });
        });
    });

    // ========================================================================
    // isHeating output (port 1)
    // ========================================================================
    describe("isHeating output", function() {

        it("should pass isHeating=true on output 1", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                        it("should show hysteresis status in cooling mode", function(done) {
                            // setpoint=70, diff=2 → on threshold = 71, off threshold = 71 (anticipator=1 for clear separation)
                            const flow = tstatFlow({ ...SINGLE_DEFAULTS, isHeating: false, anticipator: 1 });
                            helper.load(tstatNode, flow, function() {
                                const n1 = helper.getNode("n1");
                                const outAbove = helper.getNode("out2");
                                const st = trackStatus(n1);
                                // Cross on threshold
                                sendPayload(n1, 72); // above 71, should activate call
                                waitForMessage(outAbove).then(msg1 => {
                                    assert.strictEqual(msg1.payload, true);
                                    assert.ok(st.last.text.includes("(on)"), `status should show (on), got: ${st.last.text}`);
                                    // Now drop just below onThreshold but above offThreshold (hysteresis)
                                    sendPayload(n1, 71); // at threshold, should still be holding
                                    waitForMessage(outAbove).then(msg2 => {
                                        assert.strictEqual(msg2.payload, true);
                                        assert.ok(st.last.text.includes("holding"), `status should show holding, got: ${st.last.text}`);
                                        // Now drop below offThreshold
                                        sendPayload(n1, 70.8); // below offThreshold, should deactivate call
                                        waitForMessage(outAbove).then(msg3 => {
                                            assert.strictEqual(msg3.payload, false);
                                            assert.ok(st.last.text.includes("(off)"), `status should show (off), got: ${st.last.text}`);
                                            done();
                                        }).catch(done);
                                    }).catch(done);
                                }).catch(done);
                            });
                        });
                const n1 = helper.getNode("n1");
                const outIsHeating = helper.getNode("out");

                const promise = waitForMessage(outIsHeating);
                sendPayload(n1, 70);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, true);
                    done();
                }).catch(done);
            });
        });

        it("should pass isHeating=false when configured for cooling", function(done) {
            const flow = tstatFlow({ ...SINGLE_DEFAULTS, isHeating: false });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outIsHeating = helper.getNode("out");

                const promise = waitForMessage(outIsHeating);
                sendPayload(n1, 70);

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false);
                    done();
                }).catch(done);
            });
        });

        it("should error on non-numeric payloads (e.g. booleans)", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");
                const st = trackStatus(n1);

                sendPayload(n1, true);  // boolean, not a temperature

                expectNoMessage(outBelow, 300).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("invalid payload"),
                        `should show invalid payload, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Startup delay
    // ========================================================================
    describe("startup delay", function() {

        it("should suppress calls during startup delay", function(done) {
            const flow = tstatFlow({
                ...SINGLE_DEFAULTS,
                startupDelay: 60,  // long enough to never expire during test
            });

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");
                const st = trackStatus(n1);

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 60);  // way below threshold

                promise.then(msg => {
                    assert.strictEqual(msg.payload, false, "below suppressed during startup");
                    assert.ok(st.last.text.includes("[startup]"), `status should show startup, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Validation
    // ========================================================================
    describe("validation", function() {

        it("should error on missing payload", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");
                const st = trackStatus(n1);

                n1.receive({ notPayload: 70 });

                expectNoMessage(outBelow, 300).then(() => {
                    assert.ok(st.last);
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("missing payload"));
                    done();
                }).catch(done);
            });
        });

        it("should error on non-numeric string payload", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");
                const st = trackStatus(n1);

                sendPayload(n1, "not a number");

                expectNoMessage(outBelow, 300).then(() => {
                    assert.ok(st.last, "status should have been set");
                    assert.strictEqual(st.last.fill, "red");
                    assert.ok(st.last.text.includes("invalid payload"),
                        `should show invalid payload, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });


    });

    // ========================================================================
    // Status display
    // ========================================================================
    describe("status display", function() {

        it("should show concise status with temp, mode, setpoint, and call", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");
                const st = trackStatus(n1);

                const promise = waitForMessage(outBelow);
                sendPayload(n1, 68);  // below=true

                promise.then(msg => {
                    assert.ok(st.last, "status should be set");
                    assert.ok(st.last.text.includes("68.0"), `should show temp, got: ${st.last.text}`);
                    assert.ok(st.last.text.includes("<69.0"), `should show threshold, got: ${st.last.text}`);
                    assert.ok(st.last.text.includes("[heat]"), `should show mode, got: ${st.last.text}`);
                    assert.ok(st.last.text.includes("call:true"), `should show call, got: ${st.last.text}`);
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // msg.status diagnostics
    // ========================================================================
    describe("output diagnostics", function() {

        it("should include status object with thresholds on all outputs", function(done) {
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, function() {
                const n1 = helper.getNode("n1");
                const outIsHeating = helper.getNode("out");
                const outAbove = helper.getNode("out2");
                const outBelow = helper.getNode("out3");

                const p1 = waitForMessage(outIsHeating);
                const p2 = waitForMessage(outAbove);
                const p3 = waitForMessage(outBelow);
                sendPayload(n1, 68);

                Promise.all([p1, p2, p3]).then(([m1, m2, m3]) => {
                    // All three outputs should have status
                    [m1, m2, m3].forEach((msg, i) => {
                        assert.ok(msg.status, `output ${i+1} should have status`);
                        assert.strictEqual(msg.status.algorithm, "single");
                        assert.strictEqual(msg.status.input, 68);
                        assert.strictEqual(msg.status.isHeating, true);
                        assert.ok(msg.status.hasOwnProperty("onThreshold"));
                        assert.ok(msg.status.hasOwnProperty("offThreshold"));
                        assert.ok(msg.status.hasOwnProperty("activeSetpoint"));
                    });
                    done();
                }).catch(done);
            });
        });
    });

    // ========================================================================
    // Hysteresis behavior
    // ========================================================================
    describe("hysteresis", function() {

        it("should not oscillate — call stays on within deadband", function(done) {
            // setpoint=70, diff=2, anticipator=0.5
            // on < 69, off > 69.5
            // Temp at 69.2 is between on and off → should hold current state
            const flow = tstatFlow(SINGLE_DEFAULTS);

            helper.load(tstatNode, flow, async function() {
                const n1 = helper.getNode("n1");
                const outBelow = helper.getNode("out3");

                try {
                    // First: trigger call on
                    const p1 = waitForMessage(outBelow);
                    sendPayload(n1, 68);
                    const msg1 = await p1;
                    assert.strictEqual(msg1.payload, true, "call should activate");

                    // Then: temp rises to within deadband (between 69 on and 69.5 off)
                    await wait(50);
                    const p2 = waitForMessage(outBelow);
                    sendPayload(n1, 69.2);
                    const msg2 = await p2;
                    assert.strictEqual(msg2.payload, true, "call should stay on within hysteresis band");
                    done();
                } catch(e) { done(e); }
            });
        });
    });
});
