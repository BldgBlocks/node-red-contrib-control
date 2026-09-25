const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("map-mode editor migration", function() {
    const nodeTypes = ["and", "or", "add", "subtract", "multiply", "divide", "modulo"];

    nodeTypes.forEach(type => {
        it(`defaults new ${type} nodes to map mode and migrates old nodes to context mode`, function() {
            const html = fs.readFileSync(path.join(__dirname, `../nodes/${type}-block.html`), "utf8");

            assert.match(html, /operationMode:\s*\{\s*value:\s*"map"\s*\}/);
            assert.match(html, /node\.operationMode !== "map" && node\.operationMode !== "context"/);
            assert.match(html, /node\.operationMode = "context"/);
            assert.match(html, /#node-input-operationMode/);
        });
    });

    it("defaults new boolean-switch nodes to map mode and migrates old nodes to context mode", function() {
        const html = fs.readFileSync(path.join(__dirname, "../nodes/boolean-switch-block.html"), "utf8");

        assert.match(html, /operationMode:\s*\{\s*value:\s*"map"\s*\}/);
        assert.match(html, /node\.operationMode !== "map" && node\.operationMode !== "context"/);
        assert.match(html, /node\.operationMode = "context"/);
        assert.match(html, /#node-input-operationMode/);
        assert.match(html, /switchProperty:\s*\{\s*value:\s*"switch"\s*\}/);
        assert.match(html, /trueProperty:\s*\{\s*value:\s*"payload"\s*\}/);
    });

    it("defaults enum-switch to configurable-property map mode", function() {
        const html = fs.readFileSync(path.join(__dirname, "../nodes/enum-switch-block.html"), "utf8");

        assert.match(html, /operationMode:\s*\{\s*value:\s*"map"\s*\}/);
        assert.match(html, /id="node-input-property"/);
        assert.match(html, /#node-input-map-property/);
        assert.match(html, /#node-input-operationMode/);
    });

});