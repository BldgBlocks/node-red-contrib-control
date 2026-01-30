#!/bin/bash

# Batch refactoring script for Node-RED status helpers
# This script adds utils require to all node .js files that don't have it yet

cd "$(dirname "$0")/nodes"

# List of files that need the utils require added
FILES=(
    "accumulate-block.js"
    "analog-switch-block.js"
    "average-block.js"
    "boolean-to-number-block.js"
    "cache-block.js"
    "call-status-block.js"
    "changeover-block.js"
    "comment-block.js"
    "contextual-label-block.js"
    "convert-block.js"
    "count-block.js"
    "delay-block.js"
    "enum-switch-block.js"
    "frequency-block.js"
    "global-getter.js"
    "global-setter.js"
    "history-collector.js"
    "hysteresis-block.js"
    "interpolate-block.js"
    "join.js"
    "latch-block.js"
    "load-sequence-block.js"
    "max-block.js"
    "memory-block.js"
    "min-block.js"
    "minmax-block.js"
    "negate-block.js"
    "network-read.js"
    "network-register.js"
    "network-write.js"
    "network-point-registry.js"
    "nullify-block.js"
    "on-change-block.js"
    "oneshot-block.js"
    "pid-block.js"
    "priority-block.js"
    "rate-limit-block.js"
    "rate-of-change-block.js"
    "round-block.js"
    "scale-range-block.js"
)

# Count how many files need the require
COUNT=0
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        if ! grep -q "const utils = require('./utils')" "$file"; then
            COUNT=$((COUNT + 1))
        fi
    fi
done

echo "Files that need utils require added: $COUNT"
echo "To proceed with refactoring, run status helper replacement commands for each file"
