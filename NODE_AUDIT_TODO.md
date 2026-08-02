# Node Review Questionnaire

Last updated: 2026-08-02

This is a decision list, not a defect list. Each packaged node has one question. Mark one option per node:

- **Accept**: proceed with the proposed behavior and tests.
- **Skip**: leave the node unchanged for this pass.
- **Other**: write the preferred behavior after the label.

## Confirmed Behavior

- Runtime `delayOn` and `delayOff` messages are temporary overrides; configured or typed values apply again on the next normal message.
- `boolean-to-number-block` is intentionally bidirectional: booleans become `0`/`1`, while numeric `0`/`1` become booleans.
- `accumulate-block` reset already works through `msg.context = "reset"`, `resetCount()`, and the admin endpoint. The open work is test depth, not reset implementation.

Unknown-context handling is intentionally undecided at the library level. Review it by node role rather than applying one behavior everywhere.

## Questions

### accumulate-block
Should we keep all existing reset paths and add tests for message reset, admin reset, true/false/flows modes, invalid input, and rollover?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### add-block
Should we add tests for reset, dynamic slots, invalid numbers, malformed mappings, and custom output paths without changing its algorithm?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### analog-switch-block
When `slots` is missing or invalid, should the node default to two slots and continue operating?
- [ ] **Accept**: default to two and test selection/active-input behavior
- [ ] **Skip**
- [x] **Other**: slots is a config time setting, not changed at runtime.

### and-block
Should boolean inputs use the shared coercion contract (`false`, `"false"`, `0`, and `"0"` are false) instead of JavaScript truthiness?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: im more concerned about true/false and 0/1 working and less on strings. But yes.

### average-block
Should an invalid `sampleSize` fall back to a documented default, with tests for filtering, reset, resizing, and dynamic limits?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: THis is a config time error and should cause a message before deploy. If it is changed at runtime, then its a status message error and ignore change. Tests for all.

### boolean-switch-block
Should routing use the shared boolean coercion contract in both context and map modes?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: Im not sure I understand the nuance here.

### boolean-to-number-block
Should we preserve bidirectional conversion and add explicit tests for `true -> 1`, `false -> 0`, `1 -> true`, `0 -> false`, null policy, and invalid types?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### cache-block
Should circular or undefined values be handled without status-formatting exceptions, with tests for clone, payload-only, empty-cache, execute, and reset paths?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: can we disallow circular. Not sure how that would happen here but... make a recommendation here.

### call-status-block
Should we retain current behavior and add focused tests for debounce, heartbeat expiry/recovery, inactive timeout, and timer cleanup?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: yes majorly. This node is a bit complicated and less tested.

### changeover-block
Should we add failure-path tests for corrupted persistence, write errors, concurrent input, force/bypass actions, and close during write?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: non-invasive tests only. This node works and has had a lot of work.

### comment-block
Should circular objects produce a safe truncated preview rather than a formatting error?
- [x] **Accept**: also test JSONata errors, missing properties, and passthrough
- [ ] **Skip**
- [x] **Other**: I dont know how we would get circular objects.

### compare-block
Should we keep the current comparison algorithm and test setpoint updates, invalid input, equality, and every output-selection combination?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: keep as is as opposed to what?

### contextual-label-block
Should we add tests for label removal, missing nested properties, and replacing an existing context label?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### convert-block
Should every supported conversion receive table-driven tests with inverse-pair tolerances?
- [x] **Accept**
- [] **Skip**
- [ ] **Other**:

### count-block
Should counting remain rising-edge based, with tests for repeated values, reset, nested properties, and overflow behavior?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### delay-block
Should we preserve temporary message overrides and add tests proving configured/typed delays resume on the next normal message?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### divide-block
Should we retain the current sequential division behavior and test zero/near-zero, reset, resizing, invalid mappings, and non-finite input?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### edge-block
Should unknown contexts continue to be silently ignored while valid untagged payloads are processed normally?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### enum-select
Should malformed or duplicate keys be rejected while unknown selection keys are silently ignored?
- [x] **Accept**: add missing-payload and close-state tests too
- [ ] **Skip**
- [ ] **Other**:

### enum-switch-block
Should malformed rules be ignored safely instead of allowing non-string boolean rule values to throw?
- [x] **Accept**: also test every comparison type
- [ ] **Skip**
- [ ] **Other**:

