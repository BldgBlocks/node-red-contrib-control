const assert = require("assert");
const { helper } = require("./test-helpers");
const historyConfigNode = require("../nodes/history-config");

describe("history-config", function() {
    afterEach(() => helper.unload());

    it("exposes the corrected storage-safe name and preserves series", function(done) {
        const series = [
            { seriesName: "ZoneTemp", seriesUnits: "F" },
            { seriesName: "Humidity", seriesUnits: "%" }
        ];
        helper.load(historyConfigNode, [{
            id: "hc1",
            type: "history-config",
            name: "HVAC History / Main",
            series
        }], function() {
            const config = helper.getNode("hc1");
            assert.strictEqual(config.name, "HVAC_History___Main");
            assert.deepStrictEqual(config.series, series);
            done();
        });
    });

    it("uses the visible default name when none is configured", function(done) {
        helper.load(historyConfigNode, [{
            id: "hc1",
            type: "history-config",
            name: "",
            series: []
        }], function() {
            const config = helper.getNode("hc1");
            assert.strictEqual(config.name, "default");
            assert.deepStrictEqual(config.series, []);
            done();
        });
    });
});