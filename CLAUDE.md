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
├── index.ts                 # CLI entrypoint
├── cli.ts                   # Argument parsing
├── parsers/                 # Read artifact files into internal types
│   ├── actions.ts           # Parse actions.md
│   ├── report.ts            # Parse report.md
│   ├── coordinates.ts       # Parse coordinates.jsonl
│   ├── snapshots.ts         # Parse snapshot YAMLs
│   └── video-meta.ts        # Parse video metadata
├── transform/               # Convert internal types to Arcade format
│   ├── events.ts            # DemoAction[] -> ArcadeEvent[]
│   ├── labels.ts            # Narrative -> demo callout text
│   └── timestamps.ts        # Wall-clock -> video-relative timestamps
├── arcade/                  # Arcade REST API client
│   ├── client.ts            # API wrapper
│   ├── upload.ts            # Video upload flow
│   └── types.ts             # API type definitions
└── util/
    ├── ffmpeg.ts            # Frame extraction (vision fallback)
    └── logger.ts            # Structured logging
```

## Key Design Decisions

1. **File-based interface** -- consumes artifact directories, no IPC or
   imports from upstream projects.
2. **Fallback chain for coordinates** -- coordinates.jsonl > snapshot YAMLs >
   vision model > no-coordinate (video-only) mode.
3. **Idempotent** -- re-running on the same artifacts updates rather than
   duplicates.
