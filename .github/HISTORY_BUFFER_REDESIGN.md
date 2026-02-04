# History Buffer Node Redesign
## Technical Design Document: File-Based Chunking Architecture

**Date**: February 2026  
**Status**: Design Phase  
**Target Platform**: Raspberry Pi 4 (2GB RAM, microSD card)  
**Goal**: Eliminate Node-RED crashes and SD card wear while maintaining persistent trend sparklines

---

## Executive Summary

The current `history-buffer` node uses Node-RED's global context store with async operations. Despite async reads, it causes:
- **Pi crashes** from JSON.stringify() serialization blocking the event loop (5-10MB JSON files)
- **CPU spikes** during context.set() every 10 minutes
- **High memory pressure** (30MB JSON = 60-90MB in RAM due to V8 overhead)
- **SD card wear** from frequent large file writes

**Root Cause**: Node-RED's `localfilesystem` context store loads the entire file into memory as a single JSON object. Even async reads block the main thread when parsing. One monolithic buffer means one massive JSON serialization every flush.

**Solution**: Replace global context with direct file system I/O using hourly chunks:
- Split 3-hour history into ~3 hourly JSON files (130KB each vs. 30MB)
- Load files on delayed startup (5-10 sec after boot), sequentially with 200ms pauses
- Commit live data every 5 seconds to a small "live" buffer (non-blocking fs.writeFile)
- Auto-rotate and prune old chunks to maintain sliding 3-hour window
- Bypass Node-RED context entirely—use raw fs module

**Performance Impact**:
- Startup: +5-10 seconds delayed (acceptable; users expect chart to load)
- Live writes: Every 5 seconds, ~1KB async file write (non-blocking)
- Memory: ~3MB peak during chunk load, drops to ~500KB steady state
- SD wear: ~12 writes/hour (vs. 6 per 10-minute interval = more frequent but smaller)
- CPU: Negligible; no event-loop blocking

---

## 1. File Structure & Storage

### 1.1 Directory Layout

```
NODE_RED_HOME/
├── .bldgblocks/
│   ├── trends/
│   │   ├── [node-id]/
│   │   │   ├── meta.json                    # Node config snapshot
│   │   │   ├── live.json                    # Current 5-min buffer (1-5KB)
│   │   │   ├── trend_chunk_0000.json        # Hour 0 (oldest)
│   │   │   ├── trend_chunk_0001.json        # Hour 1
│   │   │   ├── trend_chunk_0002.json        # Hour 2 (newest)
│   │   │   └── .lock                        # Prevents race conditions on rapid redeploy
│   │   └── [other-node-id]/
│   │       ├── meta.json
│   │       ├── live.json
│   │       └── trend_chunk_*.json
```

**Design rationale**:
- **Per-node directory**: Each history-buffer node has its own isolated directory (prevents conflicts with multiple nodes)
- **meta.json**: Stores node config (bufferHours, seriesNames, etc.) for validation
- **live.json**: Small buffer for unflushed data since last commit (lightweight, non-critical)
- **trend_chunk_NNNN.json**: Immutable hourly chunks; numbered sequentially
- **.lock**: Prevents file access during node redeploy/initialization

### 1.2 File Naming Convention

```
trend_chunk_NNNN.json
        ↑    ↑
        |    └─ 4-digit zero-padded hour sequence number
        └────── Fixed prefix for glob pattern matching
```

**Example progression**:
- `trend_chunk_0000.json` → stored 180-120 min ago
- `trend_chunk_0001.json` → stored 120-60 min ago
- `trend_chunk_0002.json` → stored 60-0 min ago
- On next hourly rotation: 0000 deleted, 0001→kept, 0002→kept, new 0003 created

**Why this naming**:
- Sortable by creation order (can list & parse in sequence)
- Glob pattern `trend_chunk_*.json` finds all chunks easily
- Numeric suffix allows rotation without timestamp parsing

### 1.3 Data Format

#### **Live Buffer** (live.json)
```json
[
  {
    "topic": "zone1_temp",
    "payload": 21.5,
    "ts": 1738502400000
  },
  {
    "topic": "zone2_temp",
    "payload": 19.8,
    "ts": 1738502405000
  }
]
```

**Format choice: JSON array of objects**
- **Why JSON array, not line-delimited JSON (NDJSON)?**
  - FlowFuse ui-chart expects JSON array objects
  - Simpler to load & validate (one fs.readFile + JSON.parse)
  - Small file size makes parsing negligible
  - NDJSON parsing would require streaming, more complex

- **Payload**: Number, boolean, or string (matches incoming msg.payload)
- **Topic**: Series identifier (e.g., "Return Temperature")
- **ts**: Millisecond epoch timestamp (standard across Node-RED)

**Live buffer characteristics**:
- Accumulates data for ~5 minutes (typically 5-50 entries per topic × 5 topics = 25-250 points total)
- Estimated size: 1-5KB on disk (100 bytes per point × ~30 points)
- Parsed into memory ~once per 5 seconds
- Overwritten each commit (not appended—replaced)

#### **Hourly Chunks** (trend_chunk_NNNN.json)
```json
[
  {
    "topic": "zone1_temp",
    "payload": 21.5,
    "ts": 1738502400000
  },
  {
    "topic": "zone2_temp",
    "payload": 19.8,
    "ts": 1738502405000
  },
  ...
]
```

**Hourly chunk characteristics**:
- **Points per chunk**: ~600-1800 depending on sampling
  - 5 topics × ~30 points/minute × 60 minutes = 9,000 worst case
  - Realistic: 5 topics × ~4 points/minute × 60 min = 1,200 points
- **File size per chunk**: ~120-180KB on disk
- **In-memory size when loaded**: ~400-600KB (due to V8 object overhead)
- **Immutable once written**: Prevents corruption during reads
- **Loaded sequentially with 200ms pauses**: Prevents memory spikes

#### **Metadata File** (meta.json)
```json
{
  "nodeId": "abc123def456",
  "bufferHours": 3,
  "created": 1738502400000,
  "lastRotation": 1738502400000,
  "chunkCount": 3,
  "hasLiveBuffer": true
}
```

**Purpose**: Validation on startup; ensures config hasn't changed incompatibly

### 1.4 File Rotation & Pruning Strategy

#### **Hourly Rotation Trigger**
- **Check interval**: Every 60 seconds (lightweight timer)
- **Trigger condition**: `Math.floor(now / 3600000) > Math.floor(lastRotationTime / 3600000)`
  - Triggers once per hour when wall-clock hour changes
- **Action**:
  1. Flush live.json to new trend_chunk_NNNN.json
  2. Increment chunk counter
  3. Delete oldest chunk if more than `bufferHours` chunks exist
  4. Update meta.json with lastRotation timestamp

