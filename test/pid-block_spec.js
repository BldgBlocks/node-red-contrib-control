const assert = require("assert");
const { helper, buildFlow, expectNoMessage, wait, waitForMessage } = require("./test-helpers");
const pidBlock = require("../nodes/pid-block");

function pidConfig(overrides = {}) {
    return {
        inputProperty: "payload",
        kp: 2,
        kpType: "num",
        ki: 0,
        kiType: "num",
        kd: 0,
        kdType: "num",
        setpoint: 10,
        setpointType: "num",
        setpointRateLimit: 0,
        setpointRateLimitType: "num",
        deadband: 0,
        deadbandType: "num",
        dbBehavior: "ReturnToZero",
        outMin: null,
        outMinType: "num",
        outMax: null,
        outMaxType: "num",
        maxChange: 0,
        maxChangeType: "num",
        run: true,
        runType: "bool",
        directAction: false,
        ...overrides
    };
}

function runAtOneSecond(config, payload, verify, done) {
    helper.load(pidBlock, buildFlow("pid-block", pidConfig(config)), function() {
        const node = helper.getNode("n1");
        const output = helper.getNode("out");
        node.lastTime = Date.now() - 1000;
        const message = waitForMessage(output);
        node.receive({ payload });
        message.then(msg => {
            verify(msg);
            done();
        }).catch(done);
    });
}

