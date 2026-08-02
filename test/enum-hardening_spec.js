const assert = require("assert");
const { helper, buildFlow, expectNoMessage, waitForMessage } = require("./test-helpers");
const enumSelect = require("../nodes/enum-select");
const enumSwitch = require("../nodes/enum-switch-block");

function trackStatus(node) {
    const tracker = { last: null };
    node.on("call:status", call => {
        if (call?.args?.[0]) tracker.last = call.args[0];
    });
    return tracker;
}

describe("enum configuration hardening", function() {
    afterEach(() => helper.unload());

    it("rejects duplicate enum-select keys", function(done) {
        const flow = buildFlow("enum-select", {
            keys: JSON.stringify(["occupied", "occupied"]),
            selectedKey: "occupied"
        });
        helper.load(enumSelect, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const status = trackStatus(node);
            node.receive({ context: "occupied", payload: 72 });
            expectNoMessage(output, 100).then(() => {
                assert.strictEqual(status.last.fill, "red");
                assert.match(status.last.text, /duplicate keys/);
                done();
            }).catch(done);
        });
    });

    it("matches boolean values against numeric rules without throwing", function(done) {
        const flow = buildFlow("enum-switch-block", {
            property: "payload",
            propertyType: "msg",
            rules: JSON.stringify([{ value: 1 }])
        });
        helper.load(enumSwitch, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: true });
            message.then(result => {
                assert.strictEqual(result.payload, true);
                done();
            }).catch(done);
        });
    });

    it("treats unsupported boolean rule values as non-matches", function(done) {
        const flow = buildFlow("enum-switch-block", {
            property: "payload",
            propertyType: "msg",
            rules: JSON.stringify([{ value: { invalid: true } }])
        });
        helper.load(enumSwitch, flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: true });
            message.then(result => {
                assert.strictEqual(result.payload, false);
                done();
            }).catch(done);
        });
    });
});