**Example (3-hour buffer)**:
```
t=0h   : live.json has 0-60 min data → rotate → trend_chunk_0000.json
t=1h   : live.json has 60-120 min data → rotate → trend_chunk_0001.json (keep 0000)
t=2h   : live.json has 120-180 min data → rotate → trend_chunk_0002.json (keep 0000, 0001)
t=3h   : live.json has 180-240 min data → rotate → trend_chunk_0003.json (DELETE 0000, keep 0001, 0002, 0003)
```

#### **Graceful Pruning on Startup**
```javascript
// Pseudo-code: When loading on startup
const files = fs.readdirSync(chunkDir)
  .filter(f => f.match(/^trend_chunk_\d+\.json$/))
  .sort(); // natural sort

const maxChunks = Math.ceil(bufferHours) + 1; // +1 buffer
while (files.length > maxChunks) {
  fs.unlinkSync(path.join(chunkDir, files.shift()));
  // Remove oldest chunk if over limit
}
```

#### **Why This Avoids the Problem**:
- Hourly chunks ~120KB each vs. one 30MB file
- JSON.stringify() on 120KB file = <1ms operation (negligible)
- 12 small writes/hour spread throughout the hour
- Old chunks deleted immediately, no async queue of deletes
- Rotating live.json prevents unbounded growth

---

## 2. Startup Sequence

### 2.1 Timeline: Boot → Ready → Load History

```
t=0ms      Node-RED starts
           │
t=500ms    node-red-contrib-control loads, history-buffer nodes register
           │
t=1000ms   Node-RED core loaded, flows start instantiating
           │
t=1500ms   HistoryBufferNode constructor runs
           ├─ Read meta.json (sync, fast)
           ├─ List trend_chunk_*.json files (sync)
           ├─ Set status: "initializing..."
           ├─ Schedule delayed load (startLoadTimer at t=+5000ms)
           └─ Return from constructor immediately (non-blocking)
           │
t=2000ms   ...other nodes init...
           │
t=3000ms   FlowFuse dashboard nodes connect
           │
t=5000ms   ◄──── LOAD TIMER FIRES
           ├─ Acquire .lock file (prevents other nodes reading)
           ├─ Load trend_chunk_0000.json (120KB, ~50ms)
           ├─ Send all points with action: "replace" to output
           ├─ Set status: "loading chunk 1 of 3..."
           │
t=5250ms   ├─ Sleep 200ms (prevent memory spike)
           ├─ Load trend_chunk_0001.json (120KB, ~50ms)
           ├─ Send all points with action: "append"
           ├─ Set status: "loading chunk 2 of 3..."
           │
t=5500ms   ├─ Sleep 200ms
           ├─ Load trend_chunk_0002.json (120KB, ~50ms)
           ├─ Send all points with action: "append"
           ├─ Set status: "loaded 3600 points, ready"
           │
t=5800ms   ├─ Load live.json if exists (1-5KB, <1ms)
           ├─ Send unfinished live points with action: "append"
           ├─ Release .lock file
           └─ Begin accepting live input messages

t=6000ms   Node-RED fully ready; dashboard sparklines populated
```

### 2.2 Detailed Load Sequence (Code Pattern)

#### **Constructor (Synchronous, Fast)**
```javascript
function HistoryBufferNode(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  // Quick sync checks
  const chunkDir = getChunkDirectory(node.id);
  const exists = fs.existsSync(chunkDir);
  
  utils.setStatusOK(node, "initializing (load in 5s)");
  
  // Schedule delayed load - don't block constructor
  node.loadTimerId = setTimeout(() => {
    initializeFromFiles();
  }, 5000);
  
  // Don't return until constructor completes
  // (fs operations happen asynchronously in the scheduled callback)
}
```

#### **Delayed Load Function (Async, Sequential)**
```javascript
async function initializeFromFiles() {
  try {
    // Acquire lock
    const lockPath = path.join(chunkDir, '.lock');
    await acquireLock(lockPath);

    // Read metadata
    const metaPath = path.join(chunkDir, 'meta.json');
    const meta = await readMetadata(metaPath);
    
    // Validate config compatibility
    if (meta.bufferHours !== node.bufferHours) {
      node.warn(`Buffer hours changed from ${meta.bufferHours} to ${node.bufferHours}`);
    }

    // List and sort chunks
    const files = await listChunks(chunkDir);
    
    // Load each chunk sequentially with delays
    for (let i = 0; i < files.length; i++) {
      utils.setStatusChanged(node, 
        `loading chunk ${i+1} of ${files.length}...`);
      
      const chunk = await loadChunkSequentially(files[i], i);
      // Send messages immediately (don't accumulate in buffer)
      chunk.forEach((item, idx) => {
        node.send({
          topic: item.topic,
          payload: item.payload,
          ts: item.ts,
          action: idx === 0 && i === 0 ? "replace" : "append"
        });
      });

      // Sleep between chunks (200ms) to avoid memory spike
      if (i < files.length - 1) {
        await sleep(200);
      }
    }

    // Load live buffer if exists
    const liveData = await readLiveBuffer(chunkDir);
    liveData.forEach(item => {
      node.send({
        topic: item.topic,
        payload: item.payload,
        ts: item.ts,
        action: "append"
      });
    });

    utils.setStatusOK(node, 
      `loaded ${files.length * 1200} points, ready`);
    
    // Start live processing
    startLiveDataAccumulation();
    
  } catch (err) {
    utils.setStatusError(node, `load error: ${err.message}`);
    // Proceed without history; live data still works
    startLiveDataAccumulation();
  } finally {
    // Release lock
    releaseLock(lockPath);
  }
}
```

### 2.3 Message Format During Startup Load

Each point sent during startup has a standardized format:

```javascript
{
  topic: "zone1_temp",      // Series identifier
  payload: 21.5,            // Data value
  ts: 1738502400000,        // Millisecond timestamp
  action: "replace|append"  // Chart action
}
```

**Action semantics** (for ui-chart integration):
- **"replace"**: First point of first chunk → clears existing chart data
- **"append"**: All subsequent points → adds to chart incrementally

**Why this protocol**:
- FlowFuse ui-chart node expects action field
- "replace" ensures clean chart state after restart
- "append" allows incremental rendering (prevents UI freeze)
- Series name (topic) allows multi-series charts

### 2.4 Live Data Path Begins

After historical load completes:
1. Node status shows "ready"
2. Live input messages start flowing in
3. Each message buffered in small `liveBuffer` array
4. No disk I/O yet—just memory accumulation
5. Commit timer starts 5-second intervals

---

## 3. Live Data Path

### 3.1 Message Ingestion

