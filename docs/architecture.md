# Architecture: workflow-validation-demo-publisher

## Overview

A standalone CLI tool that transforms workflow validation artifacts (produced by
[workflow-validation-director](https://github.com/redhat/workflow-validation-director) +
[workflow-validation-performer-plugin](https://github.com/redhat/workflow-validation-performer-plugin))
into interactive [Arcade](https://arcade.software) demos.

It runs **after** the director/performer have completed a workflow validation run.
It reads from the artifacts directory, builds an Arcade-compatible event manifest,
uploads the video, and creates (or updates) an interactive demo via Arcade's REST API.

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐
│  Performer   │───>│   Director   │───>│  Artifacts Directory     │
│  (browser)   │    │  (orchestr.) │    │  ├── recording.webm      │
└──────────────┘    └──────────────┘    │  ├── actions.md           │
                                        │  ├── report.md            │
                                        │  ├── *.png (screenshots)  │
                                        │  ├── snapshots/*.yml (new)│
                                        │  └── coordinates.jsonl(new│)
                                        └────────────┬─────────────┘
                                                     │
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  demo-publisher (this)   │
                                        │  1. Parse artifacts      │
                                        │  2. Build event manifest │
                                        │  3. Upload video         │
                                        │  4. Create/update Arcade │
                                        └────────────┬─────────────┘
                                                     │
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  Arcade REST API         │
                                        │  (Enterprise plan)       │
                                        └──────────────────────────┘
```

## Design Principles

1. **Zero coupling to director/performer code** -- consumes file artifacts only, never
   imports from either project. If the artifact format changes, only the parsers here
   need updating.

2. **Idempotent** -- running the publisher twice on the same artifacts produces the
   same result. If an Arcade already exists for a workflow, it updates rather than
   duplicates.

3. **Graceful degradation** -- if bounding box data is unavailable (older runs without
   the upstream enrichments), the publisher falls back to approximate positioning or
   produces a video-only Arcade without interactive hotspots.

4. **On-demand, not embedded** -- invoked manually or from a CI step after the test
   run, never during the test run itself.

## Artifact Inputs

### Currently available (no upstream changes needed)

| File | Content | Used for |
|---|---|---|
| `recording.webm` | Merged multi-tab browser recording | Video uploaded to Arcade |
| `actions.md` | Markdown action log with timeline table | Step descriptions, hotspot labels |
| `report.md` | Prose workflow validation report | Arcade title, description, chapter structure |
| `*.png` | Screenshots at task completion / failure | Fallback step images if video unavailable |
| `results.txt` | Structured pass/fail results | Skip failed workflows, annotate demo |

### New artifacts (require small upstream changes)

| File | Content | Used for | Upstream change |
|---|---|---|---|
| `snapshots/*.yml` | Accessibility tree YAML with bounding boxes | Element positions for hotspot coordinates | Director: collect `.yml` files |
| `coordinates.jsonl` | Per-action `{tool, ref, x, y, w, h, viewportW, viewportH, timestamp}` | Precise hotspot placement | Director: parse boxes from snapshots into ActionEntry, write sidecar |

See [upstream-changes.md](./upstream-changes.md) for details.

## Data Flow

### Step 1: Parse artifacts

Read the artifacts directory and build an internal representation:

```typescript
interface WorkflowDemo {
  title: string;                    // from report.md heading
  description: string;              // from report.md summary
  videoPath: string;                // path to recording.webm
  actions: DemoAction[];            // parsed from actions.md or coordinates.jsonl
  chapters: DemoChapter[];          // from report.md task structure
  screenshots: string[];            // paths to *.png files
}

interface DemoAction {
  type: 'click' | 'type' | 'scroll' | 'navigate';
  timestamp: number;                // seconds from video start
  target?: { x: number; y: number }; // viewport coordinates (click only)
  label?: string;                   // human-readable callout text
  elementRef?: string;              // original element ref (e.g., "e47")
  page?: { url: string; title: string };
}

interface DemoChapter {
  title: string;                    // task name
  timestampStart: number;           // seconds from video start
}
```

### Step 2: Transform to Arcade event format

Map `DemoAction[]` to Arcade's event format:

```typescript
interface ArcadeEvent {
  type: 'click' | 'scroll' | 'type';
  timestamp: number;                // seconds into the video
  target?: { x: number; y: number }; // required for click events
  label?: string;                   // hotspot label text
}
```

Transformation rules:
- `browser_click` -> `{ type: 'click', timestamp, target: {x, y}, label }`
- `browser_type` / `browser_fill_form` -> `{ type: 'type', timestamp }`
- `browser_evaluate` with scroll -> `{ type: 'scroll', timestamp }`
- `browser_navigate` -> chapter boundary marker (not an Arcade event)
- `browser_snapshot` / `browser_take_screenshot` -> ignored (observational, not interactive)

**Hotspot label generation:**
- Raw narrative: `'Clicked "Create Project"'`
- Demo label: `'Click "Create Project"'` (imperative form)
- This can be a static regex transformation or optionally polished by an LLM call.

### Step 3: Upload video to Arcade

```
POST https://api.arcade.software/generate-upload-url
  { "contentType": "video/webm" }
  -> { uploadUrl, uploadId }

PUT <uploadUrl>
  Content-Type: video/webm
  Body: <recording.webm binary>
```

### Step 4: Create or update Arcade

```
POST https://api.arcade.software/arcades
  {
    "title": "Fraud Detection Workflow - OpenShift AI",
    "description": "Interactive walkthrough of the fraud detection model deployment",
    "uploadId": "<from step 3>",
    "events": [ ... ]
  }
  -> { arcadeId }
```

If updating an existing Arcade:
```
PUT https://api.arcade.software/arcades/<arcadeId>
  { same body }
```

### Step 5: Output

Write results to stdout and optionally to a manifest file:

```json
{
  "arcadeId": "abc123",
  "shareUrl": "https://app.arcade.software/share/abc123",
  "title": "Fraud Detection Workflow",
  "steps": 12,
  "duration": "2m 34s",
  "createdAt": "2026-06-14T12:00:00Z"
}
```

## CLI Interface

```bash
# Basic usage
demo-publisher publish <artifacts-dir> \
  --api-key <ARCADE_API_KEY>

# With title override
demo-publisher publish ./artifacts/run-123/fraud-detection/ \
  --api-key $ARCADE_API_KEY \
  --title "Fraud Detection - RHOAI 2.20"

# Update existing Arcade
demo-publisher publish ./artifacts/run-123/fraud-detection/ \
  --api-key $ARCADE_API_KEY \
  --arcade-id abc123

# Dry run (build manifest, don't upload)
demo-publisher publish ./artifacts/run-123/fraud-detection/ \
  --dry-run \
  --output arcade-events.json

# Publish all workflows from a test run
demo-publisher publish-all ./artifacts/run-123/ \
  --api-key $ARCADE_API_KEY
```

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `ARCADE_API_KEY` | Arcade REST API key (Enterprise plan) | Yes (or `--api-key`) |
| `ARCADE_BASE_URL` | API base URL (default: `https://api.arcade.software`) | No |

## Coordinate Resolution Strategy

Getting hotspot coordinates is the main technical challenge. The publisher
uses a **fallback chain**:

### Priority 1: `coordinates.jsonl` (most precise)

If the director has been enriched to emit `coordinates.jsonl`, each line
contains exact bounding box data per action:

```json
{"index":1,"tool":"browser_click","ref":"e47","x":412,"y":305,"w":120,"h":36,"viewportW":1920,"viewportH":1080,"timestamp":"2026-06-14T10:00:12.345Z"}
```

The publisher normalizes coordinates to relative positions within the video
frame (accounting for viewport-to-video-frame ratio and any grey border
cropping applied by the director's video merge).

### Priority 2: Snapshot YAML with bounding boxes

If `snapshots/*.yml` files are available and contain `[box=x,y,w,h]`
annotations (requires Playwright MCP to support this -- see
[upstream-changes.md](./upstream-changes.md)), the publisher:

1. Matches each `browser_click` action's `ref` to the corresponding element
   in the snapshot YAML taken at that step
2. Extracts the bounding box
3. Computes the center point as the hotspot coordinate

### Priority 3: Vision model estimation

If no coordinate data is available, the publisher can optionally use a vision
model to estimate click positions:

1. Extract video frames at each action's timestamp using ffmpeg
2. Send each frame + the action narrative to a vision model
3. Ask: "Where on this screenshot would someone click to perform: {narrative}?"
4. Use the estimated coordinates

This is expensive and imprecise, but works with zero upstream changes.
Gated behind `--use-vision-fallback` flag.

### Priority 4: Arcade auto-detection

As a last resort, upload the video without click coordinates and rely on
Arcade's in-app "Video to Arcade" feature to auto-detect interaction points.
The publisher produces a video-only Arcade in this case.

## Project Structure

```
workflow-validation-demo-publisher/
├── docs/
│   ├── architecture.md          # This file
│   └── upstream-changes.md      # Changes needed in director/performer
├── src/
│   ├── index.ts                 # CLI entrypoint
│   ├── cli.ts                   # Argument parsing (yargs or commander)
│   ├── parsers/
│   │   ├── actions.ts           # Parse actions.md into DemoAction[]
│   │   ├── report.ts            # Parse report.md for title/chapters
│   │   ├── coordinates.ts       # Parse coordinates.jsonl
│   │   ├── snapshots.ts         # Parse snapshot YAMLs for bounding boxes
│   │   └── video-meta.ts        # Parse video metadata for timestamp alignment
│   ├── transform/
│   │   ├── events.ts            # DemoAction[] -> ArcadeEvent[]
│   │   ├── labels.ts            # Narrative -> demo callout text
│   │   └── timestamps.ts        # Wall-clock -> video-relative conversion
│   ├── arcade/
│   │   ├── client.ts            # Arcade REST API client
│   │   ├── upload.ts            # Video upload (generate URL + PUT)
│   │   └── types.ts             # Arcade API type definitions
│   └── util/
│       ├── ffmpeg.ts            # Frame extraction for vision fallback
│       └── logger.ts            # Structured logging
├── tests/
│   ├── fixtures/                # Sample artifacts directories
│   └── ...
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Technology Stack

- **Runtime**: Node.js 20+, ESM
- **Language**: TypeScript (strict)
- **CLI framework**: `commander` or `yargs`
- **HTTP client**: `undici` (built into Node.js) or `node-fetch`
- **YAML parsing**: `yaml` package (for snapshot bounding box extraction)
- **Video processing**: `ffmpeg` CLI (optional, for frame extraction)
- **Testing**: `node:test` + `tsx` (matching director conventions)
- **Linting**: ESLint with typescript-eslint

## Open Questions for Arcade

Before building the API integration, these need to be validated with Arcade
(especially once Enterprise access is granted):

1. **Callout text from API** -- Can hotspot `label` values be rendered as
   callouts/tooltips in the demo, or does that require post-creation editing
   in the Arcade editor?

2. **Chapter support** -- Can chapter/section breaks be defined via the API's
   event list, or is that editor-only?

3. **Brand kit assignment** -- Can a brand kit / theme be applied at creation
   time via the API, or only via the editor?

4. **Coordinate system** -- Are `target.x` / `target.y` in pixels relative to
   the video frame dimensions? Are they normalized (0-1)?

5. **Video format requirements** -- Does WebM work reliably? Any codec
   constraints (VP8 vs VP9)? Max file size?

6. **Auto-detection API** -- Is the "Video to Arcade" auto-detection feature
   available via API, or only through the in-app editor?

7. **Custom domain** -- The example at `interact.redhat.com` uses a custom
   domain. Is custom domain available via API, or is it a workspace-level
   setting?