### extrema-block
Should uninitialized slots participate as zero, or should min/max wait until every slot has received a value?
- [ ] **Accept**: keep zero-filled slot semantics and document/test them
- [ ] **Skip**
- [x] **Other**: ignore slots that have not recieved a value?

### frequency-block
When pulses are too fast to measure reliably, should output clamp to a documented maximum in the selected frequency units?
- [x] **Accept**: correct units and add period/reset/duty-cycle boundary tests
- [ ] **Skip**
- [ ] **Other**:

### hysteresis-block
Should typed properties be evaluated only once asynchronously per message, removing the later synchronous overwrite?
- [ ] **Accept**: add transition and boundary tests
- [ ] **Skip**
- [x] **Other**: Im not sure. Discuss

### interpolate-block
Should interpolation tables require strictly monotonic, non-duplicate X coordinates?
- [ ] **Accept**
- [ ] **Skip**
- [x] **Other**: yes i guess, but this has not been an issue. We cant save people from themselves if you know what I mean.

### join
Should we preserve current type aliases and add tests for registration compatibility, reset, timeout, and partial joins?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### latch-block
Should set/reset values use shared boolean coercion rather than raw JavaScript truthiness?
- [ ] **Accept**: normalize configured state and test every transition
- [ ] **Skip**
- [x] **Other**: Im weak on JS truthiness... Maybe you can infer from my other responses.

### load-sequence-block
Should we treat the existing state machine as intended and build tests for sequencing, interlocks, hysteresis, kill/disable, updates, and cleanup before changing it?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### memory-block
Should persistence retain its current semantics while we add startup, fallback, write-on-update, error, and close-flush tests?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**: Discuss usefullness of this node. vs nodered conventions. file based?

### minmax-block
Should we retain current clamping behavior and test dynamic limits, runtime updates, invalid ranges, boundaries, and message preservation?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### modulo-block
Should modulo gain map mode and configurable output-property parity with the other arithmetic blocks?
- [x] **Accept**: add parity plus zero-divisor, reset, resizing, sign, and non-finite tests
- [ ] **Skip**: keep context-only behavior
- [ ] **Other**:

### multiply-block
Should we add reset, resize, malformed mapping, non-finite/overflow, and custom output-path tests without changing multiplication behavior?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: reset is unneccessary

### negate-block
Should negate continue supporting booleans and numbers, with explicit tests for null, unsupported types, nested input, and message preservation?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### nullify-block
Should we retain current deletion semantics and test targeted deletion, missing paths, passthrough, and invalid configuration?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### on-change-block
Should deep object comparison remain supported, including safe handling of circular values?
- [ ] **Accept**: also test dynamic periods, runtime updates, and close cleanup
- [x] **Skip**
- [ ] **Other**:

### oneshot-block
Should retriggers remain locked during an active pulse, with tests for completion, reset, duration updates, reset-on-complete, and close cancellation?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### or-block
Should boolean inputs use the shared coercion contract instead of JavaScript truthiness?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: I think?

### pid-block
Should we preserve the repaired optional bounds and elapsed-time rate limiting, then add tests for deadband, integral, derivative, tuning, dynamic config, and anti-windup?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**: I love a good PID... yes please.

### pulse-block
Should we retain current pulse behavior and add invalid command/unit, missing payload, reset, interval restart, and close-cleanup tests?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### priority-block
Current behavior is well covered. Should this node be skipped unless a new issue appears?
- [x] **Accept**: skip further work
- [ ] **Skip**: review it further anyway
- [ ] **Other**:

### rate-limit-block
Should we preserve asymmetric rise/fall rates and add tests for elapsed-time scaling, all modes, invalid rates, reset, and dynamic values?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### rate-of-change-block
Should invalid, duplicate, or out-of-order timestamps be ignored rather than stored in the estimator history?
- [x] **Accept**: add reset and reconfiguration tests too
- [ ] **Skip**
- [ ] **Other**:

### round-block
When `inputProperty` is configured, should the rounded result be written back to that same property rather than always to `payload`?
- [ ] **Accept**: add nested-property, negative-tie, and precision tests
- [ ] **Skip**
- [x] **Other**: make an 'output property' field in the node UI payload is default for each

