const assert = require("assert");
const EventEmitter = require("events");
const os = require("os");
const { helper, buildFlow, sendPayload, waitForMessage } = require("./test-helpers");
const memoryNode = require("../nodes/memory-block");
const pidNode = require("../nodes/pid-block");
const triangleWaveNode = require("../nodes/triangle-wave-block");

describe("critical control regressions", function() {
    afterEach(() => helper.unload());

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
            directActionType: "bool",
            ...overrides
        };
    }

    it("does not clamp PID output when optional bounds are unset", function(done) {
        helper.load(pidNode, buildFlow("pid-block", pidConfig()), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastTime = Date.now() - 1000;
            const message = waitForMessage(output);

            sendPayload(node, 5);

            message.then(msg => {
                assert.strictEqual(msg.payload, 10);
                done();
            }).catch(done);
        });
    });

    it("scales PID maxChange by elapsed seconds", function(done) {
        helper.load(pidNode, buildFlow("pid-block", pidConfig({ maxChange: 2 })), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastTime = Date.now() - 500;
            const message = waitForMessage(output);

            sendPayload(node, 5);

            message.then(msg => {
                assert.ok(msg.payload >= 0.9 && msg.payload <= 1.2, `unexpected limited output ${msg.payload}`);
                done();
            }).catch(done);
        });
    });

    it("writes PID output to a nested property and preserves the input message", function(done) {
        const config = pidConfig({
            inputProperty: "source.value",
            outputProperty: "result.control"
        });
        helper.load(pidNode, buildFlow("pid-block", config), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastTime = Date.now() - 1000;
            const message = waitForMessage(output);

            node.receive({ source: { value: 5 }, topic: "temperature" });

            message.then(msg => {
                assert.strictEqual(msg.result.control, 10);
                assert.deepStrictEqual(msg.source, { value: 5 });
                assert.strictEqual(msg.topic, "temperature");
                assert.strictEqual(msg.payload, undefined);
                done();
            }).catch(done);
        });
    });

    it("schedules memory writes with the configured write period", function() {
        let MemoryConstructor;
        const context = { set: () => {} };
        const RED = {
            nodes: {
                createNode(node) {
                    const emitter = new EventEmitter();
                    node.id = "memory-test";
                    node.on = emitter.on.bind(emitter);
                    node.emit = emitter.emit.bind(emitter);
                    node.context = () => context;
                    node.error = () => {};
                    node.send = () => {};
                    node.status = () => {};
                    node.receive = msg => emitter.emit("input", msg, node.send, () => {});
                },
                registerType(type, constructor) {
                    if (type === "memory-block") MemoryConstructor = constructor;
                }
            },
            settings: { userDir: os.tmpdir() },
            util: {
                cloneMessage: msg => ({ ...msg }),
                evaluateNodeProperty: value => value
            }
        };
        memoryNode(RED);
        const node = new MemoryConstructor({
            writePeriod: 10000,
            writePeriodType: "num",
            transferProperty: "payload",
            writeOnUpdate: false
        });

        assert.doesNotThrow(() => {
            node.receive({ context: "update", payload: 42 });
        });
        assert.strictEqual(node.storedMsg.payload, 42);

        node.writeOnUpdate = true;
        let closed = false;
        node.emit("close", () => { closed = true; });
        assert.strictEqual(closed, true);
    });

    it("reaches the triangle wave upper limit at half a period", function(done) {
        const flow = buildFlow("triangle-wave-block", {
            lowerLimit: 0,
            upperLimit: 100,
            period: 10,
            periodUnits: "seconds"
        });

        helper.load(triangleWaveNode, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            node.lastExecution = Date.now() - 5000;
            const message = waitForMessage(output);

            node.receive({ payload: true });

            message.then(msg => {
                assert.ok(msg.payload >= 99.9 && msg.payload <= 100, `unexpected peak ${msg.payload}`);
                done();
            }).catch(done);
        });
    });
});