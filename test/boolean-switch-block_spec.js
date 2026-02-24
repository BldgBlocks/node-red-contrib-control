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
            { id: "n1", type: "boolean-switch-block", state: true, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
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

    it("should route inFalse to outFalse when state is false", function (done) {
        const flow = [
            { id: "n1", type: "boolean-switch-block", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
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
            { id: "n1", type: "boolean-switch-block", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
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
            { id: "n1", type: "boolean-switch-block", state: false, wires: [["outTrue"], ["outFalse"], ["outControl"]] },
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
});