```javascript
node.on("input", function(msg, send, done) {
  // Guard: validate message structure
  if (!msg.hasOwnProperty("topic") || !msg.hasOwnProperty("payload")) {
    utils.setStatusError(node, "missing topic or payload");
    return;
  }

  // Add timestamp if missing
  if (!msg.hasOwnProperty("ts")) {
    msg.ts = Date.now();
  }

  // Validate payload type (number, boolean, string)
  if (!isValidPayload(msg.payload)) {
    utils.setStatusError(node, "invalid payload type");
    return;
  }

  // Accumulate in memory (non-blocking)
  liveBuffer.push({
    topic: msg.topic,
    payload: msg.payload,
    ts: msg.ts
  });

  // Forward immediately to downstream (ui-chart)
  send({
    topic: msg.topic,
    payload: msg.payload,
    ts: msg.ts,
    action: "append"
  });

  // Update status every 5 messages (debounced)
  if (liveBuffer.length % 5 === 0) {
    const uniqueSeries = new Set(liveBuffer.map(x => x.topic)).size;
    utils.setStatusChanged(node, 
      `buffer: ${liveBuffer.length} points, ${uniqueSeries} series`);
  }

  done();
});
```

**Design choices**:
- **Send immediately**: UI updates in real-time, doesn't wait for disk commit
- **Accumulate in memory**: Fast, non-blocking; only ~100 bytes per point
- **No blocking I/O in hot path**: All disk operations async/non-blocking
- **Validation upfront**: Prevents bad data polluting buffer

### 3.2 Async Commit Timer (Every 5 Seconds)

```javascript
function startCommitTimer() {
  node.commitTimerId = setInterval(() => {
    // Check if anything to flush
    if (liveBuffer.length === 0) {
      return; // Nothing to write
    }

    // Make a copy and clear buffer atomically
    const toWrite = liveBuffer.slice(); // Shallow copy
    liveBuffer = [];                     // Clear for next batch

    // Non-blocking async write
    const liveJsonPath = path.join(chunkDir, 'live.json');
    
    fs.writeFile(
      liveJsonPath,
      JSON.stringify(toWrite, null, 2),
      { encoding: 'utf8', flag: 'w' },  // 'w' = overwrite
      (err) => {
        if (err) {
          node.warn(`commit error: ${err.message}`);
          // Re-add to buffer? Decided: NO (accept small data loss)
          // Reason: buffering failed writes = memory leak + complexity
        } else {
          // Write succeeded
          lastCommitTime = Date.now();
        }
      }
    );

    // Schedule rotation check
    checkRotation();
  }, 5000);
}
```

**Commit characteristics**:
- **Interval**: 5 seconds (not 10 minutes like context store)
- **File size**: 1-5KB per write (vs. 30MB)
- **Duration**: <1ms disk I/O (non-blocking)
- **Frequency**: 12 writes/hour (manageable SD card wear)
- **On failure**: Data loss acceptable (no re-buffering)

**Why 5 seconds?**
- Balances data loss risk with SD card wear
- ~25 points max per commit if sampling at 5 Hz across 5 series
- Even if lost, UI shows previous 10 min of history from disk
- Node-RED isn't a database—accept eventual consistency model

### 3.3 Hourly Rotation Check

```javascript
function checkRotation() {
  const now = Date.now();
  const currentHour = Math.floor(now / 3600000);
  const lastRotationHour = Math.floor(lastRotationTime / 3600000);

  // Only rotate once per wall-clock hour
  if (currentHour !== lastRotationHour) {
    rotateChunks();
  }
}

async function rotateChunks() {
  try {
    const chunkDir = getChunkDirectory(node.id);
    
    // Rename live.json → trend_chunk_NNNN.json
    const files = fs.readdirSync(chunkDir)
      .filter(f => f.match(/^trend_chunk_\d+\.json$/))
      .sort();
    
    const nextChunkNum = files.length; // 0-indexed, so length is next number
    const liveJsonPath = path.join(chunkDir, 'live.json');
    const newChunkPath = path.join(chunkDir, 
      `trend_chunk_${String(nextChunkNum).padStart(4, '0')}.json`);

    // Atomically move live.json to new chunk
    if (fs.existsSync(liveJsonPath)) {
      fs.renameSync(liveJsonPath, newChunkPath); // Fast, same filesystem
    }

    // Delete oldest chunk if over limit
    const maxChunks = Math.ceil(node.bufferHours) + 1;
    if (files.length >= maxChunks) {
      const oldestPath = path.join(chunkDir, files[0]);
      fs.unlinkSync(oldestPath);
    }

    // Update metadata
    const metaPath = path.join(chunkDir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.lastRotation = Date.now();
    meta.chunkCount = Math.min(files.length + 1, maxChunks);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    lastRotationTime = Date.now();
    utils.setStatusChanged(node, 
      `rotated chunk, now ${meta.chunkCount} chunks`);

  } catch (err) {
    node.warn(`rotation error: ${err.message}`);
    // Non-fatal; live.json just gets overwritten next commit
  }
}
```

**Rotation characteristics**:
- **Trigger**: Once per wall-clock hour (automatic, no config)
- **Operation**: Rename + delete (synchronous, <1ms)
- **Outcome**: Old data moved to immutable chunk, live.json cleared for next hour
- **Failure mode**: If rename fails, live.json just gets overwritten (data loss, acceptable)

### 3.4 Memory Profile During Live Operation

```
Scenario: 5 temperature sensors, 30 sec sample interval

t=0s     : liveBuffer = []                      (0 KB)
t=30s    : liveBuffer = [5 points × 100B]       (0.5 KB)
t=60s    : liveBuffer = [10 points]             (1 KB)
t=120s   : liveBuffer = [20 points]             (2 KB)
t=180s   : liveBuffer = [30 points]             (3 KB)
t=300s   : liveBuffer = [50 points]             (5 KB)
          │
          ├─ COMMIT FIRES (5s interval)
          │  - Copy liveBuffer (5 KB shallow copy)
          │  - JSON.stringify (5 KB → ~7-10 KB with whitespace)
          │  - fs.writeFile (non-blocking)
          │  - Clear liveBuffer
          │
t=300s+  : liveBuffer = []                      (0 KB)  ← Garbage collected
t=300s+50ms: writeFile completes, live.json written
t=305s   : liveBuffer = [5 new points]          (0.5 KB)
```

**Peak memory**: ~10 KB during JSON.stringify (negligible)  
**Steady state**: 2-5 KB in liveBuffer  
**Compared to old approach**: Was 30MB global context loaded at startup

---

## 4. Memory & Performance Analysis

### 4.1 Memory Consumption Breakdown

