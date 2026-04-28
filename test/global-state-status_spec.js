const assert = require("assert");
const { helper, collectMessages, waitForMessage, wait } = require("./test-helpers");
const globalGetterNode = require("../nodes/global-getter");
const globalSetterNode = require("../nodes/global-setter");

function trackStatus(node) {
    const tracker = { last: null };
    node.on("call:status", (call) => {
        if (call && call.args && call.args[0]) {
            tracker.last = call.args[0];
        }
    });
    return tracker;
}

describe("global getter/setter status toggle", function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("should suppress value text in global-setter status when showStatus is false", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "setter",
                z: "f1",
                type: "global-setter",
                name: "test setter",
                path: "hvac/test/value",
                property: "payload",
                defaultValue: 0,
                defaultValueType: "num",
                writePriority: "fallback",
                writePriorityType: "dropdown",
                showStatus: false,
                wires: [["out"]]
            },
            { id: "out", z: "f1", type: "helper" }
        ];

        helper.load([globalSetterNode], flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const setter = helper.getNode("setter");
            const out = helper.getNode("out");
            const status = trackStatus(setter);

            (async () => {
                await waitForMessage(out, 1500);
                const outputPromise = waitForMessage(out, 1500);
                setter.receive({ payload: "very long payload value that should not appear in status text" });
                const msg = await outputPromise;
                assert.strictEqual(msg.value, "very long payload value that should not appear in status text");
                assert.ok(status.last);
                assert.strictEqual(status.last.text, "write: fallback > active: fallback");
                done();
            })().catch(done);
        });
    });

    it("should include value text in global-setter status when showStatus is true", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "setter",
                z: "f1",
                type: "global-setter",
                name: "test setter",
                path: "hvac/test/value-verbose",
                property: "payload",
                defaultValue: 0,
                defaultValueType: "num",
                writePriority: "fallback",
                writePriorityType: "dropdown",
                showStatus: true,
                wires: [["out"]]
            },
            { id: "out", z: "f1", type: "helper" }
        ];

        helper.load([globalSetterNode], flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const setter = helper.getNode("setter");
            const out = helper.getNode("out");
            const status = trackStatus(setter);

            (async () => {
                await waitForMessage(out, 1500);
                const outputPromise = waitForMessage(out, 1500);
                setter.receive({ payload: 72 });
                await outputPromise;
                assert.ok(status.last);
                assert.strictEqual(status.last.text, "write: fallback:72 > active: fallback:72");
                done();
            })().catch(done);
        });
    });

    it("should suppress retrieved value text in global-getter status when showStatus is false", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "setter",
                z: "f1",
                type: "global-setter",
                name: "test setter",
                path: "hvac/test/getter-source",
                property: "payload",
                defaultValue: 0,
                defaultValueType: "num",
                writePriority: "fallback",
                writePriorityType: "dropdown",
                showStatus: true,
                wires: [["setter-out"]]
            },
            {
                id: "getter",
                z: "f1",
                type: "global-getter",
                name: "test getter",
                targetNode: "setter",
                outputProperty: "payload",
                outputPropertyType: "msg",
                dropdownPath: "",
                updates: "input",
                detail: "getValue",
                showStatus: false,
                wires: [["getter-out"]]
            },
            { id: "setter-out", z: "f1", type: "helper" },
            { id: "getter-out", z: "f1", type: "helper" }
        ];

        helper.load([globalSetterNode, globalGetterNode], flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const setter = helper.getNode("setter");
            const getter = helper.getNode("getter");
            const setterOut = helper.getNode("setter-out");
            const getterOut = helper.getNode("getter-out");
            const status = trackStatus(getter);

            (async () => {
                await waitForMessage(setterOut, 1500);

                let setterPromise = waitForMessage(setterOut, 1500);
                setter.receive({ payload: "very long payload value that should stay out of getter status text" });
                await setterPromise;

                const getterPromise = waitForMessage(getterOut, 1500);
                getter.receive({ payload: true });
                const msg = await getterPromise;

                assert.strictEqual(msg.payload, "very long payload value that should stay out of getter status text");
                assert.ok(status.last);
                assert.strictEqual(status.last.text, "get");
                done();
            })().catch(done);
        });
    });

    it("should include retrieved value text in global-getter status when showStatus is true", function(done) {
        const flow = [
            { id: "f1", type: "tab" },
            {
                id: "setter",
                z: "f1",
                type: "global-setter",
                name: "test setter",
                path: "hvac/test/getter-source-verbose",
                property: "payload",
                defaultValue: 0,
                defaultValueType: "num",
                writePriority: "fallback",
                writePriorityType: "dropdown",
                showStatus: true,
                wires: [["setter-out"]]
            },
            {
                id: "getter",
                z: "f1",
                type: "global-getter",
                name: "test getter",
                targetNode: "setter",
                outputProperty: "payload",
                outputPropertyType: "msg",
                dropdownPath: "",
                updates: "input",
                detail: "getValue",
                showStatus: true,
                wires: [["getter-out"]]
            },
            { id: "setter-out", z: "f1", type: "helper" },
            { id: "getter-out", z: "f1", type: "helper" }
        ];

        helper.load([globalSetterNode, globalGetterNode], flow, function(err) {
            if (err) {
                done(err);
                return;
            }

            const setter = helper.getNode("setter");
            const getter = helper.getNode("getter");
            const setterOut = helper.getNode("setter-out");
            const getterOut = helper.getNode("getter-out");
            const status = trackStatus(getter);

            (async () => {
                await waitForMessage(setterOut, 1500);

                let setterPromise = waitForMessage(setterOut, 1500);
                setter.receive({ payload: 88 });
                await setterPromise;

                const getterPromise = waitForMessage(getterOut, 1500);
                getter.receive({ payload: true });
                const msg = await getterPromise;

                assert.strictEqual(msg.payload, 88);
                assert.ok(status.last);
                assert.strictEqual(status.last.text, "get: 88");
                done();
            })().catch(done);
        });
    });
});
