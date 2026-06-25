# Throughline Prototype

Throughline is a Chrome MV3 side-panel prototype for ChatGPT conversations. It captures loaded and newly arriving ChatGPT messages, normalizes them into a provider-neutral transcript model, builds a local evidence-linked outline, and stores thread state in `chrome.storage.local`.

## Run

```sh
pnpm install
pnpm test
pnpm build
```

## Load the Extension

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this repo's `dist` directory.
6. Open a ChatGPT conversation on `chatgpt.com` or `chat.openai.com`, then open the Throughline side panel from the extension action.

## What the MVP Includes

- Chrome MV3 side panel with categorized outline groups: decisions, actions, questions, artifacts, code, corrections, and notes.
- ChatGPT web content script that captures loaded DOM messages, observes new and streaming messages, de-duplicates mutation events, marks partial indexing when IDs or content are unstable, and supports source jumps.
- Headless TypeScript core for transcript normalization, provider capability modeling, segment grouping, evidence validation, incremental candidate merging, source anchors, local thread storage, and deterministic redaction.
- Copy actions for decisions, checklists, JSON, and code.
- Local-first storage only. There is no cloud sync, team feature, multi-provider support, multi-browser support, or full-server-history claim.

## Evidence and Source Linking

Every `OutlineItem` must include at least one evidence link with a `messageId`, quote, and source anchor. The core rejects outline items without evidence. The side panel renders evidence quotes and sends source-jump requests back to the content script, which scrolls to the anchored ChatGPT DOM node.

## Incremental Processing

Transcript events are grouped into stable segments. New or changed events process only the affected segment plus a small context window, then merge outline candidates into the thread-level outline without duplicating evidence.

## Privacy Posture

The prototype writes snapshots to `chrome.storage.local` and does not upload conversation content. Redaction is deterministic for common sensitive values such as email addresses, bearer tokens, and API keys. Model-backed summarization is intentionally behind the injectable `OutlineExtractor` interface; `HeuristicOutlineExtractor` is the deterministic test double and prototype implementation.

## Verification

```sh
pnpm test
pnpm build
```