#### **Startup Phase** (5-10 seconds)
```
Baseline Node-RED:        ~80 MB
+ Node loads:             ~20 MB
+ History-buffer init:    ~1 MB (lock file, meta.json)
+ First chunk loaded:     +120 KB (trend_chunk_0000.json → memory)
  (while rendering to ui-chart, gets GC'd)
= Peak:                   ~102 MB

Wait 200ms...
Baseline continues:       ~80 MB (GC cleaned up previous chunk)
+ Second chunk loaded:    +120 KB
= Peak:                   ~102 MB again

Wait 200ms...
+ Third chunk loaded:     +120 KB
= Peak:                   ~102 MB
+ live.json loaded:       +5 KB
= Peak:                   ~102 MB
- All released:           ~80 MB (after GC)

Total: No memory accumulation, clean progression
```

#### **Live Data Phase** (steady state)
```
Baseline:                 ~80 MB
+ liveBuffer:             2-5 KB (typically 20-50 points)
+ ui-chart in memory:     ~2 MB (stores last 3 hours in browser, not Node-RED)
= Steady state:           ~82 MB

Every 5 seconds:
+ JSON.stringify copy:    +7-10 KB
+ fs.writeFile queue:     ~0 KB (non-blocking, doesn't buffer)
= Peak during write:      ~82.01 MB

After write:
- Cleared immediately:    ~82 MB
```

**Comparison to original**:
- Original: 30MB file + 60-90MB V8 overhead = 90-120MB for one context.get()
- New: 3MB chunks (10 chunks for 5-hour buffer) = 30MB theoretical max; actual: ~5-10MB at a time due to sequential load + GC
- **Savings**: 80-110 MB of peak memory freed

### 4.2 Chunk Size Estimation

#### **Data Point Example**
```json
{
  "topic": "Return Temperature",  // ~20 bytes
  "payload": 21.5,                // ~4 bytes
  "ts": 1738502400000             // ~13 bytes (number)
}
// → ~40-50 bytes raw

// In JSON (with quotes, delimiters, whitespace):
{
  "topic": "Return Temperature",
  "payload": 21.5,
  "ts": 1738502400000
}
// → ~100 bytes on disk (with formatting)
```

#### **Hourly Chunk Size (Worst Case)**
```
5 sensor series
× 30 points/minute (2-second sample interval per sensor)
× 60 minutes
= 9,000 points per hour

9,000 points × 100 bytes/point = 900 KB per chunk

Realistic (5-minute sample interval):
5 series × 12 points/hour = 60 points
60 × 100 bytes = 6 KB per hour (!)

Most likely (30-second interval, 5 series):
5 × 120 points/hour = 600 points
600 × 100 bytes = 60 KB per chunk

Conservative (10-second interval):
5 × 360 points/hour = 1,800 points
1,800 × 100 bytes = 180 KB per chunk
```

**Assumed for design**: ~120 KB per chunk (middle ground)

#### **Total History Window Sizes** (3-hour buffer)
```
Conservative (60 KB/chunk):   60 × 3 = 180 KB on disk
Middle (120 KB/chunk):        120 × 3 = 360 KB on disk
Worst case (180 KB/chunk):    180 × 3 = 540 KB on disk

All easily under 1 MB total
```

### 4.3 CPU Impact

#### **Startup Load CPU Profile**
```
t=0-5s    : Idle (~5% CPU for other Node-RED tasks)
t=5-5.05s : Read + parse trend_chunk_0000.json
            - fs.readFile: <5ms (disk I/O)
            - JSON.parse: <5ms (for 120KB file)
            - Send messages loop: ~5-10ms (serializing to output)
            Total: ~20ms actual CPU; <1% impact
            (Spread over 50ms wall time due to I/O latency)

t=5.25-5.3s : Repeat for chunk 1 (~20ms CPU, <1%)
t=5.5-5.55s : Repeat for chunk 2 (~20ms CPU, <1%)
t=5.7-5.75s : Load live.json (~2ms CPU, <1%)

Total startup CPU: ~60ms across 700ms duration (~8% during load window)
Compared to original: 30MB JSON.parse = 500-1000ms block on main thread!
```

#### **Live Data Commit CPU Profile**
```
Every 5 seconds:
- Copy liveBuffer: <1ms (shallow copy of 50-point array)
- JSON.stringify: 5-10ms for 5KB array
- fs.writeFile call: <1ms (queue, don't wait)
Total: ~6-11ms every 5 seconds = ~0.1-0.2% sustained CPU

Compared to original: 10-minute commits of 30MB = 500-1000ms block every 600 seconds
New: Spread 60-120ms every 300 seconds = ~0.02-0.04% sustained CPU
Savings: 10-20x less CPU impact
```

### 4.4 SD Card Wear Estimate

#### **Write Frequency**
```
New approach (file-based chunking):
- 5-second commits: 12 per minute × 60 = 720 per hour
- live.json size: ~2-5 KB each
- Total: ~10-35 MB/hour written

Old approach (context store):
- 10-minute commits: 6 per hour
- File size: ~30 MB each
- Total: ~180 MB/hour written

BUT: Old approach's single 30MB write causes:
  - Multiple internal flash page writes (wear leveling)
  - File system overhead (FAT32 or ext4 rewriting metadata)
  - Actual SD card writes: 30MB → 60-80MB due to file system overhead

New approach:
- Many small 5KB writes spread throughout hour
- Modern filesystems (ext4) optimize small writes in log-structured format
- Actual SD card writes: ~1.5x data (15-25 MB/hour)

Comparison:
Old: 180 MB data → 450-600 MB SD card wear per hour
New: 50-175 MB data → 75-263 MB SD card wear per hour
Improvement: 60-80% less wear

Over 3 years:
Old: 450 MB/h × 24 h × 365 d × 3 y = 11.8 TB writes → SD card failure
New: 150 MB/h × 24 h × 365 d × 3 y = 3.9 TB writes → likely survives
```

**Practical implication**: Raspberry Pi microSD cards rated for ~1-10 TB write cycles. Old approach hits this in 1-2 years; new approach extends to 3-5 years.

---

## 5. Edge Cases & Error Handling

### 5.1 Node-RED Restart During Live Data Accumulation

**Scenario**: Data in liveBuffer hasn't been committed yet; power loss or restart.

```
t=100s : liveBuffer = [20 points accumulated]
t=105s : Should commit, but restart happens at t=104s

On restart (t=110s):
├─ Load trend_chunk_0000, 0001, 0002 (historical chunks OK)
├─ Load live.json (if it exists from previous restart)
├─ liveBuffer = [] (fresh, those 20 points lost)
└─ Resume live data accumulation
```

**Decision**: Accept small data loss (last ~5 seconds)

