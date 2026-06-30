# Workflow Validation Demo Publisher

A CLI tool that transforms [workflow validation](https://gitlab.com/redhat/rhel-ai/workflow-validation) artifacts into interactive [Arcade](https://arcade.software) demos.

It takes the output of the workflow-validation-director (video recordings, action logs, reports) and publishes them as interactive product demos -- automatically, with no manual recording.

## How It Works

```
workflow spec  -->  director + performer  -->  artifacts  -->  demo-publisher  -->  Arcade demo
                    (runs workflow on        (video, actions.md,                    (interactive
                     live cluster)            report.md)                            product demo)
```

The demo publisher:

1. **Parses** `actions.md` for click/type actions with timestamps
2. **Trims** the video to remove idle time (page loads, spinners, API waits)
3. **Crops** grey bars from raw per-tab recordings (if present)
4. **Uploads** via Arcade's "Video to Interactive Demo" feature
5. **Avery AI** (Arcade's built-in AI) generates cover page, step splits, and callout text

## Requirements

- **Node.js 20+**
- **ffmpeg** -- for video trimming and format conversion
- **Google Chrome** -- for Playwright-based Arcade upload
- **Arcade account** -- logged into [app.arcade.software](https://app.arcade.software) via Chrome
- **Claude API** (optional) -- for LLM-enhanced callout text via Vertex AI

## Setup

```bash
git clone git@gitlab.com:redhat/rhel-ai/workflow-validation/workflow-validation-demo-publisher.git
cd workflow-validation-demo-publisher
npm ci
```

### Arcade Authentication

The tool uses Playwright to automate the Arcade web UI. It needs a browser session state file:

1. Open `https://app.arcade.software` in Chrome and log in via SSO
2. Run the cookie extraction script (requires Chrome to be closed):
   ```bash
   ./scripts/get-arcade-cookie.sh
   ```
   This saves the session to `~/.arcade-state.json`

Alternatively, extract cookies manually via Chrome DevTools:
```bash
./scripts/get-arcade-cookie.sh --from-devtools
```

### Claude API (Optional)

For LLM-enhanced callout text, configure Vertex AI:

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project"
export CLOUD_ML_REGION="us-east5"
```

Or direct Anthropic API:
```bash
export ANTHROPIC_API_KEY="your-key"
```

## Usage

### Publish a trimmed video demo (recommended)

```bash
node --import tsx src/index.ts publish-video --trim <artifact-dir>
```

This is the primary command. It trims idle time from the recording and uploads via Arcade's "Video to Interactive Demo" feature. Avery AI generates interactive steps with callouts automatically.

Example:
```bash
node --import tsx src/index.ts publish-video --trim \
  ~/GIT/workflow-validation-director/artifacts_journeys/1782747339/demo-workflow/create-project-and-notebook-full/
```

### Dry-run (no upload)

```bash
node --import tsx src/index.ts publish --dry-run <artifact-dir>
```

Outputs the parsed action manifest as JSON to stdout without uploading anything. Useful for testing parsers and transforms.

### All commands

| Command | Description |
|---|---|
| `publish --dry-run <dir>` | Parse artifacts and output manifest (no upload) |
| `publish-video --trim <dir>` | Trim video + upload via Arcade Video to Interactive Demo |
| `publish-screenshots --enhance <dir>` | Extract frames + LLM callouts + upload |
| `publish-all --dry-run <run-dir>` | Process all workflows in a run directory |

### Common options

| Option | Description | Default |
|---|---|---|
| `--cookie-file <path>` | Arcade session cookie file | `~/.arcade-cookie` |
| `--storage-state <path>` | Playwright storage state | `~/.arcade-state.json` |
| `--video <path>` | Override video file path | auto-detect |
| `--trim` | Remove idle time from video | `false` |
| `--enhance` | Use Claude for better callout text | `false` |
| `--title <title>` | Override demo title | from report.md |

## Artifacts

The tool expects an artifact directory containing output from the workflow-validation-director:

| File | Required | Description |
|---|---|---|
| `actions.md` | Yes | Browser action log with timestamps and narratives |
| `recording.webm` | For video commands | Merged video recording |
| `*.webm` | Fallback | Raw per-tab video recordings |
| `report.md` | No | Workflow report (used for title/description) |

## Development

```bash
npm run build           # Compile TypeScript
npm run typecheck       # Type-check without emitting
npm run lint            # ESLint
npm test                # Run unit tests (39 tests)
npm run check           # All of the above
```

## Architecture

```
src/
├── index.ts                 # CLI entrypoint
├── cli.ts                   # Commander-based argument parsing
├── types.ts                 # Core interfaces
├── parsers/
│   ├── actions.ts           # Parse actions.md (Detailed Actions + Timeline fallback)
│   └── report.ts            # Parse report.md (title, description, sections)
├── transform/
│   ├── events.ts            # DemoAction[] -> ArcadeEvent[]
│   ├── labels.ts            # Narrative -> imperative callout text
│   ├── enhance.ts           # LLM-generated callout text via Claude
│   └── annotate.ts          # Claude vision click target detection
├── arcade/
│   ├── client.ts            # REST API client with dry-run support
│   ├── auth.ts              # Cookie-based auth + Firebase token refresh
│   ├── video-to-demo.ts     # "Video to Interactive Demo" Playwright flow
│   ├── record-demo.ts       # Replay clicks on screenshots as live recording
│   ├── screenshots-to-demo.ts # Upload screenshots as individual steps
│   ├── extension-client.ts  # Internal extension API client
│   └── upload.ts            # Video upload orchestration
├── util/
│   ├── logger.ts            # Structured JSON logging
│   ├── frames.ts            # ffmpeg frame extraction with auto-crop
│   ├── trim-video.ts        # Remove idle time + detect grey bars
│   └── slideshow.ts         # Create video from screenshot sequence
└── scripts/
    └── get-arcade-cookie.sh # Extract Arcade session from Chrome
```

## Current Limitations

- **Arcade API not available** -- Arcade's REST API does not support programmatic demo creation. We use the web UI via Playwright automation instead.
- **Avery step splitting** -- Arcade's AI (Avery) controls how the video is split into interactive steps. We cannot control the number or boundaries of steps.
- **Session cookies expire** -- The Arcade session cookie expires after ~1 hour. Token refresh requires the Firebase API key.
- **Single workspace** -- Currently hardcoded to the `red-hat` Arcade workspace.

## Related Projects

- [workflow-validation-director](https://gitlab.com/redhat/rhel-ai/workflow-validation/workflow-validation-director) -- Orchestrates AI-driven workflow execution
- [workflow-validation-performer-plugin](https://gitlab.com/redhat/rhel-ai/workflow-validation/workflow-validation-performer-plugin) -- Playwright MCP plugin for browser automation
- [rhoai-customer-workflows](https://gitlab.com/redhat/rhel-ai/workflow-validation/rhoai-customer-workflows) -- Customer workflow specifications
