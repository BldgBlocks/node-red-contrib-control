const assert = require("assert");
const EventEmitter = require("events");
const alarmConfigNode = require("../nodes/alarm-config");

function createHarness() {
    const routes = new Map();
    const nodes = new Map();
    let Constructor;
    const RED = {
        auth: { needsPermission: () => (req, res, next) => next() },
        httpAdmin: {
            get(path, permission, handler) {
                routes.set(path, handler);
            }
        },
        nodes: {
            createNode(node, config) {
                const emitter = new EventEmitter();
                node.id = config.id;
                node.on = emitter.on.bind(emitter);
                node.emit = emitter.emit.bind(emitter);
            },
            getNode(id) {
                return nodes.get(id);
            },
            registerType(type, constructor) {
                if (type === "alarm-config") Constructor = constructor;
            }
        }
    };
    alarmConfigNode(RED);
    const config = new Constructor({ id: "config", name: "alarms" });
    nodes.set("config", config);
    return { config, nodes, routes };
}

function invoke(handler, params) {
    return new Promise(resolve => {
        handler({ params }, { json: resolve });
    });
}

describe("alarm-config HTTP API", function() {
    it("lists deployed alarms alphabetically and returns an empty undeployed list", async function() {
        const { config, routes } = createHarness();
        config.register("n2", { name: "Zone B", status: "active" });
        config.register("n1", { name: "Zone A", status: "cleared" });
        const handler = routes.get("/alarm-config/list/:configId");

        const deployed = await invoke(handler, { configId: "config" });
        assert.deepStrictEqual(deployed.map(alarm => alarm.name), ["Zone A", "Zone B"]);
        assert.deepStrictEqual(deployed.map(alarm => alarm.nodeId), ["n1", "n2"]);

        const undeployed = await invoke(handler, { configId: "missing" });
        assert.deepStrictEqual(undeployed, []);
    });

    it("reports assigned, collision, available, and undeployed alarm names", async function() {
        const { config, routes } = createHarness();
        config.register("n1", { name: "Zone Alarm", status: "cleared" });
        const handler = routes.get("/alarm-config/check/:configId/:alarmName/:nodeId");

        const assigned = await invoke(handler, {
            configId: "config",
            alarmName: encodeURIComponent("Zone Alarm"),
            nodeId: "n1"
        });
        assert.strictEqual(assigned.status, "assigned");

        const collision = await invoke(handler, {
            configId: "config",
            alarmName: encodeURIComponent("Zone Alarm"),
            nodeId: "n2"
        });
        assert.strictEqual(collision.status, "collision");
        assert.strictEqual(collision.details.nodeId, "n1");

        const available = await invoke(handler, {
            configId: "config",
            alarmName: encodeURIComponent("Different Alarm"),
            nodeId: "n2"
        });
        assert.strictEqual(available.status, "available");

        const undeployed = await invoke(handler, {
            configId: "missing",
            alarmName: "Alarm",
            nodeId: "n1"
        });
        assert.strictEqual(undeployed.status, "unavailable");
    });
});