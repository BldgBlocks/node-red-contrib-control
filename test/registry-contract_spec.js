const assert = require("assert");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

const packageJson = require("../package.json");

function createRegistrationRed() {
    const registrations = [];
    const noopRoute = () => {};
    const RED = {
        auth: { needsPermission: () => noopRoute },
        events: new EventEmitter(),
        httpAdmin: {
            delete: noopRoute,
            get: noopRoute,
            post: noopRoute,
            put: noopRoute
        },
        nodes: {
            createNode: noopRoute,
            getNode: () => null,
            registerType: (type, constructor) => registrations.push({ type, constructor })
        },
        settings: {},
        util: {}
    };

    return { RED, registrations };
}

describe("registered node contracts", function() {
    const registeredModules = packageJson["node-red"].nodes;

    Object.entries(registeredModules).forEach(([moduleName, relativeJsPath]) => {
        it(`${moduleName} registers runtime and editor definitions`, function() {
            const absoluteJsPath = path.join(__dirname, "..", relativeJsPath);
            const absoluteHtmlPath = absoluteJsPath.replace(/\.js$/, ".html");
            const registerModule = require(absoluteJsPath);
            const { RED, registrations } = createRegistrationRed();

            assert.strictEqual(typeof registerModule, "function", `${relativeJsPath} must export a function`);
            assert.ok(fs.existsSync(absoluteHtmlPath), `${relativeJsPath} must have a matching HTML file`);

            registerModule(RED);

            assert.ok(registrations.length > 0, `${relativeJsPath} must register at least one node type`);
            const html = fs.readFileSync(absoluteHtmlPath, "utf8");
            const editorTypes = [...html.matchAll(/data-template-name="([^"]+)"/g)].map(match => match[1]);
            assert.ok(editorTypes.length > 0, `${relativeJsPath} must have an editor template`);
            editorTypes.forEach(type => {
                const registration = registrations.find(candidate => candidate.type === type);
                assert.ok(registration, `${type} must register a runtime constructor`);
                assert.strictEqual(typeof registration.constructor, "function", `${type} must register a constructor`);
                assert.ok(html.includes(`data-help-name="${type}"`), `${type} must have editor help`);
            });
        });
    });
});