# Node-RED Help Style Guide

> **Note**: This is a snapshot of the Node-RED help style guide captured for AI/LLM reference within this project. It may become outdated. For the authoritative, up-to-date guide, see [Node-RED docs](https://nodered.org/docs/creating-nodes/help-style-guide).

## Overview

When a node is selected, its help text is displayed in the info tab. This help should provide the user with all the information they need in order to use the node.

The following style guide describes how the help should be structured to ensure a consistent appearance between nodes.

### Markdown vs HTML

Since Node-RED 2.1.0, the help text can be provided as **markdown** rather than HTML. In this case, the `type` attribute of the `<script>` tag must be `text/markdown`.

When creating markdown help text, be careful with indentation—markdown is whitespace sensitive, so all lines should have no leading whitespace inside the `<script>` tags.

## Help Structure

The help text should follow this standard structure:

### 1. Introduction

This section provides a high-level introduction to the node. It should be no more than 2-3 lines long. The first line (`<p>` or first paragraph) is used as the tooltip when hovering over the node in the palette.

**Example**:
```
Connects to a MQTT broker and publishes messages.
```

### 2. Inputs

If the node has an input, this section describes the properties of the message the node will use. The expected type of each property can also be provided. The description should be brief—if further description is needed, it should be in the Details section.

**Format**: Use a description list with message properties.

### 3. Outputs

If the node has outputs, this section (similar to Inputs) describes the properties of the messages the node will send. If the node has multiple outputs, a separate property list can be provided for each.

### 4. Details

This section provides more detailed information about the node. It should explain how it should be used, providing more information on its inputs/outputs, including any configuration options.

### 5. References

This section can be used to provide links to external resources, such as:
- Any relevant additional documentation
- The node's git repository or npm page
- Related APIs or external service documentation

## Formatting Reference

### Section Headers

Each section must be marked up with an `<h3>` tag. If the `Details` section needs sub-headings, they must use `<h4>` tags.

**HTML Example**:
```html
<h3>Inputs</h3>
...
<h3>Details</h3>
...
<h4>A sub section</h4>
...
```

**Markdown Example**:
```markdown
### Inputs
...
### Details
...
#### A sub section
...
```

### Message Properties

A list of message properties is marked up with a `<dl>` list. The list must have a `class="message-properties"` attribute.

Each item in the list consists of a pair of `<dt>` and `<dd>` tags:
- `<dt>` contains the property name and an optional `<span class="property-type">` with the expected type
- If the property is optional, the `<dt>` should have `class="optional"`
- `<dd>` contains a brief description of the property

**HTML Example**:
```html
<dl class="message-properties">
    <dt>payload
        <span class="property-type">string | buffer</span>
    </dt>
    <dd>the payload of the message to publish.</dd>
    <dt class="optional">topic
        <span class="property-type">string</span>
    </dt>
    <dd>the MQTT topic to publish to.</dd>
</dl>
```

**Markdown Example** (using HTML within markdown):
```markdown
- **payload** *(string | buffer)* - the payload of the message to publish.
- **topic** *(string, optional)* - the MQTT topic to publish to.
```

### Multiple Outputs

If the node has multiple outputs, each output should have its own message property list. Those lists should be wrapped in an `<ol>` list with `class="node-ports"`.

Each item should consist of a brief description of the output followed by a `<dl>` message property list.

**Note**: If the node has a single output, it should not be wrapped in such a list—just use the `<dl>` directly.

**HTML Example**:
```html
<ol class="node-ports">
    <li>Standard output
        <dl class="message-properties">
            <dt>payload <span class="property-type">string</span></dt>
            <dd>the standard output of the command.</dd>
        </dl>
    </li>
    <li>Standard error
        <dl class="message-properties">
            <dt>payload <span class="property-type">string</span></dt>
            <dd>the standard error of the command.</dd>
        </dl>
    </li>
</ol>
```

### General Guidance

When referencing a message property outside of a message property list, prefix it with `msg.` and wrap it in `<code>` tags to make it clear to the reader.

**Example**:
```html
The interesting part is in <code>msg.payload</code>.
```

**Markdown Example**:
```markdown
The interesting part is in `msg.payload`.
```

- **No other styling markup** should be used within the body of help text (e.g., `<b>`, `<i>`)
- The help should not assume the reader is an experienced developer or deeply familiar with whatever the node exposes
- Above all, the help needs to be **helpful**

## Complete Example

### HTML Version

```html
<script type="text/html" data-help-name="mqtt-out">
<p>Connects to a MQTT broker and publishes messages.</p>

<h3>Inputs</h3>
<dl class="message-properties">
    <dt>payload
        <span class="property-type">string | buffer</span>
    </dt>
    <dd>the payload of the message to publish.</dd>
    <dt class="optional">topic
        <span class="property-type">string</span>
    </dt>
    <dd>the MQTT topic to publish to.</dd>
</dl>

<h3>Outputs</h3>
<ol class="node-ports">
    <li>Standard output
        <dl class="message-properties">
            <dt>payload <span class="property-type">string</span></dt>
            <dd>the standard output of the command.</dd>
        </dl>
    </li>
    <li>Standard error
        <dl class="message-properties">
            <dt>payload <span class="property-type">string</span></dt>
            <dd>the standard error of the command.</dd>
        </dl>
    </li>
</ol>

<h3>Details</h3>
<p><code>msg.payload</code> is used as the payload of the published message.
If it contains an Object it will be converted to a JSON string before being sent.
If it contains a binary Buffer the message will be published as-is.</p>

<p>The topic used can be configured in the node or, if left blank, can be set
by <code>msg.topic</code>.</p>

<p>Likewise the QoS and retain values can be configured in the node or, if left
blank, set by <code>msg.qos</code> and <code>msg.retain</code> respectively.</p>

<h3>References</h3>
<ul>
    <li><a href="#">MQTT Specification</a> - official MQTT documentation</li>
    <li><a href="#">GitHub</a> - the node's github repository</li>
</ul>
</script>
```

### Markdown Version

```markdown
<script type="text/markdown" data-help-name="mqtt-out">
Connects to a MQTT broker and publishes messages.

### Inputs

- **payload** *(string | buffer)* - the payload of the message to publish.
- **topic** *(string, optional)* - the MQTT topic to publish to.

### Outputs

1. Standard output
   - **payload** *(string)* - the standard output of the command.

2. Standard error
   - **payload** *(string)* - the standard error of the command.

### Details

`msg.payload` is used as the payload of the published message.
If it contains an Object it will be converted to a JSON string before being sent.
If it contains a binary Buffer the message will be published as-is.

The topic used can be configured in the node or, if left blank, can be set by `msg.topic`.

Likewise the QoS and retain values can be configured in the node or, if left blank, set by `msg.qos` and `msg.retain` respectively.

### References

- [MQTT Specification](https://mqtt.org/) - official MQTT documentation
- [GitHub](https://github.com/node-red/node-red-nodes) - the node's github repository
</script>
```

## Building Blocks Project Conventions

### Stateful Control Blocks

For this project's stateful control blocks, the help should include:

1. **Introduction** - What does the block do? (1-2 lines)
2. **Inputs** - Document the tagged-input protocol:
   - Standard properties (context, payload)
   - Configuration messages (reset, slots)
   - Input slots (in1, in2, in3, etc.)
3. **Outputs** - Describe the output payload format
4. **Details** - Explain:
   - How the block maintains state
   - Configuration options and defaults
   - Any special behaviors (e.g., accumulation, change detection)
5. **Status** - Document status indicators:
   - Green dot: Config update or state reset
   - Blue dot: Output sent with state change
   - Blue ring: No state change (output still sent)
   - Red ring: Validation error
   - Yellow ring: Warning condition

### Example Structure for Math Blocks

```markdown
Adds multiple numeric input slots together.

### Inputs

- **context** *(string)* - Identifies the input slot or command:
  - `"in1"`, `"in2"`, etc.: Update the corresponding input slot
  - `"reset"`: Reset all slots to 0 (requires payload: true)
  - `"slots"`: Change the number of input slots (requires numeric payload)
- **payload** *(number | boolean)* - The value or command parameter

### Outputs

- **payload** *(number)* - The sum of all input slots

### Details

The block maintains an array of input slots, initially set to 0. Each slot can be updated via messages with context `"in1"`, `"in2"`, etc.

The sum is calculated whenever any input slot changes and is immediately output.

**Configuration**:
- Number of slots: Defaults to 2, can be changed via `{"context": "slots", "payload": 3}` messages
- Reset state: Send `{"context": "reset", "payload": true}` to return all slots to 0

### Status

- **Green dot**: Configuration update received (slots changed, state reset)
- **Blue dot**: Output sent with sum changed
- **Blue ring**: Output sent, sum unchanged
- **Red ring**: Validation error (missing context/payload, invalid slot index)
```

## See Also

- [Node-RED Help Style Guide](https://nodered.org/docs/creating-nodes/help-style-guide)
- [Node-RED Docs - Creating Nodes](https://nodered.org/docs/creating-nodes/)
