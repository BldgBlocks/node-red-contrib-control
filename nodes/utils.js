// nodes/utils.js
module.exports = {
    getTypedValue: function(node, type, value, msg) {
        if (type === "msg") {
            try {
                return RED.util.getMessageProperty(msg, value);
            } catch (e) {
                return undefined;
            }
        } else if (type === "flow" || type === "global") {
            if (typeof value !== "string") {
                return undefined;
            }
            let path = value;
            if (path.startsWith('["') && path.endsWith('"]')) {
                try {
                    path = JSON.parse(path);
                } catch (e) {
                    return undefined;
                }
            }
            try {
                const context = type === "flow" ? node.context().flow : node.context().global;
                return context.get(path);
            } catch (e) {
                return undefined;
            }
        }
        return value;
    },
    validateProperty: function(value, type, defaultValue, constraints = {}, msg, node) {
        let parsed;
        if (type === "msg" || type === "flow" || type === "global") {
            parsed = this.getTypedValue(node, type, value, msg);
        } else {
            parsed = type === "num" ? parseFloat(value) : type === "bool" ? !!value : value;
        }
        if (parsed === undefined || parsed === null) {
            if (Object.keys(msg).length > 0) {
                node.status({ fill: "red", shape: "ring", text: `invalid ${constraints.name || "value"}` });
            }
            return defaultValue;
        }
        const numValue = parseFloat(parsed);
        if (isNaN(numValue) || (constraints.min !== undefined && numValue < constraints.min) || (constraints.max !== undefined && numValue > constraints.max)) {
            if (Object.keys(msg).length > 0) {
                node.status({ fill: "red", shape: "ring", text: `invalid ${constraints.name || "value"}` });
            }
            return defaultValue;
        }
        return numValue;
    }
};