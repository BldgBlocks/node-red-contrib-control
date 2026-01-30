# AI Agent Instructions for node-red-contrib-buildingblocks-control

## Architecture Overview

This is a **Node-RED plugin** providing 60+ Sedona-inspired **stateful control blocks**. Each block is a discrete logic component (math, logic, PID control, etc.) designed for HVAC and general automation workflows.

### File Structure
- **`nodes/*.js`**: Node implementation (runtime logic, message handling, state management)
- **`nodes/*.html`**: Node definition (UI panel, help text, palette registration)
- **`nodes/utils.js`**: Shared utilities (global state helpers, property evaluation, priority handling)
- **`package.json`**: Node-RED registration maps node types to implementation files

## Core Patterns

### Message Protocol
Every node follows a **tagged-input architecture**:
- **`msg.context`**: String identifier for input slot/command (e.g., `"in1"`, `"in2"`, `"reset"`, `"slots"`)
- **`msg.payload`**: The actual data value (number, boolean, or config value)
- **Node Status**: Shows current state—green/blue for normal, red for errors

Example: `{ context: "in1", payload: 42.5 }` updates the first input slot with 42.5.

### Node Structure Pattern
1. **Initialize state** in constructor (`RED.nodes.createNode`)
2. **Validate incoming `msg`**: Check for `msg.context` and `msg.payload` presence
3. **Route by context**:
   - Configuration commands: `"reset"`, `"slots"` (for variable-input nodes)
   - Input slots: `"in1"`, `"in2"`, etc.
   - Unknown contexts: emit status warning
4. **Compute output** based on all slot values (persisted across messages)
5. **Emit status** and send output via `send()`
6. **Track changes**: Compare `lastResult` to avoid redundant outputs

See [add-block.js](nodes/add-block.js) and [and-block.js](nodes/and-block.js) for simple patterns; [pid-block.js](nodes/pid-block.js) for complex example.

### HTML/UI Pattern
- **`<script data-template-name>`**: Editor form (name, configuration fields)
- **`RED.nodes.registerType()`**: Registers node type, sets category `"bldgblocks control"`, color `"#301934"`
- **`<script data-help-name>`**: Markdown help section documenting inputs, outputs, context values
- **Validation**: Use `validate()` in defaults (e.g., slot count ≥ 2)

### Shared Utilities (utils.js)
- **`evaluateNodeProperty()`**: Safely resolves typed inputs (flow/global/msg references)
- **`sendError()` / `sendSuccess()`**: Standardized node status + message response
- **`getGlobalState()` / `setGlobalState()`**: Promise-based global context access
- **`getHighestPriority()`**: Returns highest-priority value from indexed priority slots (used by priority blocks)

Usage: `const utils = require('./utils')(RED);`

## Key Development Tasks

### Adding a New Node
1. Create `nodes/new-node.js` (copy pattern from similar node)
2. Create `nodes/new-node.html` (define UI and help)
3. Register in `package.json` under `"node-red"."nodes"`
4. Follow context-based routing: validate → route by context → compute → emit status

### Common Validation Patterns
- Check `msg.context` and `msg.payload` presence (all nodes do this)
- Parse numeric values: `parseFloat(msg.payload)` with `isNaN()` check
- Parse slot index: `parseInt(msg.context.slice(2))` for inputs like `"in1"`
- Validate ranges: slot index within `[1, node.slots]`, newSlots ≥ 2

### Node Types by Category
- **Math**: add, multiply, divide, negate, modulo
- **Logic**: and, or, boolean-switch, compare, edge
- **Stateful**: latch, memory, cache, accumulate, count
- **Specialized**: pid (full PID controller), hysteresis, interpolate, rate-of-change
- **I/O**: contextual-label (tagging utility), join (combining inputs)

## Testing & Debugging

No explicit test files visible, but nodes use **status indicators** for validation:
- **Green dot**: Normal operation or config update
- **Blue dot**: State changed
- **Blue ring**: State unchanged (no output sent)
- **Red ring**: Error (missing/invalid msg properties)

Test nodes by wiring `contextual-label` blocks to set proper `msg.context` tags, then observing status and output.

## External Dependencies
- **Node-RED ≥ 4.0.0**: Core framework (RED API for nodes, typed inputs, global context)
- **Node.js ≥ 18**: Runtime requirement

No npm packages beyond Node-RED itself; all logic is self-contained.

## Common Pitfalls
- Forgetting to check `msg.context` and `msg.payload` before use
- Not persisting slot values across messages (store in `node.inputs` array)
- Sending output on every input even if unchanged (compare `lastResult` first)
- Invalid context routing (check `startsWith("in")` and validate slot indices)
- PID-specific: Anti-windup integral clamping and proper deadband handling (see pid-block.js comments)

## Conventions This Project Uses Differently
- **Stateful, multi-input design**: Unlike typical Node-RED nodes (single input → single output), blocks maintain indexed slot arrays and accumulate state
- **Tagged message protocol**: `msg.context` is the primary routing mechanism, not separate node instances per input
- **No separate config nodes**: All configuration via messages (reset, slots, parameter updates)
