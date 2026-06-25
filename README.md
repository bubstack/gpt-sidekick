# GPT-Sidekick Prototype

GPT-Sidekick is a Chrome MV3 side-panel prototype for ChatGPT conversations. It is meant to prove the core shape from `gpt-sidekick-product-plan.md`: a local-first, source-linked outline that helps recover decisions, actions, questions, artifacts, code, and corrections from a long chat.

This is a prototype, not a finished extension.

## Current State

What exists:

- A small TypeScript/Vite/Vitest project.
- A Chrome MV3 build that emits `dist/manifest.json`, `dist/sidepanel.html`, a content script, and a service worker.
- A headless core for transcript normalization, provider capability modeling, segment grouping, evidence validation, incremental outline merging, source anchors, local thread snapshots, and deterministic redaction.
- A ChatGPT web content-script adapter that reads currently loaded DOM messages, observes new or streaming messages, suppresses duplicate mutation events, reports indexing states, and can scroll back to a source anchor.
- A side panel UI that renders categorized outline items, evidence quotes, indexing status, and copy actions for decisions, checklists, JSON, and code.
- Tests for the core, ChatGPT adapter DOM behavior, and side panel rendering/actions.

What is intentionally limited:

- The outline extractor is heuristic and deterministic. It looks for explicit prefixes such as `Decision:`, `Action:`, `Question:`, `Artifact:`, `Code:`, `Correction:`, and `Note:`. There is no model-backed summarization yet.
- Model-backed extraction is only represented by the injectable `OutlineExtractor` interface.
- The adapter supports ChatGPT web only.
- The host is Chrome MV3 only.
- Storage is local only through `chrome.storage.local`; there is no cloud sync.
- Loaded-history capture only covers what the page has already rendered. There is no claim of complete server-side conversation history.
- There is no team workflow, account system, remote API, or multi-provider abstraction beyond the core boundary.
- Browser-level/manual extension testing has not been performed in this workspace. The build is present and loadable by structure, but the extension has not been smoke-tested inside Chrome here.

## Verified

Current verification commands:

```sh
pnpm test
pnpm build
```

Current result:

- `pnpm test` passes: 18 tests across 3 suites.
- `pnpm build` passes.
- The generated manifest references files that exist in `dist`: `sidepanel.html`, `assets/service-worker.js`, and `assets/content-script.js`.

## Run Locally

```sh
pnpm install
pnpm test
pnpm build
```

`pnpm install` uses a project-level pnpm build allowlist for `esbuild`, which Vite/Vitest need.

## Load in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this repo's `dist` directory.
6. Open a ChatGPT conversation on `chatgpt.com` or `chat.openai.com`.
7. Open the GPT-Sidekick side panel from the extension action.

## Architecture Map

- Core types: `src/core/types.ts`
- Core implementation: `src/core/index.ts`
- ChatGPT adapter: `src/adapters/chatgpt.ts`
- Content script: `src/extension/content-script.ts`
- Service worker: `src/extension/service-worker.ts`
- Side panel renderer: `src/ui/sidepanel.ts`
- Side panel entrypoint/styles: `src/sidepanel/main.ts`, `src/sidepanel/sidepanel.css`
- Build script: `scripts/build-extension.mjs`
- Extension shell: `sidepanel.html`

## Evidence Rule

Every `OutlineItem` must include evidence with:

- `messageId`
- `quote`
- `anchor`

The core rejects outline items without evidence. The side panel renders evidence quotes and exposes a source-jump control. The ChatGPT adapter handles the DOM scroll for source jumps.

## Incremental Processing

Transcript events are grouped into stable segments. New or changed events process the affected segment plus a small context window. New outline candidates are merged into the thread outline without duplicating evidence.

## Privacy Posture

The prototype is local-first:

- Thread snapshots are written to local Chrome storage.
- Conversation content is not uploaded.
- Redaction is deterministic for common sensitive values such as emails, bearer tokens, and API keys.
- Any future model integration should be added behind `OutlineExtractor` and should require an explicit privacy decision before content leaves the browser.

## Next Work

High-value next steps:

- Manually load `dist` in Chrome and smoke-test against a real ChatGPT conversation.
- Add a browser-level test only if the manual smoke test exposes behavior that jsdom cannot cover.
- Replace or augment the heuristic extractor with a model-backed extractor behind the existing interface.
- Add a delete-thread control and visible storage/reset behavior.
- Harden DOM selectors against real ChatGPT markup changes.
- Add explicit empty, failed, and no-permission UI states.
