const assert = require("assert");
const { helper, wait, waitForMessage } = require("./test-helpers");
const historyCollectorNode = require("../nodes/history-collector");
const historyConfigNode = require("../nodes/history-config");

function buildHistoryFlow(storageType, overrides = {}) {
    return [
        { id: "f1", type: "tab" },
        {
            id: "hc1",
            type: "history-config",
            name: "HVAC History",
            series: [{ seriesName: "Zone Temp", seriesUnits: "F" }],
            tags: []
        },
        {
            id: "n1",
            z: "f1",
            type: "history-collector",
            historyConfig: "hc1",
            seriesName: "Zone Temp",
            inputProperty: "payload",
            inputPropertyType: "msg",
            tags: "site=main,physical",
            storageType,
            wires: [["out"]],
            ...overrides
        },
        { id: "out", z: "f1", type: "helper" }
    ];
}

describe("history-collector", function() {
    afterEach(() => helper.unload());

    it("outputs escaped line protocol", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("lineProtocol"), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: 72.5, topic: "temperature" });
            message.then(msg => {
                assert.strictEqual(msg.measurement, "Zone\\ Temp");
                assert.match(msg.payload, /^Zone\\ Temp,historyGroup=HVAC_History,site=main,tag1=physical value=72\.5 \d+$/);
                assert.strictEqual(msg.topic, "temperature");
                done();
            }).catch(done);
        });
    });

    it("escapes string field values for line protocol", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("lineProtocol"), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: 'say "hi" \\ path' });
            message.then(msg => {
                assert.match(msg.payload, /value="say \\"hi\\" \\\\ path"/);
                done();
            }).catch(done);
        });
    });

    it("outputs object format", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("object"), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: true });
            message.then(msg => {
                assert.strictEqual(msg.payload.measurement, "Zone\\ Temp");
                assert.deepStrictEqual(msg.payload.tags, [
                    "historyGroup=HVAC_History",
                    "site=main",
                    "tag1=physical"
                ]);
                assert.strictEqual(msg.payload.value, true);
                assert.ok(Number.isFinite(msg.payload.timestamp));
                done();
            }).catch(done);
        });
    });

    it("outputs object-array format", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("objectArray"), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: "42i" });
            message.then(msg => {
                assert.deepStrictEqual(msg.payload, [
                    { value: 42 },
                    { historyGroup: "HVAC_History", site: "main", tag1: "physical" }
                ]);
                assert.ok(Number.isFinite(msg.timestamp));
                done();
            }).catch(done);
        });
    });

    it("outputs batch-object format", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("batchObject"), function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: "occupied" });
            message.then(msg => {
                assert.strictEqual(msg.payload.measurement, "Zone\\ Temp");
                assert.deepStrictEqual(msg.payload.fields, { value: "occupied" });
                assert.deepStrictEqual(msg.payload.tags, {
                    historyGroup: "HVAC_History",
                    site: "main",
                    tag1: "physical"
                });
                assert.ok(Number.isFinite(msg.payload.timestamp));
                done();
            }).catch(done);
        });
    });

    it("stores memory history and evicts oldest records by byte cap", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("memory"), function() {
            const node = helper.getNode("n1");
            const config = helper.getNode("hc1");
            config.maxMemoryMb = 0.00025;

            node.receive({ payload: `first-${"x".repeat(120)}` });
            wait(15).then(() => {
                node.receive({ payload: `second-${"y".repeat(120)}` });
                return wait(15);
            }).then(() => {
                const records = node.context().global.get("history_data_HVAC_History");
                assert.strictEqual(records.length, 1);
                assert.match(records[0], /second-/);
                done();
            }).catch(done);
        });
    });

    it("evaluates a JSONata input expression", function(done) {
        const flow = buildHistoryFlow("batchObject", {
            inputProperty: "payload.value * 2",
            inputPropertyType: "jsonata"
        });
        helper.load([historyConfigNode, historyCollectorNode], flow, function() {
            const node = helper.getNode("n1");
            const output = helper.getNode("out");
            const message = waitForMessage(output);
            node.receive({ payload: { value: 5 } });
            message.then(msg => {
                assert.strictEqual(msg.payload.fields.value, 10);
                done();
            }).catch(done);
        });
    });

    it("emits a tagged batch event for the configured history service", function(done) {
        helper.load([historyConfigNode, historyCollectorNode], buildHistoryFlow("memory"), function() {
            const node = helper.getNode("n1");
            const events = [];
            const eventName = "bldgblocks:history:hc1";
            const listener = event => events.push(event);
            helper._RED.events.on(eventName, listener);

            node.receive({ payload: 72.5 });
            wait(15).then(() => {
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].measurement, "Zone\\ Temp");
                assert.deepStrictEqual(events[0].fields, { value: 72.5 });
                assert.deepStrictEqual(events[0].tags, {
                    historyGroup: "HVAC_History",
                    site: "main",
                    tag1: "physical"
                });
                assert.ok(Number.isFinite(events[0].timestamp));
                helper._RED.events.off(eventName, listener);
                done();
            }).catch(done);
        });
    });
});