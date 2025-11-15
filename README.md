# @bldgblocks/node-red-contrib-control
Sedona-inspired control nodes for stateful logic.

This is a rather large node collection. Contributions are appreciated.

*** If you are reading this, the package was posted very recently and changes will be flowing as I get examples updated. ***

## Intro
This is intended for HVAC usage but the logic applies to anything. 

Industry visual scripting tools, with Sedona being the original open source solution, use a stateful multi-in/out architecture. Any paradigm can be used in NodeRED but you need to standardize on how things are done. 

Logic should be general, combinable, reusable and easily updated. NodeRED is like a blank canvas and I see this project as a way to provide some standardization with the logic. Seemingly simple, foundational, logic functions standardized. It helps me wrap my head around how to get things done and follow flows when I can wire things in branches that store an outcome and the ability to track which inputs are doing what...

There are TONS of fantastic node libraries out there but usually focusing on one area, or even one node. For my purposes, I want a core set of nodes all in one library that work in a certain, stateful way.

- Full status display of many states
- Full help sections
- Stateful node operation
- Multiple inputs through data tagging
- Many node types. Math, logic, test functions (sqaure wave, sine wave, tick tock, ...), specialized
- Most nodes utilize the Typed Input type to assign global variables
- Validation. Runtime validation is relied on in most cases to evaluate Typed Inputs and provides a status message to indicate errors encountered.
- Node commands, such as 'reset' or 'mode' or changing setpoints via messages.

## How To Use
Pictures to come.

The help section of every node describes the expected msg.context (data tag) for the intended msg.payload incoming. You can of course do this as you process data through a 'change' block, or use the provided 'contextual label' block which makes it easier to add and remove tags, more compact (especially if label hidden), and more transparent of the data flowing (ALL nodes contain complete status usage). Most nodes use a simple in1, in2, and so on. 

##### Example
An 'and' block set to 4 slots must recieve `true` values on each inX at some point to evaluate to a `true` output. Where as, an 'or' block set to 4 inputs could have any input trigger a `true` evaluation. However, a remaining `true` would prevent evaluating to `false`. So the flow may look like 4 small tagging nodes configured in1,in2,in3,in4 connecting to the 'and' block and just wiring your branches of logic to those inputs. You can also negate or have multiple connected to an input and you can watch as each comes in to evaluate. Just try to keep it clean.

## Install
##### Via NodeRED Palette Manager (Not Yet Available)

Search for the package name and add to your project.

##### Via NPM
```
# Navigate to Node-RED user directory (varies by installation)
- $ cd ~/.node-red
- $ npm install node-red-contrib-buildingblocks-control
# then restart node-red
```
