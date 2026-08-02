const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("output property editor migration", function() {
    const nodeNames = [
        "accumulate-block",
        "average-block",
        "boolean-to-number-block",
        "convert-block",
        "frequency-block",
        "interpolate-block",
        "modulo-block",
        "pid-block",
        "rate-of-change-block",
        "round-block",
        "scale-range-block"
    ];

    nodeNames.forEach(nodeName => {
        it(`${nodeName} populates a missing output property with payload`, function() {
            const html = fs.readFileSync(path.join(__dirname, "..", "nodes", `${nodeName}.html`), "utf8");
            assert.match(html, /outputProperty:\s*\{\s*value:\s*"payload"/);
            assert.ok(html.includes('$("#node-input-outputProperty").val("payload")'));
        });
    });
});