**Justification**:
- Node-RED is not a queue; it doesn't guarantee durability
- 5 seconds is acceptable in a trend sparkline (3 hours total)
- Adding queue would require database or complex file locking
- User expectation: "restart loses live data" is standard in Node-RED

**Alternative not taken**: Persist every message to file immediately
- Would cause SD card wear explosion (700+ writes/minute)
- Would block hot path significantly
- Not justified for 5-second window

### 5.2 Graceful Shutdown (Node-RED Stop)

```javascript
node.on("close", function(done) {
  // Clear timers
  clearInterval(node.commitTimerId);
  clearInterval(node.rotationCheckerId);
  clearTimeout(node.loadTimerId);

  // Option 1: Write remaining live data (RECOMMENDED)
  if (liveBuffer.length > 0) {
    const liveJsonPath = path.join(chunkDir, 'live.json');
    try {
      // Synchronous write (OK since we're shutting down)
      fs.writeFileSync(
        liveJsonPath,
        JSON.stringify(liveBuffer, null, 2),
        { encoding: 'utf8', flag: 'w' }
      );
      node.log(`Saved ${liveBuffer.length} points on shutdown`);
    } catch (err) {
      node.warn(`Failed to save on shutdown: ${err.message}`);
    }
  }

  // Release lock if held
  try {
    releaseLock(lockPath);
  } catch (err) {
    // Ignore
  }

  done();
});
```

**Design**:
- Write liveBuffer synchronously (small file, <10ms)
- No timeout (shutdown waits for it)
- Prevents data loss on graceful stop
- Does NOT interfere with rapid redeploy (lock prevents simultaneous reads)

### 5.3 Corrupted or Missing Hourly Files

**Scenario**: trend_chunk_0001.json is corrupted (invalid JSON) or accidentally deleted.

```javascript
async function loadChunkSequentially(filePath, chunkIndex) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!Array.isArray(parsed)) {
      throw new Error("Expected array");
    }
    
    return parsed;
  } catch (err) {
    node.warn(`Failed to load chunk ${chunkIndex}: ${err.message}`);
    // Return empty array instead of crashing
    return [];
    // (Missing chunk is gap in history, but doesn't crash)
  }
}
```

**Behavior**:
- Corrupted file → log warning, skip that chunk (gap in chart)
- Missing file → treated as empty (gap in chart)
- Other chunks load normally
- Node continues operating
- User sees incomplete history, but no crash

