# CLAUDE.md

## What This Project Does

A standalone CLI tool that transforms workflow validation artifacts into
interactive Arcade (https://arcade.software) demos.

It consumes artifacts produced by the workflow-validation-director and
workflow-validation-performer-plugin (video recordings, action logs,
reports, screenshots) and publishes them to Arcade's REST API as
interactive step-by-step demos.

See `docs/architecture.md` for the full design and `docs/upstream-changes.md`
for the small upstream changes needed in the director/performer.

## Build and Run Commands

```bash
npm ci                  # Install dependencies
npm run build           # Compile TypeScript (tsc)
npm run typecheck       # Type-check without emitting
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm test                # Run unit tests (node:test + tsx)
```

## Project Conventions

- **ESM-only** -- `"type": "module"` in package.json. All imports use `.js`
  extensions (e.g., `import { foo } from './bar.js'`).
- **Node.js 20+** required.
- **Strict TypeScript** -- `strict: true`, `noImplicitAny: true`.
- **No runtime dependency on director or performer** -- this tool reads
  file artifacts only. Never import from either project.
- Commits use conventional commit format.

## Architecture

```
src/
├── index.ts                 # CLI entrypoint (#!/usr/bin/env node)
├── cli.ts                   # Commander-based arg parsing (publish, publish-all)
├── types.ts                 # Core interfaces (DemoAction, ArcadeEvent, etc.)
├── parsers/                 # Read artifact files into internal types
│   ├── actions.ts           # Parse actions.md (Detailed Actions + Timeline fallback)
│   └── report.ts            # Parse report.md (title, description, chapters)
├── transform/               # Convert internal types to Arcade format
│   ├── events.ts            # DemoAction[] -> ArcadeEvent[]
│   └── labels.ts            # Narrative -> imperative callout text
├── arcade/                  # Arcade REST API client
│   ├── client.ts            # API wrapper with dry-run support
│   ├── upload.ts            # Video upload orchestration
│   └── types.ts             # API request/response type definitions
└── util/
    └── logger.ts            # Structured JSON logging to stderr
```

### Not yet implemented (deferred)

- `parsers/coordinates.ts` -- parse coordinates.jsonl (not yet emitted upstream)
- `parsers/snapshots.ts` -- parse snapshot YAMLs (not yet collected upstream)
- `parsers/video-meta.ts` -- parse video metadata for timestamp alignment
- `parsers/results.ts` -- parse results.txt for skip/fail filtering
- `transform/timestamps.ts` -- wall-clock to video-relative conversion

## Key Design Decisions

1. **File-based interface** -- consumes artifact directories, no IPC or
   imports from upstream projects.
2. **Fallback chain for coordinates** -- coordinates.jsonl > snapshot YAMLs >
   no-coordinate (video-only) mode. Vision model fallback was dropped as
   too heavy and non-deterministic.
3. **Idempotent** -- re-running on the same artifacts updates rather than
   duplicates. Requires `--arcade-id` flag for updates in v1.
4. **actions.md parser** -- prefers the Detailed Actions section (has tool
   names) over the Timeline table (infers types from narrative text).
5. **Arcade API** -- coordinates are pixel values (not normalized 0-1),
   labels on click events work via API, chapters are editor-only.
   Auth is a raw API key in the `authorization` header (no Bearer prefix).

## Learnings

- The `.gitignore` blocks `*.js` -- must allowlist `!eslint.config.js` and
  `!commitlint.config.js`.
- Arcade's MCP integration cannot create interactive demos; only the REST
  API can (Enterprise plan required).
- Artifact directory structure is double-nested: `<run>/<workflow>/<workflow>/`.
- `actions.md` is not guaranteed to exist in every workflow run.
- `tsconfig.json` uses `module: "node16"` / `moduleResolution: "node16"`
  (not `"node"`) for correct ESM `.js` extension enforcement.
