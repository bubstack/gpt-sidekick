import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const root = process.cwd();
const outDir = resolve(root, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  root,
  configFile: false,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(root, "sidepanel.html")
    }
  }
});

await build({
  root,
  configFile: false,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(root, "src/extension/content-script.ts"),
      name: "GPTSidekickContent",
      formats: ["iife"],
      fileName: () => "assets/content-script.js"
    }
  }
});

await build({
  root,
  configFile: false,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(root, "src/extension/service-worker.ts"),
      name: "GPTSidekickServiceWorker",
      formats: ["iife"],
      fileName: () => "assets/service-worker.js"
    }
  }
});

const manifest = {
  manifest_version: 3,
  name: "GPT-Sidekick Prototype",
  version: "0.1.0",
  description: "A local-first, source-linked side panel for loaded ChatGPT conversations.",
  permissions: ["storage", "sidePanel", "activeTab"],
  host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  background: {
    service_worker: "assets/service-worker.js"
  },
  side_panel: {
    default_path: "sidepanel.html"
  },
  action: {
    default_title: "Open GPT-Sidekick"
  },
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["assets/content-script.js"],
      run_at: "document_idle"
    }
  ]
};

await writeFile(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
