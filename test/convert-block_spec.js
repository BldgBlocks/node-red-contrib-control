const assert = require("assert");
const { helper, buildFlow, waitForMessage } = require("./test-helpers");
const convertBlock = require("../nodes/convert-block");

describe("convert-block algorithms", function() {
    afterEach(() => helper.unload());

    const pairs = [
        ["F to C", "C to F", 212, 100],
        ["K to C", "C to K", 273.15, 0],
        ["K to F", "F to K", 273.15, 32],
        ["R to F", "F to R", 491.67, 32],
        ["decimal to %", "% to decimal", 0.42, 42],
        ["Pa to inH₂O", "inH₂O to Pa", 100, 0.401463],
        ["Pa to inHg", "inHg to Pa", 1000, 0.2953],
        ["Pa to bar", "bar to Pa", 100000, 1],
        ["Pa to psi", "psi to Pa", 6894.75, 1],
        ["m to ft", "ft to m", 1, 3.28084],
        ["m to in", "in to m", 1, 39.3701],
        ["mm to in", "in to mm", 25.4, 1],
        ["kg to lb", "lb to kg", 1, 2.20462],
        ["L to gal", "gal to L", 1, 0.264172],
        ["kW to hp", "hp to kW", 1, 1.34102],
        ["rad to deg", "deg to rad", Math.PI, 180],
        ["s to min", "min to s", 120, 2]
    ];

    pairs.forEach(([forward, reverse, input, expected]) => {
        it(`${forward} and ${reverse} match known values and round trip`, function(done) {
            const flow = buildFlow("convert-block", { conversion: forward });
            helper.load(convertBlock, flow, function() {
                const node = helper.getNode("n1");
                const output = helper.getNode("out");
                const forwardMessage = waitForMessage(output);
                node.receive({ payload: input });

                forwardMessage.then(msg => {
                    assert.ok(Math.abs(msg.payload - expected) < 0.0001, `${forward}: ${msg.payload}`);
                    node.receive({ context: "conversion", payload: reverse });
                    const reverseMessage = waitForMessage(output);
                    node.receive({ payload: msg.payload });
                    return reverseMessage;
                }).then(msg => {
                    assert.ok(Math.abs(msg.payload - input) < 0.0001, `${reverse}: ${msg.payload}`);
                    done();
                }).catch(done);
            });
        });
    });
});