### saw-tooth-wave-block
Should we retain the existing waveform definition and add deterministic tests for phase, units, wraparound, limit updates, and long scheduling gaps?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### scale-range-block
Should reversed output ranges be supported for intentional inversion?
- [x] **Accept**: support and test reversed ranges; validate initial bounds and fix status text
- [ ] **Skip**: continue rejecting reversed ranges
- [x] **Other**: reversed and projected ranges. I think it has this?

### sine-wave-block
Should we retain the existing waveform definition and add deterministic tests for limits, phase, units, updates, and full-cycle extrema?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### string-builder-block
Should unknown contexts be ignored because this is a calculation/formatting node, while recognized inputs and evaluation failures receive tests?
- [ ] **Accept**: silently ignore unknown contexts
- [ ] **Skip**
- [ ] **Other**: warn in status / report through `done(error)` / This passes a new clean message out so it should not silently ignore wrong context

### subtract-block
Should we add reset, invalid input, malformed mapping, non-finite, resize, and output-path tests without changing subtraction behavior?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: reset is unneccessary

### thermistor-block
Should invalid configuration keep the node deployed but inert, or should valid fallback defaults be applied?
- [x] **Accept**: keep it inert and test ADC boundaries, buffers, divider math, and duplicate suppression
- [ ] **Skip**
- [ ] **Other**:

### tick-tock-block
Should period changes take effect immediately while running?
- [x] **Accept**: restart timing and test start/stop, duplicate commands, initial output, and cleanup
- [ ] **Skip**
- [ ] **Other**:

### time-sequence-block
How should overlapping triggers behave while a sequence is active?
- [x] **Accept**: ignore retriggers and test all stages, reset, updates, cloning, and cleanup
- [ ] **Skip**
- [ ] **Other**:

### triangle-wave-block
Should we preserve the repaired full-range waveform and add deterministic phase, units, runtime-limit, and wraparound tests?
- [ ] **Accept**
- [x] **Skip**
- [ ] **Other**:

### tstat-block
Should we retain the current algorithms and fail-safe behavior, adding only typed-input failure and timer-cleanup tests?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### units-block
When `inputProperty` points elsewhere, should the node accept messages without `payload` and attach units to the message?
- [ ] **Accept**: add nested, null/object, replacement, and invalid-message tests
- [ ] **Skip**
- [x] **Other**: this node only cares about appending a msg.units. Possibly specify a desired path.

### global-getter
Should we preserve current subscription/retry semantics and add tests for reconnection, flow output, legacy values, missing setters, and listener cleanup?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### global-setter
Should we preserve current priority semantics and add tests for precedence, fallback/reload, store mirroring, races, event emission, and timer cleanup?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### history-collector
Should strings be escaped for the selected storage format before emission?
- [x] **Accept**: test every format, tags, typed evaluation, eviction, and events
- [ ] **Skip**
- [ ] **Other**:

### history-config
Should names be sanitized to storage-safe identifiers while preserving the user-facing display name?
- [ ] **Accept**: add defaults and series-preservation tests
- [ ] **Skip**
- [x] **Other**: we should not lie or mislead the user. If changes are made, change and show corrected. or show error.

### history-service
Should malformed collector events be ignored silently while valid events remain isolated by configuration?
- [ ] **Accept**: add relay, throttled-status, and cleanup tests
- [ ] **Skip**
- [x] **Other**: This should not be common so this should be a debug window warning because this is a service.

### history-buffer
Should persisted file discovery be restricted to files belonging to the current node ID?
- [ ] **Accept**: add migration, rotation, pruning, queueing, malformed-line, and shutdown tests
- [x] **Skip**
- [ ] **Other**:

### network-service-registry
Should duplicate point IDs reject the later registration while updates from the owning node remain allowed?
- [ ] **Accept**: add unregister, HTTP validation/listing, invalid-ID, and cleanup tests
- [ ] **Skip**
- [x] **Other**: duplicates are already not allowed.

### network-service-bridge
Should requests remain strictly correlated by request ID, with late or unknown responses silently ignored?
- [x] **Accept**: test startup, remote errors, all timeout paths, statistics, and cleanup
- [ ] **Skip**
- [ ] **Other**:

### network-service
When state metadata is absent, should writes initialize metadata rather than fail?
- [x] **Accept**: test writable/read-only writes, release/fallback, type mismatch, and partial discovery
- [ ] **Skip**
- [x] **Other**: Im not sure this can happen where it is advertised but not initialized.