**Why acceptable**:
- History is "nice to have," not critical
- Graceful degradation (chart shows what's available)
- Corrupted files are rare (corrupt bits cause JSON parse errors, not silent data loss)
- Node is resilient; doesn't poison entire system

### 5.4 First Deployment (No History Files Exist)

```javascript
async function initializeFromFiles() {
  try {
    const chunkDir = getChunkDirectory(node.id);
    
    // Create directory if missing
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    // Check for chunks
    const files = fs.readdirSync(chunkDir)
      .filter(f => f.match(/^trend_chunk_\d+\.json$/))
      .sort();

    if (files.length === 0) {
      // No chunks yet; create fresh meta.json and proceed
      const meta = {
        nodeId: node.id,
        bufferHours: node.bufferHours,
        created: Date.now(),
        lastRotation: Date.now(),
        chunkCount: 0,
        hasLiveBuffer: false
      };
      fs.writeFileSync(
        path.join(chunkDir, 'meta.json'),
        JSON.stringify(meta, null, 2)
      );
      
      utils.setStatusOK(node, "no history yet (new deployment)");
      startLiveDataAccumulation();
      return;
    }

    // Otherwise, load normally
    // ...
  } catch (err) {
    // If directory creation fails, non-fatal; continue anyway
    utils.setStatusWarn(node, `file system error: ${err.message}`);
    startLiveDataAccumulation();
  }
}
```

**Behavior**:
- New node starts with empty history
- No errors or warnings
- Immediately begins accepting live data
- On first hourly rotation, creates first chunk

### 5.5 Multiple Rapid Redeployments

**Scenario**: User deploy → wait 2 seconds → redeploy (before load timer fires).

```javascript
node.on("close", function(done) {
  // Clear load timer if it hasn't fired yet
  if (node.loadTimerId) {
    clearTimeout(node.loadTimerId);
  }

  // Release lock if held
  try {
    releaseLock(lockPath);
  } catch (err) {
    // Non-fatal
  }

  done();
});
```

**Behavior**:
- First redeploy: Load timer cleared, no async I/O starts
- Second constructor: New node gets new timerId
- Lock prevents simultaneous reads from old + new node
- No race conditions; first node to acquire lock loads, others wait or skip

**Design prevents**:
- Two nodes loading same files simultaneously
- Memory leak from abandoned timers
- File corruption from concurrent writes

---

## 6. Code Structure & Organization

### 6.1 Module Organization

```
nodes/
├── history-buffer.js          ← Main node implementation
├── history-buffer.html        ← UI definition
├── history-buffer-utils.js    ← NEW: File I/O helpers
└── utils.js                   ← Existing shared utils
```

#### **history-buffer.js** (Main node, ~250-300 lines)
Responsibilities:
- Node constructor and registration
- Message input handler
- Timer management (commit, rotation)
- Status display
- Delegation to helper functions

#### **history-buffer-utils.js** (NEW, ~400-500 lines)
Responsibilities:
- File system abstractions (getChunkDirectory, listChunks, etc.)
- Lock management (acquireLock, releaseLock)
- Chunk load/save operations
- Metadata read/write
- Rotation and pruning logic
- Validation helpers

**Separation rationale**:
- Main file stays focused on Node-RED lifecycle
- Utils file can be unit-tested independently
- Clear separation of concerns (messaging vs. I/O)

### 6.2 Async/Await vs. Callbacks

#### **Constructor (Synchronous)**
```javascript
function HistoryBufferNode(config) {
  RED.nodes.createNode(this, config);
  // ... quick sync setup ...
  
  // Schedule async work, don't wait
  node.loadTimerId = setTimeout(() => {
    initializeFromFiles(); // Async function
  }, 5000);
}
```

**Why**: Don't block Node-RED boot; handlers can be promises internally

#### **Delayed Load (Async/Await)**
```javascript
async function initializeFromFiles() {
  try {
    await acquireLock(lockPath);
    const files = await listChunks(chunkDir);
    
    for (const file of files) {
      const chunk = await loadChunkSequentially(file);
      // Process and send messages
      
      await sleep(200); // Pause between chunks
    }
    
  } catch (err) {
    // Handle gracefully
  } finally {
    releaseLock(lockPath);
  }
}
```

**Why**: Readable, prevents callback hell, error handling with try/catch

#### **Live Commit (Async, Non-Blocking)**
```javascript
function startCommitTimer() {
  node.commitTimerId = setInterval(() => {
    if (liveBuffer.length === 0) return;

    const toWrite = liveBuffer.slice();
    liveBuffer = [];

    // Fire-and-forget async write
    fs.writeFile(
      liveJsonPath,
      JSON.stringify(toWrite, null, 2),
      'utf8',
      (err) => {
        if (err) node.warn(`write error: ${err.message}`);
      }
    );

    checkRotation(); // Sync operation
  }, 5000);
}
```

**Why**: Non-blocking async, callback handles error asynchronously, doesn't wait

### 6.3 File I/O Patterns

#### **Pattern: Safe Async Read**
```javascript
async function readChunk(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!Array.isArray(parsed)) {
      throw new Error("Expected array");
    }
    
    return parsed;
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}
```

#### **Pattern: Safe Sync Write (Graceful Shutdown)**
```javascript
function writeChunkSync(filePath, data) {
  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, json, 'utf8');
    return true;
  } catch (err) {
    node.warn(`Write failed: ${err.message}`);
    return false;
  }
}
```

#### **Pattern: Non-Blocking Async Write (Live Commit)**
```javascript
function writeChunkAsync(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  
  fs.writeFile(filePath, json, 'utf8', (err) => {
    if (err) {
      node.warn(`Async write failed: ${err.message}`);
      // Do NOT re-buffer (would accumulate over time)
    }
  });
}
```

#### **Pattern: Lock File (Prevents Race Conditions)**
```javascript
async function acquireLock(lockPath, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Try to create lock file exclusively
      const fd = fs.openSync(lockPath, 'wx'); // 'wx' = write exclusive
      fs.closeSync(fd);
      return; // Success
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Another node holds lock; wait
        await sleep(100);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to acquire lock after ${maxRetries} retries`);
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    // Ignore if lock already gone
  }
}
```

### 6.4 Error Handling Strategy

#### **Principle: Fail Gracefully, Never Crash**

Three severity levels:

1. **Fatal Errors** (should be impossible)
   - Node-RED installation corrupted
   - Recovery: Stop node, display error status

2. **Non-Fatal Errors** (expect to happen occasionally)
   - Corrupted chunk file
   - SD card temporarily busy during write
   - Recovery: Log warning, skip operation, continue

3. **Expected Edge Cases** (normal operation)
   - First deployment (no chunks yet)
   - Rapid redeploy (clear timer)
   - Recovery: Handle silently or info-level status

```javascript
// Example: Robust chunk loading
async function loadChunk(filePath, chunkIndex) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!Array.isArray(parsed)) {
      throw new Error("Expected array");
    }
    
    return parsed; // Success
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File missing (OK on first load)
      node.debug(`Chunk ${chunkIndex} not found (expected on first load)`);
    } else if (err instanceof SyntaxError) {
      // JSON corrupted (warn, skip)
      node.warn(`Chunk ${chunkIndex} corrupted (${err.message}), skipping`);
    } else {
      // Other error (unexpected)
      node.error(`Chunk ${chunkIndex} load failed: ${err.message}`);
    }
    
    return []; // Return empty array; caller continues
  }
}
```

---

## 7. Migration Path

### 7.1 Handling Existing Context-Based Data

**Current state**: Users may have 3+ hours of history in Node-RED global context under key `history_buffer_[node-id]`.

#### **Option A: Auto-Migrate (Recommended)**
```javascript
async function migrateFromContext() {
  try {
    // Try to read old context data
    const oldKey = `history_buffer_${node.id}`;
    const context = node.context();
    
    return new Promise((resolve, reject) => {
      context.get(oldKey, 'persistent', (err, stored) => {
        if (err || !stored) {
          resolve([]); // No old data
        } else if (Array.isArray(stored)) {
          // Have old data; validate and convert
          const validated = stored.filter(item => 
            item.topic && item.payload && item.ts
          );
          
          // Migrate to new file system
          rotateToChunks(validated)
            .then(() => {
              node.log(`Migrated ${validated.length} points from context`);
              // Delete old context key
              context.set(oldKey, null, 'persistent', () => {});
              resolve(validated);
            })
            .catch(reject);
        }
      });
    });
  } catch (err) {
    node.warn(`Context migration failed: ${err.message}`);
    return []; // Proceed without old data
  }
}
```

#### **Option B: Manual Migration Tool (User-Initiated)**
Create a helper node "history-migrate-from-context":
- User wires it to history-buffer node
- Sends it a "start" message
- Reads all old context, writes to new file chunks
- Reports completion

**Recommended**: Option A (transparent, automatic)

### 7.2 Deprecation Timeline

```
Version 0.1.36 (this release):
- Introduce history-buffer-v2 (new file-based node)
- Keep history-buffer (old context-based) for backward compat
- Auto-migrate on first run (transparent)
- Status message: "Migrated from context storage"

Version 0.1.40 (3-4 releases later, ~3 months):
- Deprecation warning in status: "Old context storage will be removed in v0.1.50"
- Recommend users switch to history-buffer-v2

