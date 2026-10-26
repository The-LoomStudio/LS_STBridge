import type { ClientExtensionModule, ClientRendererContext } from '@loom-studio/extension-sdk'

const module: ClientExtensionModule = {
  activate(context) {
    context.renderers.register({
      id: 'overall-migration-modal',
      name: '整体迁移',
      surface: 'shell.workspace-panel',
      instanceScope: 'workspace',
      adapter: 'direct',
    }, {
      mount(root, rendererContext) {
        return mountMigrationModal(root, context, rendererContext)
      },
    })

    context.commands.register('overall-migration', () => {
      context.renderers.openStandalone('overall-migration-modal', {
        scope: { kind: 'workspace', key: 'workspace' },
      })
    })
  },
}

function mountMigrationModal(
  root: HTMLElement,
  context: Parameters<NonNullable<ClientExtensionModule['activate']>>[0],
  rendererContext: Pick<ClientRendererContext, 'close' | 'signal'>,
) {
  root.replaceChildren()
  root.className = 'stbridge-migration-root'
  const style = document.createElement('style')
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
  `
  root.append(style)
  const modal = document.createElement('div')
  modal.className = 'stbridge-migration-modal'
  modal.innerHTML = `
    <header class="stbridge-migration-header">
      <div><strong>整体迁移</strong><small>扫描 SillyTavern Data 文件夹</small></div>
      <button type="button" data-action="close" aria-label="关闭">×</button>
    </header>
    <main class="stbridge-migration-body">
      <p class="stbridge-migration-status">选择 ST 的 Data 文件夹开始扫描。</p>
      <label>ST Data 路径<input type="text" data-action="path" placeholder="例如 /Users/me/SillyTavern/data/default-user" /></label>
      <button type="button" data-action="choose">开始扫描</button>
      <section class="stbridge-migration-results" hidden></section>
      <button hidden type="button" data-action="import">开始迁移</button>
    </main>
  `
  root.append(modal)
  const pathInput = modal.querySelector('[data-action="path"]') as HTMLInputElement
  const status = modal.querySelector('.stbridge-migration-status') as HTMLElement
  const progressBar = document.createElement('progress')
  progressBar.className = 'stbridge-migration-progress'
  progressBar.max = 1
  progressBar.value = 0
  progressBar.hidden = true
  const results = modal.querySelector('.stbridge-migration-results') as HTMLElement
  modal.querySelector('.stbridge-migration-body')?.insertBefore(progressBar, results)
  const cleanupStatus = document.createElement('p')
  cleanupStatus.className = 'stbridge-migration-status'
  cleanupStatus.setAttribute('role', 'status')
  cleanupStatus.hidden = true
  modal.querySelector('.stbridge-migration-body')?.append(cleanupStatus)
  const importButton = modal.querySelector('[data-action="import"]') as HTMLButtonElement
  const scanButton = modal.querySelector('[data-action="choose"]') as HTMLButtonElement
  let scanned: ScanResult | undefined
  let currentScan: { sessionId?: string; timer?: number } | undefined
  let disposed = false
  let committing = false

  function cancelSession(sessionId: string) {
    void context.rpc.call('sillytavern.importer.migration.cancel', { sessionId }).catch(error => {
      context.logger.warn('ST migration staging cleanup failed', { sessionId, error: String(error) })
      if (!disposed) {
        cleanupStatus.textContent = `旧扫描清理失败：${error instanceof Error ? error.message : String(error)}。旧结果已作废，临时文件可能仍保留。`
        cleanupStatus.hidden = false
      }
    })
  }
  function releaseScan() {
    const previous = currentScan
    currentScan = undefined
    scanned = undefined
    if (previous?.timer !== undefined) window.clearTimeout(previous.timer)
    if (previous?.sessionId) cancelSession(previous.sessionId)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    rendererContext.signal.removeEventListener('abort', dispose)
    releaseScan()
  }
  rendererContext.signal.addEventListener('abort', dispose, { once: true })
  if (rendererContext.signal.aborted) dispose()
  modal.querySelector('[data-action="close"]')?.addEventListener('click', () => {
    dispose()
    rendererContext.close()
  })
  pathInput.addEventListener('input', () => {
    if (disposed || committing) return
    releaseScan()
    status.textContent = '路径已更改，请重新扫描。'
    results.hidden = true
    importButton.hidden = true
    progressBar.hidden = true
  })
  scanButton.addEventListener('click', () => {
    if (disposed || committing) return
    const directory = pathInput.value.trim()
    if (!directory) {
      status.textContent = '请先输入 ST Data 目录路径。'
      return
    }
    releaseScan()
    const scan: NonNullable<typeof currentScan> = {}
    currentScan = scan
    const isCurrent = () => !disposed && currentScan === scan
    const fail = (error: unknown) => {
      if (!isCurrent()) return
      releaseScan()
      status.textContent = `扫描失败：${error instanceof Error ? error.message : String(error)}`
      results.hidden = true
      importButton.hidden = true
      progressBar.hidden = true
    }
    status.textContent = '正在请求后端扫描……'
    importButton.hidden = true
    results.hidden = false
    results.textContent = '后端正在扫描兼容目录……'
    void context.rpc.call<{ sessionId: string; mode?: string }>('sillytavern.importer.migration.start', { directory }).then(async migration => {
      scan.sessionId = migration.sessionId
      if (!isCurrent()) {
        cancelSession(migration.sessionId)
        return
      }
      const inspect = async () => {
        const report = await context.rpc.call<{ counts: { cards: number; chats: number; presets: number; worlds: number }; files: number; bytes: number; scan: { status: string; processed: number; total: number; currentPath: string; error?: string } }>('sillytavern.importer.migration.inspect', { sessionId: migration.sessionId })
        if (!isCurrent()) return
        progressBar.hidden = false
        progressBar.max = Math.max(1, report.scan.total)
        progressBar.value = report.scan.processed
        status.textContent = `正在扫描：已扫描 ${report.scan.processed}/${report.scan.total} · ${report.scan.currentPath || '准备中'} · 已发现 ${report.files} 个文件`
        if (report.scan.status === 'failed') throw new Error(report.scan.error ?? '后端扫描失败')
        if (report.scan.status === 'completed') {
          scanned = { total: report.files, characters: report.counts.cards, chats: report.counts.chats, presets: report.counts.presets, worlds: report.counts.worlds, unknown: 0, items: [], importable: report.files, migrationSessionId: migration.sessionId, ignored: 0 }
          status.textContent = `扫描完成：发现 ${report.files} 个兼容文件`
          progressBar.hidden = true
          results.innerHTML = renderScanResult(scanned)
          importButton.hidden = false
          importButton.disabled = report.files === 0
          return
        }
        scan.timer = window.setTimeout(() => { void inspect().catch(fail) }, 250)
      }
      await inspect()
    }).catch(fail)
  })
  importButton.addEventListener('click', () => {
    if (disposed || committing || !scanned) return
    const sessionId = scanned.migrationSessionId
    // The host owns cleanup once commit starts; closing the panel must not cancel accepted writes.
    currentScan = undefined
    scanned = undefined
    committing = true
    pathInput.disabled = true
    scanButton.disabled = true
    importButton.disabled = true
    status.textContent = '正在迁移……'
    void context.imports.commit(sessionId).then(report => {
      if (disposed) return
      status.textContent = `迁移完成：${report.imported} 项成功，${report.skipped.length} 项跳过。`
      importButton.hidden = true
      results.append(document.createTextNode('后端已完成确认后的正式导入。'))
      if (report.skipped.length) {
        const list = document.createElement('ul')
        for (const item of report.skipped) {
          const row = document.createElement('li')
          row.textContent = `${item.key}：${item.reason}`
          list.append(row)
        }
        results.append(list)
      }
    }).catch(error => {
      if (disposed) return
      status.textContent = `迁移失败：${error instanceof Error ? error.message : String(error)}`
      importButton.hidden = true
    }).finally(() => {
      committing = false
      if (disposed) return
      pathInput.disabled = false
      scanButton.disabled = false
    })
  })
  return { dispose }
}

type ScanItem = { kind: 'card' | 'chat' | 'preset' | 'world'; file: File; path: string }
type ScanResult = {
  total: number
  characters: number
  chats: number
  presets: number
  worlds: number
  unknown: number
  items: ScanItem[]
  importable: number
  migrationSessionId: string
  ignored: number
}

export function normalizeScanPath(path: string, hasDefaultUserRoot: boolean) {
  const normalized = path.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  const marker = '/default-user/'
  const markerIndex = lower.indexOf(marker)
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length)
  if (/^default-user\//i.test(normalized)) return normalized.slice('default-user/'.length)
  return hasDefaultUserRoot ? '' : normalized.replace(/^\.?\//, '')
}

export function compatibleFileKind(path: string): ScanItem['kind'] | undefined {
  const lower = path.toLowerCase()
  if (/(^|\/)characters\/.+\.(png|json)$/.test(lower)) return 'card'
  if (/(^|\/)chats\/.+\/[^/]+\.jsonl$/.test(lower)) return 'chat'
  if (/(^|\/)worlds\/[^/]+\.json$/.test(lower)) return 'world'
  if (/(^|\/)openai settings\/[^/]+\.json$/.test(lower)) return 'preset'
  return undefined
}

export function fingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'artifactId', 'createdAt', 'updatedAt', 'importedAt'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]))
}

function renderScanResult(result: {
  characters: number
  chats: number
  presets: number
  worlds: number
  unknown: number
  ignored?: number
  duplicates?: number
  conflicts?: number
  preparationFailures?: string[]
}) {
  return `
    <div><strong>可迁移内容</strong></div>
    <dl>
      <dt>角色卡</dt><dd>${result.characters}</dd>
      <dt>会话</dt><dd>${result.chats}</dd>
      <dt>Preset</dt><dd>${result.presets}</dd>
      <dt>世界书</dt><dd>${result.worlds}</dd>
      <dt>重复项</dt><dd>${result.duplicates ?? 0}</dd>
      <dt>同名冲突</dt><dd>${result.conflicts ?? 0}</dd>
      <dt>转换失败</dt><dd>${result.preparationFailures?.length ?? 0}</dd>
      <dt>未识别文件</dt><dd>${result.unknown}</dd>
      <dt>已忽略不兼容文件</dt><dd>${result.ignored ?? 0}</dd>
    </dl>
  `
}

export default module
