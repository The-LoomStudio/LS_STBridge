// src/client/index.ts
var module = {
  activate(context) {
    context.renderers.register({
      id: "overall-migration-modal",
      name: "\u6574\u4F53\u8FC1\u79FB",
      surface: "shell.workspace-panel",
      instanceScope: "workspace",
      adapter: "direct"
    }, {
      mount(root, rendererContext) {
        mountMigrationModal(root, context, rendererContext.close);
      }
    });
    context.commands.register("overall-migration", () => {
      context.renderers.openStandalone("overall-migration-modal", {
        scope: { kind: "workspace", key: "workspace" }
      });
    });
  }
};
function mountMigrationModal(root, context, close) {
  root.replaceChildren();
  root.className = "stbridge-migration-root";
  const style = document.createElement("style");
  style.textContent = `
    .stbridge-migration-root { min-height: 100%; color: var(--loom-color-text, #f3f4f6); box-sizing: border-box; }
    .stbridge-migration-modal { max-width: 760px; margin: 0 auto; border-bottom: 1px solid var(--loom-color-divider, #3a3d42); background: var(--loom-color-surface, #202328); overflow: hidden; }
    .stbridge-migration-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--loom-color-divider, #3a3d42); }
    .stbridge-migration-header div { display: grid; gap: 4px; }
    .stbridge-migration-header small, .stbridge-migration-status { color: var(--loom-color-text-muted, #a7adb8); }
    .stbridge-migration-header button { border: 0; background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
    .stbridge-migration-body { display: grid; gap: 16px; padding: 24px; }
    .stbridge-migration-body label { display: grid; gap: 8px; color: var(--loom-color-text-muted, #a7adb8); }
    .stbridge-migration-body input { min-width: 0; padding: 10px 12px; border: 1px solid var(--loom-color-divider, #3a3d42); border-radius: 6px; background: var(--loom-color-background, #15171c); color: inherit; font: inherit; }
    .stbridge-migration-body > button { width: fit-content; padding: 8px 14px; border: 1px solid var(--loom-color-divider, #3a3d42); border-radius: 6px; background: var(--loom-color-accent, #385d8a); color: white; cursor: pointer; }
    .stbridge-migration-body > button:disabled { opacity: .5; cursor: not-allowed; }
    .stbridge-migration-results { padding: 14px; border: 1px solid var(--loom-color-divider, #3a3d42); border-radius: 6px; }
    .stbridge-migration-progress { width: 100%; height: 8px; accent-color: var(--loom-color-accent, #385d8a); }
    .stbridge-migration-status { min-height: 24px; margin: 0; }
    .stbridge-migration-results dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 18px; margin: 12px 0 0; }
    .stbridge-migration-results dd { margin: 0; font-variant-numeric: tabular-nums; }
  `;
  root.append(style);
  const modal = document.createElement("div");
  modal.className = "stbridge-migration-modal";
  modal.innerHTML = `
    <header class="stbridge-migration-header">
      <div><strong>\u6574\u4F53\u8FC1\u79FB</strong><small>\u626B\u63CF SillyTavern Data \u6587\u4EF6\u5939</small></div>
      <button type="button" data-action="close" aria-label="\u5173\u95ED">\xD7</button>
    </header>
    <main class="stbridge-migration-body">
      <p class="stbridge-migration-status">\u9009\u62E9 ST \u7684 Data \u6587\u4EF6\u5939\u5F00\u59CB\u626B\u63CF\u3002</p>
      <label>ST Data \u8DEF\u5F84<input type="text" data-action="path" placeholder="\u4F8B\u5982 /Users/me/SillyTavern/data/default-user" /></label>
      <button type="button" data-action="choose">\u5F00\u59CB\u626B\u63CF</button>
      <section class="stbridge-migration-results" hidden></section>
      <button hidden type="button" data-action="import">\u5F00\u59CB\u8FC1\u79FB</button>
    </main>
  `;
  root.append(modal);
  const pathInput = modal.querySelector('[data-action="path"]');
  const status = modal.querySelector(".stbridge-migration-status");
  const progressBar = document.createElement("progress");
  progressBar.className = "stbridge-migration-progress";
  progressBar.max = 1;
  progressBar.value = 0;
  progressBar.hidden = true;
  const results = modal.querySelector(".stbridge-migration-results");
  modal.querySelector(".stbridge-migration-body")?.insertBefore(progressBar, results);
  const importButton = modal.querySelector('[data-action="import"]');
  let scanned;
  modal.querySelector('[data-action="close"]')?.addEventListener("click", close);
  modal.querySelector('[data-action="choose"]')?.addEventListener("click", () => {
    const directory = pathInput.value.trim();
    if (!directory) {
      status.textContent = "\u8BF7\u5148\u8F93\u5165 ST Data \u76EE\u5F55\u8DEF\u5F84\u3002";
      return;
    }
    status.textContent = "\u6B63\u5728\u8BF7\u6C42\u540E\u7AEF\u626B\u63CF\u2026\u2026";
    importButton.hidden = true;
    results.hidden = false;
    results.textContent = "\u540E\u7AEF\u6B63\u5728\u626B\u63CF\u517C\u5BB9\u76EE\u5F55\u2026\u2026";
    void context.rpc.call("sillytavern.importer.migration.start", { directory }).then(async (migration) => {
      for (; ; ) {
        const report = await context.rpc.call("sillytavern.importer.migration.inspect", { sessionId: migration.sessionId });
        progressBar.hidden = false;
        progressBar.max = Math.max(1, report.scan.total);
        progressBar.value = report.scan.processed;
        status.textContent = `\u6B63\u5728\u626B\u63CF\uFF1A\u5DF2\u626B\u63CF ${report.scan.processed}/${report.scan.total} \xB7 ${report.scan.currentPath || "\u51C6\u5907\u4E2D"} \xB7 \u5DF2\u53D1\u73B0 ${report.files} \u4E2A\u6587\u4EF6`;
        if (report.scan.status === "failed") throw new Error(report.scan.error ?? "\u540E\u7AEF\u626B\u63CF\u5931\u8D25");
        if (report.scan.status === "completed") {
          scanned = { total: report.files, characters: report.counts.cards, chats: report.counts.chats, presets: report.counts.presets, worlds: report.counts.worlds, unknown: 0, items: [], importable: report.files, migrationSessionId: migration.sessionId, ignored: 0 };
          status.textContent = `\u626B\u63CF\u5B8C\u6210\uFF1A\u53D1\u73B0 ${report.files} \u4E2A\u517C\u5BB9\u6587\u4EF6`;
          progressBar.hidden = true;
          results.innerHTML = renderScanResult(scanned);
          importButton.hidden = false;
          importButton.disabled = report.files === 0;
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }).catch((error) => {
      status.textContent = `\u626B\u63CF\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      results.hidden = true;
      importButton.hidden = true;
      progressBar.hidden = true;
    });
  });
  importButton.addEventListener("click", () => {
    if (!scanned) return;
    importButton.disabled = true;
    status.textContent = "\u6B63\u5728\u8FC1\u79FB\u2026\u2026";
    void context.rpc.call("sillytavern.importer.migration.commit", {
      sessionId: scanned.migrationSessionId
    }).then((report) => {
      status.textContent = `\u8FC1\u79FB\u5B8C\u6210\uFF1A${report.imported} \u9879\u6210\u529F\u3002`;
      importButton.hidden = true;
      results.append(document.createTextNode("\u540E\u7AEF\u5DF2\u5B8C\u6210\u786E\u8BA4\u540E\u7684\u6B63\u5F0F\u5BFC\u5165\u3002"));
    }).catch((error) => {
      status.textContent = `\u8FC1\u79FB\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      importButton.disabled = false;
    });
  });
}
function normalizeScanPath(path, hasDefaultUserRoot) {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const marker = "/default-user/";
  const markerIndex = lower.indexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
  if (/^default-user\//i.test(normalized)) return normalized.slice("default-user/".length);
  return hasDefaultUserRoot ? "" : normalized.replace(/^\.?\//, "");
}
function compatibleFileKind(path) {
  const lower = path.toLowerCase();
  if (/(^|\/)characters\/[^/]+\.(png|json)$/.test(lower)) return "card";
  if (/(^|\/)chats\/[^/]+\/[^/]+\.jsonl$/.test(lower)) return "chat";
  if (/(^|\/)worlds\/[^/]+\.json$/.test(lower)) return "world";
  if (/(^|\/)openai settings\/[^/]+\.json$/.test(lower)) return "preset";
  return void 0;
}
function fingerprint(value) {
  return JSON.stringify(canonicalize(value));
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "artifactId", "createdAt", "updatedAt", "importedAt"].includes(key)).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalize(nested)]));
}
function renderScanResult(result) {
  return `
    <div><strong>\u53EF\u8FC1\u79FB\u5185\u5BB9</strong></div>
    <dl>
      <dt>\u89D2\u8272\u5361</dt><dd>${result.characters}</dd>
      <dt>\u4F1A\u8BDD</dt><dd>${result.chats}</dd>
      <dt>Preset</dt><dd>${result.presets}</dd>
      <dt>\u4E16\u754C\u4E66</dt><dd>${result.worlds}</dd>
      <dt>\u91CD\u590D\u9879</dt><dd>${result.duplicates ?? 0}</dd>
      <dt>\u540C\u540D\u51B2\u7A81</dt><dd>${result.conflicts ?? 0}</dd>
      <dt>\u8F6C\u6362\u5931\u8D25</dt><dd>${result.preparationFailures?.length ?? 0}</dd>
      <dt>\u672A\u8BC6\u522B\u6587\u4EF6</dt><dd>${result.unknown}</dd>
      <dt>\u5DF2\u5FFD\u7565\u4E0D\u517C\u5BB9\u6587\u4EF6</dt><dd>${result.ignored ?? 0}</dd>
    </dl>
  `;
}
var index_default = module;
export {
  compatibleFileKind,
  index_default as default,
  fingerprint,
  normalizeScanPath
};
//# sourceMappingURL=index.js.map
