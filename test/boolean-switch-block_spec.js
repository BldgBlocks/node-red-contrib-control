const assert = require("assert");
const helper = require("node-red-node-test-helper");
const booleanSwitchNode = require("../nodes/boolean-switch-block");

helper.init("/usr/lib/node_modules/node-red/lib/red.js");

describe("boolean-switch-block Node", function () {
    afterEach(function () {
        helper.unload();
    });

    it("should be loaded", function (done) {
        const flow = [{ id: "n1", type: "boolean-switch-block", name: "test name" }];
        helper.load(booleanSwitchNode, flow, function () {
            const n1 = helper.getNode("n1");
            assert.strictEqual(n1.name, "test name");
            done();
        });
    });

    it("should route inTrue to outTrue when state is true", function (done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "context", state: true, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" },
            { id: "outFalse", type: "helper" },
            { id: "outControl", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function () {
            const n1 = helper.getNode("n1");
            const outTrue = helper.getNode("outTrue");
            
            outTrue.on("input", function (msg) {
                assert.strictEqual(msg.payload, "test payload");
                done();
            });
            
            n1.receive({ context: "inTrue", payload: "test payload" });
        });
    });

    it("should retain context routing for pre-map-mode configurations", function(done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", state: true, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function() {
            const n1 = helper.getNode("n1");
            const outTrue = helper.getNode("outTrue");

            outTrue.on("input", function(msg) {
                assert.strictEqual(msg.payload, "legacy payload");
                done();
            });

            n1.receive({ context: "inTrue", payload: "legacy payload" });
        });
    });

    it("should route inFalse to outFalse when state is false", function (done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "context", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" },
            { id: "outFalse", type: "helper" },
            { id: "outControl", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function () {
            const n1 = helper.getNode("n1");
            const outFalse = helper.getNode("outFalse");
            
            outFalse.on("input", function (msg) {
                assert.strictEqual(msg.payload, "test payload");
                done();
            });
            
            n1.receive({ context: "inFalse", payload: "test payload" });
        });
    });

    it("should toggle state and output to outControl", function (done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "context", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outControl", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function () {
            const n1 = helper.getNode("n1");
            const outControl = helper.getNode("outControl");
            
            outControl.on("input", function (msg) {
                assert.strictEqual(msg.payload, true);
                done();
            });
            
            n1.receive({ context: "toggle" });
        });
    });

    it("should switch state and output to outControl", function (done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "context", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outControl", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function () {
            const n1 = helper.getNode("n1");
            const outControl = helper.getNode("outControl");
            
            outControl.on("input", function (msg) {
                assert.strictEqual(msg.payload, true);
                done();
            });
            
            n1.receive({ context: "switch", payload: true });
        });
    });

    it("should update the map-mode switch without forwarding a message", function(done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "map", state: false, switchProperty: "enabled", trueProperty: "payload", wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" },
            { id: "outFalse", type: "helper" },
            { id: "outControl", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function() {
            const n1 = helper.getNode("n1");
            let messages = 0;

            ["outTrue", "outFalse", "outControl"].forEach(function(id) {
                helper.getNode(id).on("input", function() {
                    messages += 1;
                });
            });

            n1.receive({ enabled: true });
            setTimeout(function() {
                assert.strictEqual(n1.state, true);
                assert.strictEqual(messages, 0);
                done();
            }, 50);
        });
    });

    it("should forward the original true-path message after a separate map-mode switch update", function(done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "map", state: false, switchProperty: "enabled", trueProperty: "payload", falseProperty: "otherProperty", wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function() {
            const n1 = helper.getNode("n1");
            const outTrue = helper.getNode("outTrue");

            outTrue.on("input", function(msg) {
                assert.strictEqual(msg.payload, "poll result");
                assert.strictEqual(msg.enabled, undefined);
                done();
            });

            n1.receive({ enabled: true });
            n1.receive({ payload: "poll result" });
        });
    });

    it("should forward through the configured false path after a separate map-mode switch update", function(done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "map", switchProperty: "enabled", trueProperty: "payload", falseProperty: "otherProperty", wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outFalse", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function() {
            const n1 = helper.getNode("n1");
            const outFalse = helper.getNode("outFalse");

            outFalse.on("input", function(msg) {
                assert.strictEqual(msg.otherProperty, "blocked-path value");
                assert.strictEqual(msg.enabled, undefined);
                done();
            });

            n1.receive({ enabled: false });
            n1.receive({ otherProperty: "blocked-path value" });
        });
    });

    it("should gate a map-mode branch message without a switch property", function(done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", operationMode: "map", state: false, switchProperty: "enabled", trueProperty: "payload", wires: [["outTrue"], ["outFalse"], ["outControl"]] },
            { id: "outTrue", type: "helper" }
        ];
        helper.load(booleanSwitchNode, flow, function() {
            const n1 = helper.getNode("n1");
            const outTrue = helper.getNode("outTrue");
            let messages = 0;

            outTrue.on("input", function() {
                messages += 1;
            });

            n1.receive({ payload: "poll result" });
            setTimeout(function() {
                assert.strictEqual(messages, 0);
                done();
            }, 50);
        });
    });
});