Version 0.1.50 (target):
- Remove history-buffer (old node)
- history-buffer-v2 becomes main history-buffer
```

### 7.3 Transition Strategy for Users

1. **No action required initially**
   - New history-buffer is drop-in replacement
   - Old flows continue working
   - Auto-migration happens silently

2. **Eventually, redeploy**
   - On redeploy, new file-based node instantiates
   - Context data auto-migrated to chunks
   - Old context key deleted
   - No UI changes needed

3. **For new flows**
   - Use new history-buffer directly
   - No concerns about context limitations

---

## 8. Implementation Checklist

### Phase 1: Core File I/O Infrastructure
- [ ] Create `nodes/history-buffer-utils.js` with:
  - [ ] `getChunkDirectory(nodeId)` → resolve path
  - [ ] `listChunks(chunkDir)` → async array of chunk filenames
  - [ ] `readChunk(filePath)` → async parse JSON, validate array
  - [ ] `writeChunkSync(filePath, data)` → sync write for shutdown
  - [ ] `writeChunkAsync(filePath, data)` → non-blocking write
  - [ ] `acquireLock(lockPath)` → exclusive lock with retries
  - [ ] `releaseLock(lockPath)` → remove lock file
  - [ ] `readMetadata(metaPath)` → async read & validate meta.json
  - [ ] `writeMetadata(metaPath, meta)` → sync write meta.json

### Phase 2: Startup & Load Logic
- [ ] Implement `initializeFromFiles()` async function in history-buffer.js
  - [ ] Delayed start (setTimeout 5 seconds)
  - [ ] Acquire lock
  - [ ] List chunks
  - [ ] Sequential load loop with 200ms pauses
  - [ ] Send messages with "replace" / "append" actions
  - [ ] Load live.json
  - [ ] Release lock
  - [ ] Start live data accumulation

### Phase 3: Live Data Path
- [ ] Implement input message handler
  - [ ] Validate topic, payload
  - [ ] Add timestamp if missing
  - [ ] Append to liveBuffer
  - [ ] Send immediately to output
  - [ ] Update status (debounced)
  
- [ ] Implement `startCommitTimer()` function
  - [ ] 5-second intervals
  - [ ] Non-blocking fs.writeFile
  - [ ] Call `checkRotation()`

### Phase 4: Rotation & Pruning
- [ ] Implement `checkRotation()` function
  - [ ] Wall-clock hour detection
  - [ ] Atomic rename live.json → trend_chunk_NNNN.json
  
- [ ] Implement `rotateChunks()` async function
  - [ ] Rename & prune old chunks
  - [ ] Update metadata
  - [ ] Clear liveBuffer

### Phase 5: Shutdown & Cleanup
- [ ] Implement `node.on("close")` handler
  - [ ] Clear all timers
  - [ ] Write liveBuffer to file (sync)
  - [ ] Release lock
  - [ ] Graceful exit

### Phase 6: Error Handling & Edge Cases
- [ ] Implement error recovery:
  - [ ] Corrupted chunk files → skip with warning
  - [ ] Missing chunks → empty array
  - [ ] Lock timeout → skip load, continue
  - [ ] First deployment → create directory, proceed
  
- [ ] Implement migration from context (optional but recommended)
  - [ ] Detect old context data
  - [ ] Auto-convert to chunks
  - [ ] Delete old context key

### Phase 7: Testing & Validation
- [ ] Unit tests for utils functions
- [ ] Integration test on Pi:
  - [ ] Deploy with no history → starts with empty chunks
  - [ ] Send 100 test points → written to live.json
  - [ ] Wait 5 seconds → live.json persists
  - [ ] Restart Node-RED → history loads correctly
  - [ ] Simulate corruption → skip gracefully

### Phase 8: Documentation
- [ ] Update history-buffer.html help text
- [ ] Add migration notes to README
- [ ] Document file structure in comments

---

## 9. Code Skeleton & Pseudo-Code

### 9.1 Main Node Structure (history-buffer.js)

```javascript
module.exports = function(RED) {
  const utils = require('./utils')(RED);
  const hbUtils = require('./history-buffer-utils');

  function HistoryBufferNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Configuration
    const bufferHours = parseInt(config.bufferHours) || 3;
    const chunkDir = hbUtils.getChunkDirectory(node.id);

    // State
    let liveBuffer = [];
    let lastRotationTime = Date.now();
    let messageCount = 0;
    let timers = {
      load: null,
      commit: null,
      rotation: null
    };

    // Validation
    if (bufferHours < 0.5 || bufferHours > 24) {
      utils.setStatusError(node, "invalid bufferHours");
      return;
    }

    utils.setStatusOK(node, "initializing (load in 5s)");

    // Schedule delayed load
    timers.load = setTimeout(async () => {
      try {
        await initializeFromFiles();
      } catch (err) {
        utils.setStatusError(node, `init error: ${err.message}`);
        // Continue anyway; start accepting live data
        startLiveDataAccumulation();
      }
    }, 5000);

    // Input message handler
    node.on("input", function(msg, send, done) {
      // ... (see 3.1)
    });

    // Shutdown handler
    node.on("close", function(done) {
      // ... (see 5.2)
    });

    // Helper functions (will be in main file or imported from utils)
    async function initializeFromFiles() {
      // ... (see 2.2)
    }

    function startLiveDataAccumulation() {
      timers.commit = setInterval(() => {
        // ... (see 3.2)
      }, 5000);

      timers.rotation = setInterval(() => {
        checkRotation();
      }, 60000);
    }

    function checkRotation() {
      // ... (see 3.3)
    }
  }

  RED.nodes.registerType("history-buffer", HistoryBufferNode);
};
```

### 9.2 Utils Module Structure (history-buffer-utils.js)

```javascript
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

module.exports = {
  getChunkDirectory,
  listChunks,
  readChunk,
  writeChunkSync,
  writeChunkAsync,
  readMetadata,
  writeMetadata,
  acquireLock,
  releaseLock,
};

async function getChunkDirectory(nodeId) {
  const nodeRedHome = process.env.NODE_RED_HOME || 
    path.join(require('os').homedir(), '.node-red');
  const dir = path.join(nodeRedHome, '.bldgblocks', 'trends', nodeId);
  
  // Ensure directory exists
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // Ignore if already exists
  }
  
  return dir;
}

async function listChunks(chunkDir) {
  try {
    const files = await fs.readdir(chunkDir);
    return files
      .filter(f => f.match(/^trend_chunk_\d+\.json$/))
      .sort(); // Natural sort
  } catch (err) {
    return [];
  }
}

async function readChunk(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(data);
  
  if (!Array.isArray(parsed)) {
    throw new Error("Expected array in chunk file");
  }
  
  return parsed;
}