### network-point-register
Should redeploy preserve registration while actual node removal unregisters the point?
- [ ] **Accept**: add collision, enrichment, global update, event, and passthrough tests
- [ ] **Skip**
- [x] **Other**: I think this is already done.

### network-point-read
Should stale or unknown responses be silently ignored while the current request retains its timeout and cache behavior?
- [ ] **Accept**: add startup, reset, custom output, and cleanup tests
- [x] **Skip**
- [ ] **Other**:

### network-point-discover
Should duplicate triggers be ignored while discovery is pending?
- [ ] **Accept**: add missing-bridge, remote/stale error, endpoint authorization, and cleanup tests
- [ ] **Skip**
- [x] **Other**: I think this is already handled.

### network-point-write
Should concurrent writes be queued, or should a new write supersede the pending write?
- [ ] **Accept**: queue writes and test confirmation, error, release, timeout, priority, and cleanup
- [x] **Skip**: keep latest-write-wins behavior
- [ ] **Other**:

### alarm-collector
Should numeric zero be preserved as a valid configured alarm threshold?
- [x] **Accept**: add zero-threshold, boolean mode, setter subscription, typed-message, and unregister tests
- [ ] **Skip**
- [ ] **Other**:

### alarm-config
Should registry updates and unregister operations be directly tested in addition to collector integration?
- [x] **Accept**: include both HTTP endpoints
- [ ] **Skip**
- [ ] **Other**:

### alarm-service
Should active alarms be keyed by collector/node ID so multiple collectors may share a topic independently?
- [x] **Accept**: add same-topic, filter, and query tests
- [ ] **Skip**: topic identity is intentionally unique
- [x] **Other**: Doesnt this already work?

## Cross-cutting Questions

### Unknown contexts
Adopt a role-based default while retaining per-node exceptions?
- [x] **Accept**: calculation/transformation nodes silently ignore unknown contexts; routing, sequencing, state, and command nodes show a warning status; unknown contexts do not call `done(error)`
- [ ] **Skip**: preserve each node's current behavior
- [x] **Other**: decide every node individually / specify another policy - Im not sure how to define the line, but I have had it figured out before...

### Boolean coercion
Adopt one shared boolean conversion contract across logic nodes?
- [x] **Accept**
- [ ] **Skip**
- [x] **Other**: Yes I think so.

### Timer lifecycle
Add deterministic timer and close-cleanup tests to every node that owns a timeout or interval?
- [x] **Accept**
- [ ] **Skip**
- [ ] **Other**:

### Typed-input concurrency
Should async nodes queue the latest message instead of dropping messages while busy?
- [ ] **Accept**: queue latest
- [x] **Skip**: preserve drop-while-busy behavior
- [ ] **Other**:

### Input and output properties
Should calculation/transformation nodes that expose `inputProperty` also expose a separate `outputProperty`, defaulting to `payload`?
- [ ] **Accept**: standardize calculation/transformation nodes; `inputProperty` selects only what to read and `outputProperty` selects where the result is written
- [ ] **Skip**: preserve each node's current output behavior
- [x] **Other**: This is a inbetween feature as I have added things. I have recently started adding the output properties. I dont want to over complicate, but it was necessary in some cases so standardizing may be the way to go.

Recommendation: **Accept**, scoped by node role rather than applied to every node with an input property.

- Add `outputProperty` to primary-value calculators/transformers currently fixed to `payload`: `accumulate-block`, `average-block`, `boolean-to-number-block`, `convert-block`, `count-block`, `frequency-block`, `interpolate-block`, `pid-block`, `rate-of-change-block`, `round-block`, and `scale-range-block`.
- Keep established payload/port contracts for decision and state nodes: `compare-block`, `edge-block`, `hysteresis-block`, and `oneshot-block`.
- Keep established contracts for nodes whose purpose is routing, observation, serialization, or an external side effect: `changeover-block`, `contextual-label-block`, `global-setter`, `history-collector`, `network-point-write`, `on-change-block`, and `units-block`.
- Preserve the original message and write only the result property unless a node's documented contract intentionally creates a new message.
- Treat `boolean-to-number-block` as a migration case: it currently writes the converted value back to `inputProperty`, so existing deployed flows need backward-compatible handling when `outputProperty` is introduced.
