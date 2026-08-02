const assert = require("assert");
const { helper, expectNoMessage, wait, waitForMessage } = require("./test-helpers");
const historyConfigNode = require("../nodes/history-config");
const historyServiceNode = require("../nodes/history-service");

function buildServiceFlow() {
    return [
        { id: "f1", type: "tab" },
        { id: "hc1", type: "history-config", name: "Primary", series: [], tags: [] },
        { id: "hc2", type: "history-config", name: "Other", series: [], tags: [] },
        {
            id: "svc",
            z: "f1",
            type: "history-service",
            historyConfig: "hc1",
            wires: [["out"]]
        },
        { id: "out", z: "f1", type: "helper" }
    ];
}

function record(measurement = "ZoneTemp") {
    return {
        measurement,
        fields: { value: 72.5 },
        tags: { historyGroup: "Primary" },
        timestamp: Date.now() * 1e6
    };
}

describe("history-service", function() {
    afterEach(() => helper.unload());

    it("relays valid records only from its configured history", function(done) {
        helper.load([historyConfigNode, historyServiceNode], buildServiceFlow(), function() {
            const output = helper.getNode("out");
            helper._RED.events.emit("bldgblocks:history:hc2", record("Ignored"));
            expectNoMessage(output, 40).then(() => {
                const message = waitForMessage(output);
                const expected = record();
                helper._RED.events.emit("bldgblocks:history:hc1", expected);
                return message.then(msg => ({ msg, expected }));
            }).then(({ msg, expected }) => {
                assert.deepStrictEqual(msg.payload, expected);
                done();
            }).catch(done);
        });
    });

    it("warns and ignores malformed collector events", function(done) {
        helper.load([historyConfigNode, historyServiceNode], buildServiceFlow(), function() {
            const service = helper.getNode("svc");
            const output = helper.getNode("out");
            let warning = null;
            service.on("call:warn", call => {
                warning = call.args[0];
            });

            helper._RED.events.emit("bldgblocks:history:hc1", null);
            expectNoMessage(output, 40).then(() => {
                assert.strictEqual(warning, "Invalid event data received");
                done();
            }).catch(done);
        });
    });

    it("throttles relay status updates", function(done) {
        helper.load([historyConfigNode, historyServiceNode], buildServiceFlow(), function() {
            const service = helper.getNode("svc");
            const output = helper.getNode("out");
            let lastStatus = null;
            service.on("call:status", call => {
                lastStatus = call.args[0];
            });
            const message = waitForMessage(output);
            helper._RED.events.emit("bldgblocks:history:hc1", record("SupplyTemp"));
            message.then(() => wait(2100)).then(() => {
                assert.strictEqual(lastStatus.fill, "blue");
                assert.match(lastStatus.text, /relayed: SupplyTemp/);
                done();
            }).catch(done);
        });
    });

    it("removes its configured event listener on close", function(done) {
        helper.load([historyConfigNode, historyServiceNode], buildServiceFlow(), function() {
            const eventName = "bldgblocks:history:hc1";
            const before = helper._RED.events.listenerCount(eventName);
            assert.ok(before > 0);
            helper.unload().then(() => {
                assert.strictEqual(helper._RED.events.listenerCount(eventName), before - 1);
                done();
            }).catch(done);
        });
    });
});