function writeChunkSync(filePath, data) {
  try {
    const json = JSON.stringify(data, null, 2);
    fsSync.writeFileSync(filePath, json, 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

function writeChunkAsync(filePath, data, callback) {
  const json = JSON.stringify(data, null, 2);
  fsSync.writeFile(filePath, json, 'utf8', callback);
}

// ... (other functions following similar pattern)
```

### 9.3 Key Algorithm: Sequential Chunk Load

```javascript
async function loadChunksSequentially(chunkPaths, onEachChunk) {
  const results = [];

  for (let i = 0; i < chunkPaths.length; i++) {
    try {
      // Load chunk
      const data = await readChunk(chunkPaths[i]);
      results.push(data);

      // Call handler (e.g., send messages)
      if (typeof onEachChunk === 'function') {
        onEachChunk(data, i, chunkPaths.length);
      }

      // Pause between chunks (prevent memory spike)
      if (i < chunkPaths.length - 1) {
        await sleep(200);
      }
    } catch (err) {
      // Log and continue
      console.warn(`Failed to load chunk ${i}: ${err.message}`);
      results.push([]);
    }
  }

  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 9.4 Key Algorithm: Rotation

```javascript
async function performRotation(chunkDir, bufferHours) {
  try {
    // List current chunks
    const files = await listChunks(chunkDir);
    const maxChunks = Math.ceil(bufferHours) + 1;

    // Rename live.json to new chunk if it exists
    const liveJsonPath = path.join(chunkDir, 'live.json');
    const liveExists = fsSync.existsSync(liveJsonPath);

    if (liveExists) {
      const nextChunkNum = files.length;
      const newChunkPath = path.join(chunkDir,
        `trend_chunk_${String(nextChunkNum).padStart(4, '0')}.json`);
      
      fsSync.renameSync(liveJsonPath, newChunkPath); // Atomic
    }

    // Prune oldest chunks
    const updatedFiles = await listChunks(chunkDir);
    while (updatedFiles.length > maxChunks) {
      const oldest = updatedFiles.shift();
      fsSync.unlinkSync(path.join(chunkDir, oldest));
    }

    // Update metadata
    const metaPath = path.join(chunkDir, 'meta.json');
    const meta = await readMetadata(metaPath);
    meta.lastRotation = Date.now();
    meta.chunkCount = updatedFiles.length;
    await writeMetadata(metaPath, meta);

    return { success: true, chunkCount: updatedFiles.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

---

## 10. Testing Approach

### 10.1 Unit Tests (No Pi Required)

**Test file**: `tests/history-buffer-utils.test.js`

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const hbUtils = require('../nodes/history-buffer-utils');

describe('history-buffer-utils', () => {
  describe('readChunk', () => {
    it('should parse valid JSON array', async () => {
      // Create temp file with test data
      const testData = [
        { topic: 'temp', payload: 20.5, ts: 123456 }
      ];
      const filePath = '/tmp/test-chunk.json';
      fs.writeFileSync(filePath, JSON.stringify(testData));

      // Test
      const result = await hbUtils.readChunk(filePath);
      assert.deepEqual(result, testData);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    it('should throw on invalid JSON', async () => {
      const filePath = '/tmp/invalid.json';
      fs.writeFileSync(filePath, '{invalid json}');

      try {
        await hbUtils.readChunk(filePath);
        assert.fail('Should have thrown');
      } catch (err) {
        assert(err instanceof SyntaxError);
      }

      fs.unlinkSync(filePath);
    });

    it('should throw on non-array content', async () => {
      const filePath = '/tmp/object.json';
      fs.writeFileSync(filePath, JSON.stringify({ data: [] }));

      try {
        await hbUtils.readChunk(filePath);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.match(err.message, /Expected array/);
      }

      fs.unlinkSync(filePath);
    });
  });

  // ... more tests for rotation, lock, etc.
});
```

### 10.2 Integration Tests (Pi Simulation)

**Test file**: `tests/history-buffer.integration.test.js`

```javascript
// Simulates full lifecycle on Pi
// Requires actual fs operations

describe('history-buffer integration', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join('/tmp', 'hb-test-'));
    process.env.NODE_RED_HOME = tempDir;
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true });
  });

  it('should load empty history on first run', (done) => {
    const node = createMockNode('test-node-1');
    // ... assert loads without error
    done();
  });

  it('should persist live data and recover on restart', (done) => {
    // 1. Create node, send 50 test messages
    // 2. Check live.json exists
    // 3. Destroy node (simulated restart)
    // 4. Create new node with same ID
    // 5. Assert loaded 50 points
    done();
  });

  it('should rotate chunks every hour', (done) => {
    // This test requires simulating time passage
    // Use jest.useFakeTimers() or similar
    // Verify chunks rotate correctly
    done();
  });

  it('should survive corrupted chunk file', (done) => {
    // Create valid chunks 0, 1
    // Corrupt chunk 1 (invalid JSON)
    // Load and assert skips chunk 1 without crashing
    done();
  });
});
```

### 10.3 Real Pi Testing (Acceptance)

**Test procedure** (can run in 5-10 minutes):

```
1. Clean Pi: Remove .node-red/.bldgblocks/trends/ directory
2. Deploy new history-buffer node
3. Wire test flow:
   - Inject 100 points with random data
   - Topic = "test_temp"
   - Payload = random number 0-30
   - Interval = 100ms (all sent within ~10 seconds)
4. Observe:
   - live.json created in .bldgblocks/trends/[node-id]/
   - File size ~10KB
   - Status shows "buffer: N points"
5. Restart Node-RED (Ctrl+C, start again)
6. Observe:
   - Startup takes ~6-8 seconds (5s delay + 1-2s load)
   - History loads and displays
   - 100 points visible in chart
7. Send 50 more points
8. Verify:
   - New points append
   - live.json updated
9. Simulate file corruption:
   - Edit trend_chunk_0000.json to invalid JSON
   - Restart Node-RED
   - Observe: skips chunk, loads others, continues working
```

**Expected results**:
- No crashes
- CPU spike < 2% during load
- Memory stays < 90 MB
- SD card write < 5KB every 5 seconds

---

## 11. Performance Comparison: Old vs. New

| Metric | Old (Context) | New (File Chunks) | Improvement |
|--------|---------------|-------------------|-------------|
| **Memory Startup Peak** | 90-120 MB | 82 MB | -30% |
| **Memory Steady State** | 80 MB | 80 MB | Same |
| **Startup Latency** | 2-3 sec blocking | 5-8 sec non-blocking | +2-5 sec (acceptable) |
| **Event Loop Blocking** | 500-1000 ms (JSON.parse) | <20 ms (sequential load) | 25-50x better |
| **SD Wear (per hour)** | 180 MB data → 450-600 MB writes | 50-175 MB data → 75-263 MB writes | 60-80% less |
| **CPU Sustained** | 0.04% (idle) + spikes | 0.02% (idle) + minimal | 2x better |
| **File System Calls** | 6 per 10 min (big) | 12 per hour (small) | More calls, less data |
| **Crash Risk (Pi 4)** | HIGH (context lock timeout) | LOW (graceful degradation) | Eliminates crashes |

---

## 12. Future Enhancements (Not in v1)

1. **Compression**: gzip chunks after rotation → reduce SD wear 3x
2. **Streaming Load**: Load chunks line-by-line instead of all-at-once → reduce peak memory further
3. **Multi-Series Isolation**: Separate files per topic → parallel load, faster startup
4. **Cloud Sync**: Optional upload to cloud storage (e.g., AWS S3) for long-term archival
5. **Configurable Chunk Duration**: Instead of hourly, allow 15-min or 30-min chunks
6. **Statistics**: Embed min/max/mean per chunk for faster sparkline rendering

---

## Conclusion

This redesign **eliminates the root cause** of Pi crashes: Node-RED's global context store's inability to handle 30MB JSON files. By chunking data into 120-140KB hourly files and using non-blocking fs operations, we achieve:

✅ **Stability**: No event-loop blocking, graceful error handling  
✅ **Memory Efficiency**: 30-40% reduction in peak memory  
✅ **SD Card Longevity**: 60-80% less wear, extends Pi microSD life to 3-5 years  
✅ **Transparency**: Works out-of-box, no config changes needed  
✅ **Resilience**: Survives corruption, rapid redeployments, and reboots  

The design trades 5-8 seconds of startup latency for rock-solid stability and hardware longevity—a worthwhile tradeoff for edge devices.

