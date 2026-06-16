# Upstream Changes Required

Small, contained changes needed in the director and performer to produce
the data this tool consumes. Each change is independent and useful on its
own (richer artifacts), not Arcade-specific.

---

## Performer: Element Bounding Boxes

### Problem

The `@playwright/mcp` v0.0.68 snapshot YAML format includes accessibility
tree data (roles, names, refs, ARIA states) but **no bounding box
coordinates**. The `browser_snapshot` tool supports a `boxes` parameter
that adds `[box=x,y,width,height]` per element, but:

- `browser_snapshot` is in the director's `disallowedTools` list (snapshots
  are injected automatically via PostToolUse hooks)
- The `--snapshot-mode full` CLI flag does NOT support a sub-option for
  bounding boxes
- There is no `--boxes` CLI flag in v0.0.68

### Approach: `browser_evaluate` in PostToolUse hook

Add a PostToolUse shell hook in the performer that captures the bounding
box of the interacted element after each `browser_click` and `browser_type`
action. This uses the existing element reference from the tool response.

**File**: `scripts/capture-coordinates.sh` (new)
**Hook config**: `.claude/settings.json` -- add to PostToolUse hooks

The hook:
1. Detects `browser_click` / `browser_type` / `browser_fill_form` tool calls
2. Extracts the target element reference from the tool input
3. Uses `browser_evaluate` to call `getBoundingClientRect()` on the element
4. Appends a line to `.playwright-mcp/coordinates.jsonl`

**Alternative approach (simpler, if Playwright MCP adds support):**

Monitor `@playwright/mcp` releases for a `--boxes` flag on
`--snapshot-mode`. If added, the change becomes a one-line flag addition
to `scripts/playwright-mcp.sh` and no hook is needed. The bounding box
data would appear inline in the snapshot YAML as `[box=x,y,w,h]`
annotations.

**Alternative approach (simplest, no performer changes):**

Skip precise coordinates entirely. Use the vision model fallback in the
publisher (extract video frames, ask a vision model where to click) or
rely on Arcade's "Video to Arcade" auto-detection. This is less precise
but requires zero upstream changes.

### Estimated effort

- Hook script: ~50 lines of bash
- Settings change: 3 lines in `.claude/settings.json`
- Risk: Low -- PostToolUse hooks are additive and don't affect test execution

---

## Director: Collect Snapshot YAMLs (Option A)

### Problem

Snapshot `.yml` files are written to `<pluginDir>/.playwright-mcp/` during
execution but are **not collected** as artifacts. They're ephemeral --
lost when the workspace is cleaned up.

### Change

Add a `collectSnapshots()` function to `src/artifacts.ts` that copies
`.yml` files from `<pluginDir>/.playwright-mcp/` to
`<runDir>/snapshots/`.

**File**: `src/artifacts.ts`

```typescript
// New function, similar to collectVideoMetadata()
export function collectSnapshots(
  pluginDir: string,
  runDir: string,
  deps: FsDeps = defaultFsDeps,
): number {
  const srcDir = join(pluginDir, '.playwright-mcp');
  if (!deps.existsSync(srcDir)) return 0;

  const destDir = join(runDir, 'snapshots');
  deps.mkdirSync(destDir, { recursive: true });

  const files = deps.readdirSync(srcDir).filter((f) => f.endsWith('.yml'));
  for (const file of files) {
    deps.copyFileSync(join(srcDir, file), join(destDir, file));
  }
  return files.length;
}
```

Call from `collectArtifacts()` after video metadata collection.

### Considerations

- Snapshot files can be numerous (one per browser action, ~50-300 per
  workflow run) but small (~2-20KB each).
- Total per run: typically 1-5MB. Acceptable for artifact storage.
- Gate behind an env var if disk space is a concern:
  `COLLECT_SNAPSHOTS=true` (default: false).

### Estimated effort

- ~15 lines of code + ~5 lines call site
- One unit test
- Risk: None -- purely additive

---

## Director: Parse Bounding Boxes into ActionEntry (Option B)

### Problem

The `ActionEntry` interface stores the full tool input but has no
dedicated field for element coordinates. The action log markdown does
not render coordinate data.

### Change

1. Add optional `boundingBox` field to `ActionEntry`:

```typescript
interface ActionEntry {
  // ... existing fields ...
  readonly boundingBox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
  };
}
```

2. In `recordAction()`, after processing the tool response, attempt to
   extract bounding box data from:
   - The snapshot YAML (if it contains `[box=...]` annotations -- future)
   - The `coordinates.jsonl` sidecar file (if the performer hook produces it)
   - The tool response itself (if Playwright MCP includes coordinates)

3. Write a `coordinates.jsonl` sidecar file alongside `actions.md` in
   `writeActionLog()`, containing one JSON line per action that has
   bounding box data.

### Hook execution order consideration

Currently in `runner.ts`:
```typescript
PostToolUse: [{ hooks: [capturePlaywrightActions(recorder), injectPlaywrightSnapshots(l)] }],
```

`capturePlaywrightActions` runs first and sees the **original** tool
response (with `[Snapshot](path.yml)` link). If we want to parse the
YAML for bounding box data, we could:

a. Read the YAML file directly in `recordAction()` (independent of the
   injection hook), or
b. Reorder hooks so snapshot injection runs first and pass parsed data
   through, or
c. Parse the YAML in a shared step that both hooks consume.

Option (a) is simplest -- `recordAction()` already receives the response
text containing the YAML file path. It can read the file independently.

### Estimated effort

- ~30 lines of code for the interface extension
- ~40 lines for YAML parsing (if bounding box data is available)
- ~20 lines for `coordinates.jsonl` output
- Two unit tests
- Risk: Low -- additive field, no breaking changes

---

## Change Priority

| # | Change | Value | Effort | Recommendation |
|---|---|---|---|---|
| 1 | Director: collect snapshots (Option A) | Medium | Tiny | Do first -- preserves data for future use |
| 2 | Director: coordinates in ActionEntry (Option B) | High | Small | Do second -- enables the publisher |
| 3 | Performer: coordinate capture hook | High | Small | Do when ready to produce precise hotspots |

Changes 1 and 2 can be done immediately. Change 3 can wait until the
Arcade API is validated and we confirm that coordinates are needed (vs
Arcade auto-detecting click positions from the video).

---

## No-Change Baseline

Even with **zero upstream changes**, the publisher can function:

- Upload `recording.webm` with timestamp-only events (no coordinates)
- Use `actions.md` for step descriptions and labels
- Use `report.md` for title and chapter structure
- Rely on Arcade's editor or "Video to Arcade" feature for hotspot
  placement

The upstream changes improve precision and automation, but are not
blockers for an initial version.
