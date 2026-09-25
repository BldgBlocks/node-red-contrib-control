const assert = require("assert");
const { helper, waitForMessage } = require("./test-helpers");
const enumSwitchNode = require("../nodes/enum-switch-block");

function buildFlow(config) {
    return [
        { id: "f1", type: "tab" },
        {
            id: "n1",
            z: "f1",
            type: "enum-switch-block",
            name: "test",
            wires: [["out1"], ["out2"]],
            ...config
        },
        { id: "out1", z: "f1", type: "helper" },
        { id: "out2", z: "f1", type: "helper" }
    ];
}

describe("enum-switch-block", function() {
    afterEach(function(done) {
        helper.unload().then(() => done()).catch(done);
    });

    it("evaluates a configured incoming message property in map mode", function(done) {
        const flow = buildFlow({
            operationMode: "map",
            property: "strategy",
            propertyType: "msg",
            rules: JSON.stringify([{ value: "occupied" }, { value: "unoccupied" }]),
            outputs: 2
        });

        helper.load(enumSwitchNode, flow, function() {
            const node = helper.getNode("n1");
            const firstOutput = helper.getNode("out1");
            const secondOutput = helper.getNode("out2");

            Promise.all([waitForMessage(firstOutput), waitForMessage(secondOutput)]).then(([first, second]) => {
                assert.strictEqual(first.payload, false);
                assert.strictEqual(second.payload, true);
                assert.strictEqual(second.strategy, "unoccupied");
                done();
            }).catch(done);

            node.receive({ strategy: "unoccupied", payload: 72 });
        });
    });

    it("evaluates msg.context in context mode", function(done) {
        const flow = buildFlow({
            operationMode: "context",
            property: "strategy",
            propertyType: "msg",
            rules: JSON.stringify([{ value: "occupied" }, { value: "unoccupied" }]),
            outputs: 2
        });

        helper.load(enumSwitchNode, flow, function() {
            const node = helper.getNode("n1");
            const firstOutput = helper.getNode("out1");
            const secondOutput = helper.getNode("out2");

            Promise.all([waitForMessage(firstOutput), waitForMessage(secondOutput)]).then(([first, second]) => {
                assert.strictEqual(first.payload, true);
                assert.strictEqual(second.payload, false);
                done();
            }).catch(done);

            node.receive({ context: "occupied", payload: 72 });
        });
    });

    it("writes each result to the configured output property", function(done) {
        const flow = buildFlow({
            operationMode: "map",
            property: "strategy",
            propertyType: "msg",
            outputProperty: "result.match",
            rules: JSON.stringify([{ value: "occupied" }, { value: "unoccupied" }]),
            outputs: 2
        });

        helper.load(enumSwitchNode, flow, function() {
            const node = helper.getNode("n1");
            const firstOutput = helper.getNode("out1");
            const secondOutput = helper.getNode("out2");

            Promise.all([waitForMessage(firstOutput), waitForMessage(secondOutput)]).then(([first, second]) => {
                assert.strictEqual(first.result.match, false);
                assert.strictEqual(second.result.match, true);
                assert.strictEqual(first.payload, 72);
                assert.strictEqual(second.payload, 72);
                done();
            }).catch(done);

            node.receive({ strategy: "unoccupied", payload: 72 });
        });
    });
});