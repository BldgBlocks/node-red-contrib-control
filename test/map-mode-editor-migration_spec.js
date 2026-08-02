const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("map-mode editor migration", function() {
    const nodeTypes = ["and", "or", "add", "subtract", "multiply", "divide"];

    nodeTypes.forEach(type => {
        it(`defaults new ${type} nodes to map mode and migrates old nodes to context mode`, function() {
            const html = fs.readFileSync(path.join(__dirname, `../nodes/${type}-block.html`), "utf8");

            assert.match(html, /operationMode:\s*\{\s*value:\s*"map"\s*\}/);
            assert.match(html, /node\.operationMode !== "map" && node\.operationMode !== "context"/);
            assert.match(html, /node\.operationMode = "context"/);
            assert.match(html, /#node-input-operationMode/);
        });
    });
});