describe("pid-block", function() {
    afterEach(() => helper.unload());

    it("calculates the proportional term", function(done) {
        runAtOneSecond({}, 5, msg => {
            assert.strictEqual(msg.payload, 10);
            assert.strictEqual(msg.diagnostics.pGain, 10);
            assert.strictEqual(msg.diagnostics.intGain, 0);
            assert.strictEqual(msg.diagnostics.dGain, 0);
            assert.strictEqual(msg.diagnostics.error, 5);
        }, done);
    });

    it("accumulates the integral term over elapsed time", function(done) {
        runAtOneSecond({ ki: 0.5 }, 5, msg => {
            assert.ok(Math.abs(msg.payload - 15) < 0.05, `unexpected output ${msg.payload}`);
            assert.ok(Math.abs(msg.diagnostics.intGain - 5) < 0.05);
            assert.ok(Math.abs(msg.diagnostics.errorSum - 5) < 0.05);
        }, done);
    });

    it("applies the filtered derivative term", function(done) {
        runAtOneSecond({ kd: 1 }, 5, msg => {
            assert.ok(Math.abs(msg.payload - 11) < 0.05, `unexpected output ${msg.payload}`);
            assert.ok(Math.abs(msg.diagnostics.dGain - 1) < 0.05);
        }, done);
    });

    it("reverses the error sign between heating and cooling action", function(done) {
        runAtOneSecond({ directAction: true }, 15, msg => {
            assert.strictEqual(msg.payload, 10);
            assert.strictEqual(msg.diagnostics.error, 5);
            assert.strictEqual(msg.diagnostics.directAction, true);
        }, done);
    });

    it("ReturnToZero applies inside the deadband", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig({ deadband: 1 })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastTime = Date.now() - 1000;
            const first = waitForMessage(output);
            node.receive({ payload: 5 });
            first.then(() => {
                node.lastTime = Date.now() - 1000;
                const second = waitForMessage(output);
                node.receive({ payload: 10 });
                return second;
            }).then(msg => {
                assert.strictEqual(msg.payload, 0);
                done();
            }).catch(done);
        });
    });

    it("HoldLastResult suppresses an unchanged output inside the deadband", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig({ deadband: 1, dbBehavior: "HoldLastResult" })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastTime = Date.now() - 1000;
            const first = waitForMessage(output);
            node.receive({ payload: 5 });
            first.then(() => {
                node.lastTime = Date.now() - 1000;
                node.receive({ payload: 10 });
                return expectNoMessage(output, 50);
            }).then(() => {
                assert.strictEqual(node.result, 10);
                done();
            }).catch(done);
        });
    });

    it("evaluates gains and setpoint from the current message", function(done) {
        const config = pidConfig({
            kp: "control.kp",
            kpType: "msg",
            setpoint: "control.setpoint",
            setpointType: "msg"
        });
        helper.load(pidBlock, buildFlow("pid-block", config), function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                node.lastTime = Date.now() - 1000;
                const message = waitForMessage(output);
                node.receive({ payload: 5, control: { kp: 3, setpoint: 10 } });
                message.then(msg => {
                    assert.strictEqual(msg.payload, 15);
                    assert.strictEqual(msg.diagnostics.kp, 3);
                    assert.strictEqual(msg.diagnostics.error, 5);
                    done();
                }).catch(done);
            });
    });

    it("clamps output and integral accumulation to configured bounds", function(done) {
        runAtOneSecond({ ki: 1, outMin: 0, outMax: 10 }, 0, msg => {
            assert.strictEqual(msg.payload, 10);
            assert.ok(msg.diagnostics.errorSum <= 10.05);
            assert.ok(msg.diagnostics.intGain <= 20.1);
        }, done);
    });

    it("rejects an invalid runtime output bound without changing the valid range", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig({ outMin: 0, outMax: 100 })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "outMin", payload: 101 });
            expectNoMessage(output, 30).then(() => {
                node.lastTime = Date.now() - 1000;
                const message = waitForMessage(output);
                node.receive({ payload: -100 });
                return message;
            }).then(msg => {
                assert.strictEqual(msg.payload, 100);
                done();
            }).catch(done);
        });
    });

    it("resets accumulated and tuning state", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig()), function() {
            const node = helper.getNode("n1");
            node.errorSum = 25;
            node.lastError = 4;
            node.lastDError = 2;
            node.result = 10;
            node.tuneMode = true;
            node.receive({ context: "reset", payload: true });

            setImmediate(() => {
                assert.strictEqual(node.errorSum, 0);
                assert.strictEqual(node.lastError, 0);
                assert.strictEqual(node.lastDError, 0);
                assert.strictEqual(node.result, 0);
                assert.strictEqual(node.tuneMode, false);
                assert.deepStrictEqual(node.tuneData.peaks, []);
                done();
            });
        });
    });

    it("completes relay auto-tuning after repeated oscillations", function(done) {
        const originalDateNow = Date.now;
        let now = 1000;
        Date.now = () => now;
        helper.load(pidBlock, buildFlow("pid-block", pidConfig({ outMin: 0, outMax: 100 })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "tune", payload: true });

            wait(10).then(async () => {
                let lastMessage;
                for (const payload of [5, 15, 5, 15, 5, 15, 5]) {
                    now += 1000;
                    const message = waitForMessage(output);
                    node.receive({ payload });
                    lastMessage = await message;
                }
                return lastMessage;
            }).then(lastMessage => {
                const result = lastMessage.tuneResult;
                assert.ok(result);
                assert.strictEqual(result.method, "relay-auto-tune");
                assert.ok(Number.isFinite(result.Kp) && result.Kp > 0);
                assert.ok(Number.isFinite(result.Ki) && result.Ki > 0);
                assert.ok(Number.isFinite(result.Kd) && result.Kd > 0);
                assert.strictEqual(node.tuneMode, false);
                done();
            }).catch(done).finally(() => {
                Date.now = originalDateNow;
            });
        });
    });

    it("warns for an unknown context without completing with an error", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig()), function() {
            const node = helper.getNode("n1");
            let reportedError = null;
            node.on("call:error", call => {
                reportedError = call.args[0];
            });
            node.receive({ context: "unknown", payload: 1 });
            wait(30).then(() => {
                assert.strictEqual(reportedError, null);
                done();
            }).catch(done);
        });
    });

    it("rate-limits runtime setpoint changes by elapsed time", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig({ setpointRateLimit: 2 })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "setpoint", payload: 20 });
            wait(10).then(() => {
                node.lastTime = Date.now() - 1000;
                const message = waitForMessage(output);
                node.receive({ payload: 5 });
                return message;
            }).then(msg => {
                assert.ok(Math.abs(msg.payload - 14) < 0.05, `unexpected output ${msg.payload}`);
                assert.ok(Math.abs(msg.diagnostics.error - 7) < 0.05);
                assert.ok(Math.abs(node.setpoint - 12) < 0.05);
                done();
            }).catch(done);
        });
    });

    it("disables output and resumes after runtime run commands", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig()), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "run", payload: false });
            wait(10).then(() => {
                node.lastTime = Date.now() - 1000;
                const stopped = waitForMessage(output);
                node.receive({ payload: 5 });
                return stopped;
            }).then(msg => {
                assert.strictEqual(msg.payload, 0);
                node.receive({ context: "run", payload: true });
                return wait(10);
            }).then(() => {
                node.lastTime = Date.now() - 1000;
                const running = waitForMessage(output);
                node.receive({ payload: 5 });
                return running;
            }).then(msg => {
                assert.strictEqual(msg.payload, 10);
                done();
            }).catch(done);
        });
    });

    it("applies runtime gain updates to the next calculation", function(done) {
        helper.load(pidBlock, buildFlow("pid-block", pidConfig()), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.receive({ context: "kp", payload: 4 });
            wait(10).then(() => {
                node.lastTime = Date.now() - 1000;
                const message = waitForMessage(output);
                node.receive({ payload: 5 });
                return message;
            }).then(msg => {
                assert.strictEqual(msg.payload, 20);
                assert.strictEqual(msg.diagnostics.kp, 4);
                done();
            }).catch(done);
        });
    });

    [undefined, null, NaN, Infinity, "not-a-number"].forEach(value => {
        it(`does not emit for invalid input ${String(value)}`, function(done) {
            helper.load(pidBlock, buildFlow("pid-block", pidConfig()), function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                const msg = value === undefined ? {} : { payload: value };
                node.receive(msg);
                expectNoMessage(output, 40).then(() => done()).catch(done);
            });
        });
    });
});