import './style.css'
import 'katex/dist/katex.min.css'
import '../node_modules/latex.js/dist/css/base.css'
import DOMPurify from 'dompurify'
import renderMathInElement from 'katex/contrib/auto-render'
import { HtmlGenerator, parse } from '../node_modules/latex.js/dist/latex.mjs'
import { marked } from 'marked'
import appIcon from './assets/preditor-icon.png'

type NodeType = 'folder' | 'prompt'
type PromptFormat = 'markdown' | 'latex' | 'todo'

type PromptNode = {
  id: string
  type: NodeType
  title: string
  parentId: string | null
  format?: PromptFormat
  content?: string
  createdAt: number
  updatedAt: number
  history?: PromptHistoryEntry[]
}

type PromptHistoryEntry = {
  timestamp: number
  content: string
}

type TypeTestSession = {
  fullText: string
  paragraphs: string[]
  chunks: string[]
  paragraphCount: number
  sources: string[]
  currentChunkIndex: number
  currentInput: string
  startedAt: number | null
  completedAt: number | null
  totalTypedChars: number
  correctChars: number
}

type LocalAiModelOption = {
  id: string
  label: string
}

const HISTORY_LIMIT = 10
const HISTORY_STEP_BATCH = 100
const HISTORY_IDLE_FLUSH_MS = 10000
const SUPPORTED_LATEX_PACKAGES = [
  'amsmath',
  'xcolor',
  'color',
  'echo',
  'gensymb',
  'graphicx',
  'graphics',
  'hyperref',
  'latexsym',
  'multicol',
  'stix',
  'textcomp',
  'textgreek'
]

type AppState = {
  nodes: PromptNode[]
  selectedId: string | null
  expandedIds: string[]
  viewMode: 'edit' | 'split' | 'preview'
  themeMode: 'light' | 'dark'
  sidebarCollapsed: boolean
  previewWidth: number
  latexPackages: string[]
}

const STORAGE_KEY = 'prema_state_v1'
let persistTimer: number | null = null
let persistQuotaWarned = false
let stateRecoveryNeeded = false

const starterFolderId = crypto.randomUUID()

const defaultState: AppState = {
  nodes: [
    {
      id: starterFolderId,
      type: 'folder',
      title: 'Getting Started',
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    {
      id: crypto.randomUUID(),
      type: 'prompt',
      title: 'Welcome Prompt',
      parentId: starterFolderId,
      format: 'markdown',
      content:
        '# PrEditor\n\n- Create folders and prompts in the tree.\n- Edit your prompt in the center pane.\n- Toggle the markdown preview when needed.\n\n**Tip:** Use clear titles so your prompt tree stays tidy.\n',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ],
  selectedId: null,
  expandedIds: [],
  viewMode: 'split',
  themeMode: 'light',
  sidebarCollapsed: false,
  previewWidth: 420,
  latexPackages: ['amsmath']
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app container')
}

const state = loadState()

app.innerHTML = `
  <header class="app-topbar" data-app-topbar>
    <div class="app-topbar-title" data-app-topbar-title></div>
    <input id="title" type="text" hidden />
    <div class="app-topbar-actions" data-editor-toolbar hidden>
      <button class="btn ghost" data-action="copy-prompt" data-copy-button>Copy</button>
      <button class="btn ghost" data-action="view-history">History</button>
    </div>
    <div class="app-topbar-format">
      <div class="format-toggle">
        <button class="btn format-btn" data-action="set-format" data-format="markdown">Markdown</button>
        <button class="btn format-btn" data-action="set-format" data-format="latex">LaTeX</button>
        <button class="btn format-btn" data-action="set-format" data-format="todo">Todo</button>
      </div>
      <div class="package-toggle" data-package-toggle hidden>
        <div class="package-menu" data-package-menu>
          <button class="btn package-btn" data-action="toggle-package-menu" data-package-summary aria-expanded="false">
            packages
          </button>
          <div class="package-menu-list" data-package-list hidden></div>
        </div>
      </div>
    </div>
  </header>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <img class="brand-image" src="${appIcon}" alt="" />
        </div>
        <div class="brand-text">
          <h1>PrEditor</h1>
        </div>
        <a class="brand-github" href="https://github.com/MohsenDehghankar/preditor" target="_blank" rel="noopener noreferrer" aria-label="Star on GitHub" title="Star on GitHub">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
      </div>
      <div class="sidebar-actions">
        <button class="btn primary" data-action="new-prompt">+ New</button>
        <button class="btn" data-action="new-folder">+ Folder</button>
        <div class="sidebar-overflow">
          <button class="btn ghost sidebar-overflow-btn" data-action="toggle-sidebar-overflow" aria-haspopup="true" aria-expanded="false" aria-label="More actions">⋯</button>
          <div class="sidebar-overflow-menu" data-sidebar-overflow-menu hidden>
            <button class="btn ghost" data-action="open-local-ai">Local AI</button>
            <button class="btn ghost" data-action="open-type-speed">Typing Test</button>
            <button class="btn ghost" data-action="import-state">Import</button>
            <button class="btn ghost" data-action="open-export-confirm">Export</button>
          </div>
        </div>
      </div>
      <div class="sidebar-search">
        <input type="search" data-tree-search placeholder="search..." aria-label="Search files and folders" />
        <button class="search-clear-btn" data-action="clear-tree-search" type="button" aria-label="Clear search" hidden></button>
      </div>
      <div class="tree" data-tree></div>
      <button
        class="sidebar-rail-toggle"
        data-action="toggle-sidebar"
        aria-label="Collapse sidebar"
        title="Toggle sidebar"
      >
        <span class="sidebar-rail-chevron" aria-hidden="true"></span>
      </button>
    </aside>

    <main class="editor">
      <div class="editor-body">
        <div class="editor-search" data-editor-search hidden>
          <input
            class="editor-search-input"
            data-editor-search-input
            type="search"
            placeholder="Find in file..."
            aria-label="Find in editor"
          />
          <span class="editor-search-count" data-editor-search-count>0/0</span>
          <button class="btn ghost editor-search-nav" data-action="editor-search-prev" type="button" aria-label="Previous result">↑</button>
          <button class="btn ghost editor-search-nav" data-action="editor-search-next" type="button" aria-label="Next result">↓</button>
          <button class="btn ghost editor-search-close" data-action="close-editor-search" type="button" aria-label="Close search">Close</button>
        </div>
        <div class="editor-highlight-layer" data-editor-highlight aria-hidden="true"></div>
        <textarea id="content" spellcheck="false" placeholder="Write..."></textarea>
        <div class="empty-state" data-empty hidden>
          <h2>No prompt selected</h2>
          <button class="btn primary" data-action="new-prompt">New prompt</button>
        </div>
      </div>
    </main>

    <div
      class="panel-resizer"
      data-resizer
      role="separator"
      aria-label="Resize editor and preview panels"
      aria-orientation="vertical"
    >
      <span class="panel-resizer-grip" aria-hidden="true"></span>
    </div>

    <section class="preview" data-preview>
      <div class="preview-header">
        <h2 class="preview-title">
          <span class="preview-title-icon-wrap" aria-hidden="true">
            <img class="preview-title-icon" src="${appIcon}" alt="" />
          </span>
          <span>Preview</span>
        </h2>
        <div class="preview-actions"></div>
      </div>
      <div class="preview-body" data-preview-body></div>
    </section>

    <div class="editor-footer">
      <div class="meta" data-meta>
        <span data-created></span>
      </div>
      <div class="footer-toggles">
        <button class="toggle-chip" data-action="toggle-preview" data-toggle-chip="preview" aria-pressed="true">
          <span class="toggle-chip-dot" aria-hidden="true"></span>
          <span class="toggle-chip-label">View</span>
          <span class="toggle-chip-value">Split</span>
        </button>
        <button class="toggle-chip" data-action="toggle-theme" data-toggle-chip="theme" aria-pressed="false">
          <span class="toggle-chip-dot" aria-hidden="true"></span>
          <span class="toggle-chip-label">Theme</span>
          <span class="toggle-chip-value">Light</span>
        </button>
        <button class="btn sync-drive-btn" data-action="sync-drive" aria-label="Sync with Google Drive" title="Sync with Google Drive">
          <span class="sync-drive-icon" aria-hidden="true">
            <img
              class="sync-drive-logo"
              src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png"
              alt=""
              referrerpolicy="no-referrer"
            />
            <span class="sync-drive-status-dot"></span>
          </span>
        </button>
      </div>
    </div>

    <div class="history-panel" data-history hidden>
      <div class="history-card">
        <div class="history-header">
          <div>
            <h2>History</h2>
          </div>
          <button class="btn ghost" data-action="close-history">Close</button>
        </div>
        <div class="history-body" data-history-body></div>
      </div>
    </div>

    <div class="confirm-panel" data-confirm-delete hidden>
      <div class="confirm-card">
        <div class="confirm-header">
          <h2>Delete item?</h2>
        </div>
        <p class="confirm-copy" data-confirm-copy></p>
        <div class="confirm-actions">
          <button class="btn ghost" data-action="cancel-delete">Keep</button>
          <button class="btn danger" data-action="confirm-delete">Delete</button>
        </div>
      </div>
    </div>

    <div class="confirm-panel" data-confirm-export hidden>
      <div class="confirm-card">
        <div class="confirm-header">
          <h2>Export Options</h2>
        </div>
        <p class="confirm-copy">
          Export the whole project as JSON, the selected prompt as text, or a snapshot of the current preview as PNG or PDF.
        </p>
        <div class="confirm-actions export-actions">
          <button class="btn ghost export-actions-cancel" data-action="cancel-export">Keep Editing</button>
          <button class="btn" data-action="export-project-json">Whole Project (.json)</button>
          <button class="btn" data-action="export-file-md">File (.md)</button>
          <button class="btn" data-action="export-file-tex">File (.tex)</button>
          <button class="btn" data-action="export-preview-png">Preview (.png)</button>
          <button class="btn" data-action="export-preview-pdf">Preview (.pdf)</button>
        </div>
      </div>
    </div>

    <div class="confirm-panel" data-drive-options hidden>
      <div class="confirm-card drive-options-card">
        <div class="confirm-header">
          <h2>Google Drive</h2>
        </div>
        <p class="confirm-copy">Choose what to do with your active Drive connection.</p>
        <div class="confirm-actions drive-options-actions">
          <button class="btn ghost" data-action="close-drive-options">Cancel</button>
          <button class="btn" data-action="manual-drive-save">Save Now</button>
          <button class="btn danger" data-action="disconnect-drive">Disconnect</button>
        </div>
      </div>
    </div>

    <div class="type-speed-panel" data-type-speed hidden>
      <div class="type-speed-card">
        <div class="type-speed-header">
          <div>
            <p class="type-speed-kicker">Flow typing test</p>
            <h2>Typing Test!</h2>
          </div>
          <div class="type-speed-header-actions">
            <label class="type-speed-count-control">
              <span>Paragraphs</span>
              <input
                class="type-speed-count-input"
                data-type-speed-count
                type="number"
                min="1"
                max="30"
                step="1"
                value="2"
              />
            </label>
            <button class="btn ghost" data-action="refresh-type-speed">New Text</button>
            <button class="btn ghost" data-action="close-type-speed">Close</button>
          </div>
        </div>
        <div class="type-speed-stats" data-type-speed-stats></div>
        <div class="type-speed-stage">
          <div class="type-speed-lane">
            <div class="type-speed-row type-speed-row-target" data-type-speed-target></div>
            <textarea
              class="type-speed-input"
              data-type-speed-input
              rows="1"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              placeholder="Start typing the highlighted line..."
            ></textarea>
          </div>
          <div class="type-speed-status" data-type-speed-status></div>
        </div>
        <div class="type-speed-text" data-type-speed-text></div>
      </div>
    </div>

    <div class="local-ai-panel" data-local-ai hidden>
      <div class="local-ai-card">
        <div class="local-ai-header">
          <h2>Local AI (WebLLM)</h2>
          <button class="btn ghost" data-action="close-local-ai">Close</button>
        </div>
        <p class="local-ai-note" data-local-ai-status>Runs on-device. First load may take time to download model weights.</p>
        <div class="local-ai-progress" data-local-ai-progress hidden>
          <div class="local-ai-progress-track">
            <span class="local-ai-progress-fill" data-local-ai-progress-fill></span>
          </div>
          <span class="local-ai-progress-label" data-local-ai-progress-label>0%</span>
        </div>
        <label class="local-ai-model-field">
          <span>Model</span>
          <select class="local-ai-model-select" data-local-ai-model></select>
        </label>
        <p class="local-ai-model-list" data-local-ai-model-list></p>
        <div class="local-ai-body">
          <textarea
            class="local-ai-input"
            data-local-ai-input
            rows="4"
            placeholder="What should Local AI do with this file?"
          ></textarea>
          <div class="local-ai-actions">
            <button class="btn" data-action="run-local-ai">Run Local AI</button>
            <button class="btn ghost" data-action="cancel-local-ai" data-local-ai-cancel disabled>Cancel</button>
            <button class="btn ghost" data-action="insert-local-ai" data-local-ai-insert disabled>Insert into file</button>
          </div>
          <div class="local-ai-output" data-local-ai-output></div>
        </div>
      </div>
    </div>

    <input type="file" accept="application/json,.json" data-import-input hidden />
  </div>
`

const tree = app.querySelector<HTMLDivElement>('[data-tree]')!
const titleInput = app.querySelector<HTMLInputElement>('#title')!
const contentInput = app.querySelector<HTMLTextAreaElement>('#content')!
const emptyState = app.querySelector<HTMLDivElement>('[data-empty]')!
const createdLabel = app.querySelector<HTMLSpanElement>('[data-created]')!
const historyButton = app.querySelector<HTMLButtonElement>('[data-action="view-history"]')!
const appShell = app.querySelector<HTMLDivElement>('.app-shell')!
const copyButtons = app.querySelectorAll<HTMLButtonElement>('[data-copy-button]')
const localAiButtons = app.querySelectorAll<HTMLButtonElement>('[data-action="open-local-ai"]')
const previewToggleChip = app.querySelector<HTMLButtonElement>('[data-toggle-chip="preview"]')!
const formatButtons = app.querySelectorAll<HTMLButtonElement>('[data-action="set-format"]')
const panelResizer = app.querySelector<HTMLDivElement>('[data-resizer]')!
const previewBody = app.querySelector<HTMLDivElement>('[data-preview-body]')!
const previewToggles = app.querySelectorAll<HTMLButtonElement>('[data-action="toggle-preview"]')
const themeToggle = app.querySelector<HTMLButtonElement>('[data-action="toggle-theme"]')!
const editorBody = app.querySelector<HTMLDivElement>('.editor-body')!
const packageToggle = app.querySelector<HTMLDivElement>('[data-package-toggle]')!
const packageMenu = app.querySelector<HTMLDivElement>('[data-package-menu]')!
const packageSummary = app.querySelector<HTMLButtonElement>('[data-package-summary]')!
const packageList = app.querySelector<HTMLDivElement>('[data-package-list]')!
const historyPanel = app.querySelector<HTMLDivElement>('[data-history]')!
const historyBody = app.querySelector<HTMLDivElement>('[data-history-body]')!
const editorSearchBar = app.querySelector<HTMLDivElement>('[data-editor-search]')!
const editorSearchInput = app.querySelector<HTMLInputElement>('[data-editor-search-input]')!
const editorSearchCount = app.querySelector<HTMLSpanElement>('[data-editor-search-count]')!
const editorHighlightLayer = app.querySelector<HTMLDivElement>('[data-editor-highlight]')!
const confirmDeletePanel = app.querySelector<HTMLDivElement>('[data-confirm-delete]')!
const confirmDeleteCopy = app.querySelector<HTMLParagraphElement>('[data-confirm-copy]')!
const confirmExportPanel = app.querySelector<HTMLDivElement>('[data-confirm-export]')!
const sidebarOverflowMenu = app.querySelector<HTMLDivElement>('[data-sidebar-overflow-menu]')!
const sidebarOverflowBtn = app.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar-overflow"]')!
const editorToolbar = app.querySelector<HTMLDivElement>('[data-editor-toolbar]')!
const topbarTitleLabel = app.querySelector<HTMLDivElement>('[data-app-topbar-title]')!
const typeSpeedPanel = app.querySelector<HTMLDivElement>('[data-type-speed]')!
const typeSpeedStats = app.querySelector<HTMLDivElement>('[data-type-speed-stats]')!
const typeSpeedTarget = app.querySelector<HTMLDivElement>('[data-type-speed-target]')!
const typeSpeedInput = app.querySelector<HTMLTextAreaElement>('[data-type-speed-input]')!
const typeSpeedCountInput = app.querySelector<HTMLInputElement>('[data-type-speed-count]')!
const typeSpeedStatus = app.querySelector<HTMLDivElement>('[data-type-speed-status]')!
const typeSpeedText = app.querySelector<HTMLDivElement>('[data-type-speed-text]')!
const localAiPanel = app.querySelector<HTMLDivElement>('[data-local-ai]')!
const localAiInput = app.querySelector<HTMLTextAreaElement>('[data-local-ai-input]')!
const localAiStatus = app.querySelector<HTMLParagraphElement>('[data-local-ai-status]')!
const localAiModelSelect = app.querySelector<HTMLSelectElement>('[data-local-ai-model]')!
const localAiModelList = app.querySelector<HTMLParagraphElement>('[data-local-ai-model-list]')!
const localAiProgress = app.querySelector<HTMLDivElement>('[data-local-ai-progress]')!
const localAiProgressFill = app.querySelector<HTMLSpanElement>('[data-local-ai-progress-fill]')!
const localAiProgressLabel = app.querySelector<HTMLSpanElement>('[data-local-ai-progress-label]')!
const localAiOutput = app.querySelector<HTMLDivElement>('[data-local-ai-output]')!
const localAiCancelButton = app.querySelector<HTMLButtonElement>('[data-local-ai-cancel]')!
const localAiInsertButton = app.querySelector<HTMLButtonElement>('[data-local-ai-insert]')!
const importInput = app.querySelector<HTMLInputElement>('[data-import-input]')!
const treeSearchInput = app.querySelector<HTMLInputElement>('[data-tree-search]')!
const clearSearchButton = app.querySelector<HTMLButtonElement>('[data-action="clear-tree-search"]')!
const syncDriveButton = app.querySelector<HTMLButtonElement>('[data-action="sync-drive"]')!
const driveOptionsPanel = app.querySelector<HTMLDivElement>('[data-drive-options]')!

let historyTimer: number | null = null
let copyFeedbackTimer: number | null = null
let activeCopyButton: HTMLButtonElement | null = null
let pendingDeleteId: string | null = null
const pendingHistorySteps = new Map<string, number>()
let treeSearchQuery = ''
let typeTestSession: TypeTestSession | null = null
let typeSpeedParagraphCount = 2
let typeSpeedLoading = false
let typeSpeedError = ''
let typeSpeedRequestId = 0
let editorSearchQuery = ''
let editorSearchMatches: Array<{ start: number; end: number }> = []
let editorSearchActiveMatch = -1
const LOCAL_AI_MODELS: LocalAiModelOption[] = [
  { id: 'Qwen2-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2 0.5B (smallest, fastest)' },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 1B (small + better quality)' },
  { id: 'Qwen2-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2 1.5B (still lightweight)' }
]
let localAiEngine: any | null = null
let localAiResponse = ''
let localAiRunning = false
let localAiLoadedModelId = ''
let localAiSelectedModelId = LOCAL_AI_MODELS[0].id
let localAiLoadingModelId = ''
let localAiCancelRequested = false
let localAiRunId = 0
let googleAccessToken: string | null = null
let googleTokenExpiresAt = 0
let googleTokenClient: { requestAccessToken: (options?: Record<string, unknown>) => void } | null = null
let googleDriveFolderId: string | null = null
let driveSyncIntervalId: number | null = null
let driveSyncInFlight = false
let driveSyncEnabled = false

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GOOGLE_DRIVE_FOLDER_NAME = 'peditor check points'
const GOOGLE_DRIVE_CLIENT_ID_KEY = 'preditor_google_client_id'
const GOOGLE_DRIVE_FOLDER_ID_KEY = 'preditor_google_drive_folder_id'
const GOOGLE_DRIVE_ENABLED_KEY = 'preditor_google_drive_enabled'
const GOOGLE_DRIVE_TOKEN_KEY = 'preditor_google_drive_token'
const GOOGLE_DRIVE_DEFAULT_CLIENT_ID =
  '305614712721-5841fprrsct5glbd01amtrm3786o1imc.apps.googleusercontent.com'

syncAppIcon()
packageList.innerHTML = SUPPORTED_LATEX_PACKAGES
  .map(
    (packageName) => `
      <label class="package-option">
        <input type="checkbox" data-package-checkbox value="${packageName}" />
        <span>${packageName}</span>
      </label>
    `
  )
  .join('')

marked.setOptions({
  gfm: true,
  breaks: true
})

refreshLocalAiModelOptions()
localAiModelList.textContent = `Possible models: ${LOCAL_AI_MODELS.map((model) => model.label).join(' | ')}`

localAiModelSelect.addEventListener('change', () => {
  localAiSelectedModelId = localAiModelSelect.value
  localAiStatus.textContent = `Selected model: ${localAiModelSelect.selectedOptions[0]?.textContent ?? localAiSelectedModelId}`
})

function refreshLocalAiModelOptions() {
  const previousSelection = localAiModelSelect.value || localAiSelectedModelId
  localAiModelSelect.innerHTML = LOCAL_AI_MODELS.map((model) => {
    const suffix =
      model.id === localAiLoadingModelId
        ? ' (Loading...)'
        : model.id === localAiLoadedModelId && localAiEngine
          ? ' (Loaded)'
          : ' (Not loaded)'
    return `<option value="${model.id}">${escapeHtml(model.label + suffix)}</option>`
  }).join('')
  localAiModelSelect.value = LOCAL_AI_MODELS.some((model) => model.id === previousSelection)
    ? previousSelection
    : localAiSelectedModelId
}

function syncAppIcon() {
  let favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.rel = 'icon'
    document.head.appendChild(favicon)
  }
  favicon.type = 'image/png'
  favicon.href = appIcon
}

syncSearchClearButton()
initializeState()
initializePreviewResize()
setupDriveSync()
try {
  render()
} catch (error) {
  console.error('Initial render failed.', error)
}

window.addEventListener('beforeunload', () => {
  persistStateNow()
})
window.addEventListener('pagehide', () => {
  persistStateNow()
})

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const actionElement = target.closest<HTMLElement>('[data-action]')
  const action = actionElement?.dataset.action
  if (!action) return

  switch (action) {
    case 'new-prompt':
      createNode('prompt')
      break
    case 'new-folder':
      createNode('folder')
      break
    case 'set-format':
      setSelectedFormat(actionElement?.dataset.format as PromptFormat | undefined)
      break
    case 'toggle-package-menu':
      if (packageList.hidden) {
        openPackageMenu()
      } else {
        closePackageMenu()
      }
      break
    case 'copy-prompt':
      void copySelectedPrompt(actionElement as HTMLButtonElement | null)
      break
    case 'open-type-speed':
      closeSidebarOverflow()
      void openTypeSpeed()
      break
    case 'open-local-ai':
      closeSidebarOverflow()
      openLocalAi()
      break
    case 'close-local-ai':
      void closeLocalAi()
      break
    case 'run-local-ai':
      void runLocalAi()
      break
    case 'cancel-local-ai':
      void cancelLocalAi()
      break
    case 'insert-local-ai':
      insertLocalAiOutput()
      break
    case 'close-type-speed':
      closeTypeSpeed()
      break
    case 'refresh-type-speed':
      void resetTypeSpeed()
      break
    case 'toggle-preview':
      state.viewMode = nextViewMode(state.viewMode)
      persistState()
      render()
      break
    case 'toggle-theme':
      state.themeMode = state.themeMode === 'dark' ? 'light' : 'dark'
      applyTheme(state.themeMode)
      persistState()
      render()
      break
    case 'view-history':
      openHistory()
      break
    case 'close-history':
      closeHistory()
      break
    case 'create-from-history':
      createPromptFromHistory(actionElement?.dataset.historyIndex)
      break
    case 'cancel-delete':
      closeDeleteConfirm()
      break
    case 'confirm-delete':
      confirmDelete()
      break
    case 'open-export-confirm':
      confirmExportPanel.hidden = false
      closeSidebarOverflow()
      break
    case 'cancel-export':
      confirmExportPanel.hidden = true
      break
    case 'export-project-json':
      confirmExportPanel.hidden = true
      exportState()
      break
    case 'export-file-md':
      confirmExportPanel.hidden = true
      exportSelectedPromptFile('md')
      break
    case 'export-file-tex':
      confirmExportPanel.hidden = true
      exportSelectedPromptFile('tex')
      break
    case 'export-preview-png':
      void exportPreviewAsPng()
      break
    case 'export-preview-pdf':
      void exportPreviewAsPdf()
      break
    case 'toggle-sidebar':
      state.sidebarCollapsed = !state.sidebarCollapsed
      persistState()
      render()
      break
    case 'clear-tree-search':
      treeSearchQuery = ''
      treeSearchInput.value = ''
      syncSearchClearButton()
      renderTree()
      treeSearchInput.focus()
      break
    case 'editor-search-prev':
      stepEditorSearch(-1)
      break
    case 'editor-search-next':
      stepEditorSearch(1)
      break
    case 'close-editor-search':
      closeEditorSearch()
      contentInput.focus()
      break
    case 'import-state':
      importInput.click()
      closeSidebarOverflow()
      break
    case 'toggle-sidebar-overflow':
      toggleSidebarOverflow()
      break
    case 'sync-drive':
      if (driveSyncEnabled) {
        driveOptionsPanel.hidden = false
      } else {
        void handleDriveSyncClick()
      }
      break
    case 'close-drive-options':
      driveOptionsPanel.hidden = true
      break
    case 'manual-drive-save':
      driveOptionsPanel.hidden = true
      void handleDriveSyncClick()
      break
    case 'disconnect-drive':
      void disconnectDrive()
      break
    case 'toggle-expand':
      toggleFolder(actionElement?.dataset.id)
      break
    case 'delete-node':
      openDeleteConfirm(actionElement?.dataset.id)
      break
    case 'select':
      if (
        actionElement?.dataset.id &&
        actionElement.dataset.id === state.selectedId &&
        target.classList.contains('tree-name')
      ) {
        startInlineRename(actionElement.dataset.id, target as HTMLElement)
      } else {
        selectNode(actionElement?.dataset.id)
      }
      break
    default:
      break
  }
})

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    importState(text)
  } catch {
    alert('Could not import this file.')
  } finally {
    importInput.value = ''
  }
})

treeSearchInput.addEventListener('input', () => {
  treeSearchQuery = treeSearchInput.value.trim().toLowerCase()
  syncSearchClearButton()
  renderTree()
})

packageList.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement
  if (!target.matches('[data-package-checkbox]')) return
  toggleLatexPackage(target.value)
})

document.addEventListener('click', (event) => {
  const target = event.target as Node
  if (!packageMenu.contains(target)) {
    closePackageMenu()
  }
  const overflowWrap = sidebarOverflowMenu.parentElement
  if (overflowWrap && !overflowWrap.contains(target)) {
    closeSidebarOverflow()
  }
})

historyPanel.addEventListener('click', (event) => {
  if (event.target === historyPanel) {
    closeHistory()
  }
})

confirmDeletePanel.addEventListener('click', (event) => {
  if (event.target === confirmDeletePanel) {
    closeDeleteConfirm()
  }
})

confirmExportPanel.addEventListener('click', (event) => {
  if (event.target === confirmExportPanel) {
    confirmExportPanel.hidden = true
  }
})

driveOptionsPanel.addEventListener('click', (event) => {
  if (event.target === driveOptionsPanel) {
    driveOptionsPanel.hidden = true
  }
})

typeSpeedPanel.addEventListener('click', (event) => {
  if (event.target === typeSpeedPanel) {
    closeTypeSpeed()
  }
})

localAiPanel.addEventListener('click', (event) => {
  if (event.target === localAiPanel) {
    void closeLocalAi()
  }
})

typeSpeedInput.addEventListener('input', () => {
  handleTypeSpeedInput()
})

editorSearchInput.addEventListener('input', () => {
  editorSearchQuery = editorSearchInput.value
  refreshEditorSearch()
})

editorSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    stepEditorSearch(event.shiftKey ? -1 : 1)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeEditorSearch()
    contentInput.focus()
  }
})

typeSpeedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeTypeSpeed()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    return
  }

  if (event.key === ' ' && typeTestSession) {
    const targetChunk = typeTestSession.chunks[typeTestSession.currentChunkIndex] ?? ''
    if (targetChunk && typeSpeedInput.value.length >= targetChunk.length) {
      event.preventDefault()
      advanceTypeSpeedChunk()
    }
  }
})

typeSpeedCountInput.addEventListener('input', () => {
  typeSpeedParagraphCount = normalizeTypeSpeedParagraphCount(Number(typeSpeedCountInput.value))
  typeSpeedCountInput.value = String(typeSpeedParagraphCount)
})

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    confirmExportPanel.hidden = true
    exportState()
    return
  }

  if (event.key === 'Escape' && !typeSpeedPanel.hidden) {
    closeTypeSpeed()
    return
  }
  if (event.key === 'Escape' && !localAiPanel.hidden) {
    void closeLocalAi()
    return
  }
  if (event.key === 'Escape' && !driveOptionsPanel.hidden) {
    driveOptionsPanel.hidden = true
    return
  }
  if (event.key === 'Escape' && !editorSearchBar.hidden) {
    closeEditorSearch()
    contentInput.focus()
  }
})

contentInput.addEventListener('input', () => {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return
  node.content = contentInput.value
  node.updatedAt = Date.now()
  scheduleHistorySnapshot(node)
  persistState()
  syncEditorHighlightLayer()
  refreshEditorSearch()
  renderPreview(node)
  renderMeta(node)
})

contentInput.addEventListener('scroll', () => {
  editorHighlightLayer.scrollTop = contentInput.scrollTop
  editorHighlightLayer.scrollLeft = contentInput.scrollLeft
})

contentInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openEditorSearch()
    return
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x') {
    if (contentInput.selectionStart !== contentInput.selectionEnd) return

    selectCurrentEditorLine()
    return
  }

  if ((event.metaKey || event.ctrlKey) && event.key === '/') {
    event.preventDefault()
    toggleSelectedLineComments()
    return
  }

  if (event.key !== 'Tab') return

  event.preventDefault()

  const start = contentInput.selectionStart
  const end = contentInput.selectionEnd
  if (event.shiftKey) {
    const value = contentInput.value
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const lineEndIndex = value.indexOf('\n', end)
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
    const selectedBlock = value.slice(lineStart, lineEnd)
    const lines = selectedBlock.split('\n')

    let removedCount = 0
    const nextLines = lines.map((line) => {
      if (line.startsWith('\t')) {
        removedCount += 1
        return line.slice(1)
      }
      if (line.startsWith('  ')) {
        removedCount += 1
        return line.slice(2)
      }
      if (line.startsWith(' ')) {
        removedCount += 1
        return line.slice(1)
      }
      return line
    })

    const nextBlock = nextLines.join('\n')
    contentInput.value = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`
    contentInput.selectionStart = lineStart
    contentInput.selectionEnd = lineStart + nextBlock.length
    if (removedCount > 0) {
      contentInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return
  }

  const nextValue = `${contentInput.value.slice(0, start)}\t${contentInput.value.slice(end)}`
  contentInput.value = nextValue
  contentInput.selectionStart = start + 1
  contentInput.selectionEnd = start + 1
  contentInput.dispatchEvent(new Event('input', { bubbles: true }))
})

function selectCurrentEditorLine() {
  const value = contentInput.value
  const cursor = contentInput.selectionStart
  const lineStart = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const lineBreakIndex = value.indexOf('\n', cursor)
  const lineEnd = lineBreakIndex === -1 ? value.length : lineBreakIndex
  const hasTrailingLineBreak = lineBreakIndex !== -1
  const cutEnd = hasTrailingLineBreak ? lineEnd + 1 : lineEnd
  contentInput.setSelectionRange(lineStart, cutEnd)
}

titleInput.addEventListener('input', () => {
  const node = getSelectedNode()
  if (!node) return
  node.title = titleInput.value
  node.updatedAt = Date.now()
  persistState()
  updateSelectedTreeLabel(node.title)
  renderMeta(node)
})

function initializeState() {
  enforceHierarchy()
  const selectedExists = state.selectedId
    ? state.nodes.some((node) => node.id === state.selectedId)
    : false
  if (!state.selectedId || !selectedExists) {
    const firstPrompt = state.nodes.find((node) => node.type === 'prompt')
    state.selectedId = firstPrompt?.id ?? null
  }
  state.nodes.forEach((node) => {
    if (node.type === 'prompt') {
      node.format = node.format ?? 'markdown'
      const history = trimHistory(node.history ?? [])
      if (!history.length && node.content) {
        node.history = [{ timestamp: node.createdAt, content: node.content }]
      } else {
        node.history = history
      }
    }
  })
  if (!state.expandedIds.length) {
    state.expandedIds = state.nodes.filter((node) => node.type === 'folder').map((node) => node.id)
  }
  state.latexPackages = normalizeLatexPackages(state.latexPackages)
  state.viewMode = normalizeViewMode(state.viewMode)
  if (stateRecoveryNeeded) {
    persistStateNow()
  } else {
    persistState()
  }
}

function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return structuredClone(defaultState)
  try {
    const parsed = JSON.parse(raw) as Partial<AppState> & { showPreview?: boolean }
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
      backupCorruptState(raw)
      stateRecoveryNeeded = true
      return structuredClone(defaultState)
    }
    const mergedState: AppState = { ...structuredClone(defaultState), ...parsed }
    if (!('viewMode' in parsed) && typeof parsed.showPreview === 'boolean') {
      mergedState.viewMode = parsed.showPreview ? 'split' : 'edit'
    }
    mergedState.viewMode = normalizeViewMode(mergedState.viewMode)
    return mergedState
  } catch {
    backupCorruptState(raw)
    stateRecoveryNeeded = true
    return structuredClone(defaultState)
  }
}

function backupCorruptState(raw: string) {
  try {
    const key = `${STORAGE_KEY}.broken.${Date.now()}`
    localStorage.setItem(key, raw)
  } catch {
    // Ignore backup failures (likely quota); skip silently.
  }
}

function persistState() {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistStateNow()
  }, 500)
}

function persistStateNow() {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    if (!persistQuotaWarned) {
      persistQuotaWarned = true
      console.error('Failed to persist state (likely localStorage quota exceeded).', error)
      alert('Storage limit reached. Recent edits may not be saved locally. Consider exporting or trimming history.')
    }
  }
}

function setupDriveSync() {
  googleDriveFolderId = localStorage.getItem(GOOGLE_DRIVE_FOLDER_ID_KEY)
  updateDriveSyncButton('Connect Google Drive')
  updateDriveConnectedUi(false)
  if (driveSyncIntervalId !== null) {
    window.clearInterval(driveSyncIntervalId)
  }
  driveSyncIntervalId = window.setInterval(() => {
    if (!driveSyncEnabled || driveSyncInFlight) return
    void syncCheckpointToDrive({ source: 'auto' })
  }, 60000)
  loadCachedGoogleToken()
  if (localStorage.getItem(GOOGLE_DRIVE_ENABLED_KEY) === '1') {
    void restoreDriveSession()
  }
}

function loadCachedGoogleToken() {
  try {
    const raw = localStorage.getItem(GOOGLE_DRIVE_TOKEN_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { access_token?: string; expires_at?: number }
    if (parsed.access_token && parsed.expires_at && Date.now() < parsed.expires_at - 5000) {
      googleAccessToken = parsed.access_token
      googleTokenExpiresAt = parsed.expires_at
    } else {
      localStorage.removeItem(GOOGLE_DRIVE_TOKEN_KEY)
    }
  } catch {
    localStorage.removeItem(GOOGLE_DRIVE_TOKEN_KEY)
  }
}

function saveCachedGoogleToken() {
  if (!googleAccessToken) return
  try {
    localStorage.setItem(
      GOOGLE_DRIVE_TOKEN_KEY,
      JSON.stringify({ access_token: googleAccessToken, expires_at: googleTokenExpiresAt })
    )
  } catch {
    // Ignore quota issues for the token cache.
  }
}

async function restoreDriveSession() {
  if (!googleAccessToken || Date.now() >= googleTokenExpiresAt - 5000) {
    driveSyncEnabled = false
    updateDriveConnectedUi(false)
    return
  }
  driveSyncEnabled = true
  updateDriveConnectedUi(true)
  updateDriveSyncButton('Drive Sync On')
  if (stateRecoveryNeeded) {
    try {
      await restoreLatestDriveCheckpoint()
    } catch {
      // Recovery best-effort; ignore failures so we don't trigger UI.
    }
  }
}

async function restoreLatestDriveCheckpoint() {
  try {
    const folderId = await ensureDriveCheckpointFolder()
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/json'`)
    const list = await driveApiGet<{ files?: Array<{ id: string; name: string }> }>(
      `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&fields=files(id,name)&pageSize=1`
    )
    const newest = list.files?.[0]
    if (!newest) return
    const fileResponse = await driveApiRaw(
      `https://www.googleapis.com/drive/v3/files/${newest.id}?alt=media`,
      { method: 'GET' }
    )
    const text = await fileResponse.text()
    importState(text)
    stateRecoveryNeeded = false
    console.info(`Recovered state from Drive checkpoint: ${newest.name}`)
  } catch (error) {
    console.error('Drive auto-recovery failed.', error)
  }
}

async function handleDriveSyncClick() {
  if (driveSyncInFlight) return
  try {
    await ensureDriveAuthorized(true)
    await syncCheckpointToDrive({ source: 'manual' })
  } catch (error) {
    driveSyncEnabled = false
    updateDriveConnectedUi(false)
    const message = error instanceof Error ? error.message : 'Google Drive sync failed.'
    alert(message)
    updateDriveSyncButton('Drive Sync')
  }
}

async function ensureDriveAuthorized(interactive: boolean) {
  if (googleAccessToken && Date.now() < googleTokenExpiresAt - 5000) {
    return
  }
  await loadGoogleIdentityScript()
  const clientId = getGoogleClientId(interactive)
  if (!clientId) {
    throw new Error('Google client ID is required to enable Drive sync.')
  }
  const google = (window as unknown as { google?: any }).google
  if (!google?.accounts?.oauth2?.initTokenClient) {
    throw new Error('Google OAuth library did not load. Check your network and try again.')
  }
  await requestGoogleAccessToken(clientId, interactive)
}

function getGoogleClientId(interactive: boolean) {
  const cached = localStorage.getItem(GOOGLE_DRIVE_CLIENT_ID_KEY)?.trim() ?? ''
  if (cached) return cached
  if (GOOGLE_DRIVE_DEFAULT_CLIENT_ID) return GOOGLE_DRIVE_DEFAULT_CLIENT_ID
  if (!interactive) return ''
  const input = window.prompt(
    'Enter your Google OAuth Client ID (Web application) to enable Drive sync:',
    ''
  )
  const clientId = input?.trim() ?? ''
  if (!clientId) return ''
  localStorage.setItem(GOOGLE_DRIVE_CLIENT_ID_KEY, clientId)
  return clientId
}

async function requestGoogleAccessToken(clientId: string, interactive: boolean) {
  const google = (window as unknown as { google?: any }).google
  const tokenResponse = await new Promise<{ access_token?: string; expires_in?: number; error?: string; type?: string }>(
    (resolve) => {
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: (response: { access_token?: string; expires_in?: number; error?: string }) => resolve(response),
        error_callback: (error: { type?: string; message?: string }) =>
          resolve({ error: error?.type ?? 'auth_error' })
      })
      googleTokenClient.requestAccessToken({
        prompt: interactive ? '' : 'none'
      })
    }
  )
  if (!tokenResponse.access_token || tokenResponse.error) {
    throw new Error('Google authorization was cancelled or failed.')
  }
  googleAccessToken = tokenResponse.access_token
  const expiresIn = tokenResponse.expires_in ?? 3600
  googleTokenExpiresAt = Date.now() + expiresIn * 1000
  saveCachedGoogleToken()
}

async function loadGoogleIdentityScript() {
  const hasGoogle = Boolean((window as unknown as { google?: unknown }).google)
  if (hasGoogle) return
  const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]')
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Google OAuth script.')), {
        once: true
      })
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Failed to load Google OAuth script.')), {
      once: true
    })
    document.head.appendChild(script)
  })
}

async function syncCheckpointToDrive(options: { source: 'manual' | 'auto' }) {
  if (!googleAccessToken) return
  driveSyncInFlight = true
  updateDriveSyncButton(options.source === 'manual' ? 'Syncing...' : 'Auto sync...')
  try {
    const folderId = await ensureDriveCheckpointFolder()
    googleDriveFolderId = folderId
    try {
      await uploadDriveCheckpoint(folderId)
    } catch (error) {
      if (!isDriveMissingFolderError(error)) {
        throw error
      }
      // Folder might have been deleted externally; recreate once and retry.
      googleDriveFolderId = null
      localStorage.removeItem(GOOGLE_DRIVE_FOLDER_ID_KEY)
      const recreatedFolderId = await ensureDriveCheckpointFolder()
      googleDriveFolderId = recreatedFolderId
      await uploadDriveCheckpoint(recreatedFolderId)
    }
    await trimOldDriveCheckpoints(folderId, 10)
    driveSyncEnabled = true
    localStorage.setItem(GOOGLE_DRIVE_ENABLED_KEY, '1')
    updateDriveConnectedUi(true)
    updateDriveSyncButton('Synced')
    window.setTimeout(() => {
      if (driveSyncEnabled && !driveSyncInFlight) {
        updateDriveSyncButton('Drive Sync On')
      }
    }, 1200)
  } finally {
    driveSyncInFlight = false
    if (driveSyncEnabled) {
      updateDriveConnectedUi(true)
    }
  }
}

function isDriveMissingFolderError(error: unknown) {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('404') ||
    message.includes('file not found') ||
    message.includes('not found') ||
    message.includes('invalid parent')
  )
}

function updateDriveSyncButton(label: string) {
  syncDriveButton.title = label
  syncDriveButton.setAttribute('aria-label', label)
  syncDriveButton.disabled = driveSyncInFlight
  syncDriveButton.classList.toggle('is-syncing', driveSyncInFlight)
}

function updateDriveConnectedUi(connected: boolean) {
  syncDriveButton.classList.toggle('is-connected', connected)
  syncDriveButton.classList.toggle('is-disconnected', !connected)
  if (!connected) {
    driveOptionsPanel.hidden = true
    updateDriveSyncButton('Connect Google Drive')
  } else if (!driveSyncInFlight) {
    updateDriveSyncButton('Drive Sync On')
  }
}

async function disconnectDrive() {
  if (driveSyncInFlight) return
  driveOptionsPanel.hidden = true
  try {
    const google = (window as unknown as { google?: any }).google
    if (google?.accounts?.oauth2?.revoke && googleAccessToken) {
      await new Promise<void>((resolve) => {
        google.accounts.oauth2.revoke(googleAccessToken, () => resolve())
      })
    }
  } finally {
    driveSyncEnabled = false
    googleAccessToken = null
    googleTokenExpiresAt = 0
    googleDriveFolderId = null
    localStorage.removeItem(GOOGLE_DRIVE_ENABLED_KEY)
    localStorage.removeItem(GOOGLE_DRIVE_TOKEN_KEY)
    updateDriveConnectedUi(false)
  }
}

function buildCheckpointPayload() {
  return {
    exportedAt: new Date().toISOString(),
    app: 'PrEditor',
    version: 1,
    state
  }
}

async function ensureDriveCheckpointFolder() {
  if (googleDriveFolderId) return googleDriveFolderId
  const createResponse = await driveApiPost<{ id: string }>('https://www.googleapis.com/drive/v3/files', {
    name: GOOGLE_DRIVE_FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder'
  })
  localStorage.setItem(GOOGLE_DRIVE_FOLDER_ID_KEY, createResponse.id)
  return createResponse.id
}

async function uploadDriveCheckpoint(folderId: string) {
  const metadata = {
    name: `checkpoint-${getExportTimestamp()}.json`,
    mimeType: 'application/json',
    parents: [folderId]
  }
  const payload = JSON.stringify(buildCheckpointPayload(), null, 2)
  const boundary = `preditor-sync-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${payload}\r\n` +
    `--${boundary}--`

  await driveApiRaw('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  })
}

async function trimOldDriveCheckpoints(folderId: string, keep: number) {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/json'`)
  const response = await driveApiGet<{
    files?: Array<{ id: string }>
  }>(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&fields=files(id)&pageSize=100`
  )
  const overflow = (response.files ?? []).slice(keep)
  await Promise.all(
    overflow.map(async (file) => {
      await driveApiRaw(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
        method: 'DELETE'
      })
    })
  )
}

async function driveApiGet<T>(url: string) {
  const response = await driveApiRaw(url, { method: 'GET' })
  return (await response.json()) as T
}

async function driveApiPost<T>(url: string, payload: unknown) {
  const response = await driveApiRaw(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  return (await response.json()) as T
}

async function driveApiRaw(url: string, init: RequestInit) {
  if (!googleAccessToken) {
    throw new Error('Drive sync is not authenticated.')
  }
  const headers = new Headers(init.headers ?? {})
  headers.set('Authorization', `Bearer ${googleAccessToken}`)
  const response = await fetch(url, { ...init, headers })
  if (response.status === 401 || response.status === 403) {
    googleAccessToken = null
    throw new Error('Google Drive authorization expired. Click Drive Sync again.')
  }
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`Google Drive API error (${response.status}). ${message}`.trim())
  }
  return response
}

function initializePreviewResize() {
  panelResizer.addEventListener('pointerdown', (event) => {
    if (state.viewMode !== 'split' || window.innerWidth <= 1100) return

    event.preventDefault()
    const pointerId = event.pointerId
    panelResizer.setPointerCapture(pointerId)
    document.body.classList.add('is-resizing')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = window.innerWidth - moveEvent.clientX
      state.previewWidth = clampPreviewWidth(nextWidth)
      appShell.style.setProperty('--preview-width', `${state.previewWidth}px`)
    }

    const handlePointerUp = () => {
      if (panelResizer.hasPointerCapture(pointerId)) {
        panelResizer.releasePointerCapture(pointerId)
      }
      document.body.classList.remove('is-resizing')
      persistState()
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  })

  window.addEventListener('resize', () => {
    const nextWidth = clampPreviewWidth(state.previewWidth)
    appShell.style.setProperty('--preview-width', `${nextWidth}px`)
    if (nextWidth !== state.previewWidth) {
      state.previewWidth = nextWidth
      persistState()
    }
  })
}

function clampPreviewWidth(width: number) {
  const sidebarWidth = state.sidebarCollapsed ? 64 : 280
  const minWidth = 280
  const maxWidth = Math.max(minWidth, window.innerWidth - sidebarWidth - 260)
  return Math.min(Math.max(Math.round(width), minWidth), maxWidth)
}

function render() {
  const isSplitView = state.viewMode === 'split'
  app.classList.toggle('preview-hidden', state.viewMode === 'edit')
  app.classList.toggle('editor-hidden', state.viewMode === 'preview')
  app.classList.toggle('sidebar-collapsed', state.sidebarCollapsed)
  appShell.style.setProperty('--preview-width', `${clampPreviewWidth(state.previewWidth)}px`)
  previewToggles.forEach((button) => {
    button.setAttribute('aria-pressed', String(isSplitView))
  })
  themeToggle.setAttribute('aria-pressed', String(state.themeMode === 'dark'))
  const viewModeLabel = state.viewMode === 'edit' ? 'Edit' : state.viewMode === 'split' ? 'Split' : 'Prev'
  previewToggleChip.querySelector<HTMLElement>('.toggle-chip-value')!.textContent = viewModeLabel
  themeToggle.querySelector<HTMLElement>('.toggle-chip-value')!.textContent =
    state.themeMode === 'dark' ? 'Dark' : 'Light'
  applyTheme(state.themeMode)
  renderTree()
  renderEditor()
  renderPreview(getSelectedNode())
}

function applyTheme(mode: 'light' | 'dark') {
  document.documentElement.dataset.theme = mode
}

function renderTree() {
  tree.innerHTML = ''
  const rootNodes = state.nodes
    .filter((node) => node.type === 'folder' && node.parentId === null)
    .filter((node) => isNodeVisibleInTreeSearch(node, treeSearchQuery))

  if (!rootNodes.length) {
    const emptySearch = document.createElement('p')
    emptySearch.className = 'tree-search-empty'
    emptySearch.textContent = treeSearchQuery ? 'No matching files or folders.' : 'No folders yet.'
    tree.appendChild(emptySearch)
    return
  }

  const list = document.createElement('div')
  list.className = 'tree-list'
  rootNodes.forEach((node) => list.appendChild(renderTreeNode(node, 0, treeSearchQuery)))
  tree.appendChild(list)
}

function syncSearchClearButton() {
  clearSearchButton.hidden = treeSearchInput.value.length === 0
}

function updateSelectedTreeLabel(title: string) {
  const activeLabel = tree.querySelector<HTMLElement>('.tree-item.active .tree-name')
  if (activeLabel) {
    activeLabel.textContent = title
  }
}

function renderTreeNode(node: PromptNode, depth: number, searchQuery = ''): HTMLElement {
  const container = document.createElement('div')
  container.className = 'tree-node'
  container.style.setProperty('--depth', `${depth}`)

  if (node.type === 'folder') {
    const searching = Boolean(searchQuery)
    const expanded = searching || state.expandedIds.includes(node.id)
    container.innerHTML = `
      <div class="tree-row" data-expanded="${expanded}" data-action="select" data-id="${node.id}">
        <button class="tree-toggle" data-action="toggle-expand" data-id="${node.id}" aria-label="Toggle" aria-expanded="${expanded}">
          <span class="tree-chevron" aria-hidden="true"></span>
        </button>
        <div class="tree-entry">
          <button class="tree-item ${isSelected(node.id) ? 'active' : ''}" data-action="select" data-id="${node.id}">
            <span class="tree-icon folder"></span>
            <span class="tree-name">${escapeHtml(node.title)}</span>
          </button>
          <button class="tree-delete" data-action="delete-node" data-id="${node.id}" aria-label="Delete ${escapeHtml(node.title)}">
            <span class="tree-delete-icon" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    `

    if (expanded) {
      const children = state.nodes
        .filter((child) => child.parentId === node.id)
        .filter((child) => isNodeVisibleInTreeSearch(child, searchQuery))
      const childWrap = document.createElement('div')
      childWrap.className = 'tree-children'
      children.forEach((child) => childWrap.appendChild(renderTreeNode(child, depth + 1, searchQuery)))
      container.appendChild(childWrap)
    }
  } else {
    const promptIconClass =
      node.format === 'latex' ? 'file-latex' : node.format === 'todo' ? 'file-todo' : 'file-markdown'
    container.innerHTML = `
      <div class="tree-row" data-action="select" data-id="${node.id}">
        <span class="tree-spacer"></span>
        <div class="tree-entry">
          <button class="tree-item ${isSelected(node.id) ? 'active' : ''}" data-action="select" data-id="${node.id}">
            <span class="tree-icon ${promptIconClass}"></span>
            <span class="tree-name">${escapeHtml(node.title)}</span>
          </button>
          <button class="tree-delete" data-action="delete-node" data-id="${node.id}" aria-label="Delete ${escapeHtml(node.title)}">
            <span class="tree-delete-icon" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    `
  }

  return container
}

function isNodeVisibleInTreeSearch(node: PromptNode, searchQuery: string): boolean {
  if (!searchQuery) return true

  const ownMatch = node.title.toLowerCase().includes(searchQuery)
  if (ownMatch) return true
  if (node.type === 'prompt') {
    return (node.content ?? '').toLowerCase().includes(searchQuery)
  }
  if (node.type !== 'folder') return false

  return state.nodes
    .filter((child) => child.parentId === node.id)
    .some((child) => isNodeVisibleInTreeSearch(child, searchQuery))
}

function renderEditor() {
  const node = getSelectedNode()
  const isPrompt = node?.type === 'prompt'
  const showPackageControls = isPrompt && node?.format === 'latex'
  emptyState.hidden = Boolean(isPrompt)
  contentInput.hidden = !isPrompt
  editorToolbar.hidden = !isPrompt
  topbarTitleLabel.textContent = node?.title ?? ''
  titleInput.value = node?.title ?? ''
  titleInput.disabled = !node
  contentInput.value = isPrompt ? node.content ?? '' : ''
  contentInput.placeholder =
    node?.format === 'latex'
      ? '\\begin{align}\n  f(x) &= x^2 + 3x + 2 \\\\\n  f\'(x) &= 2x + 3\n\\end{align}'
      : node?.format === 'todo'
        ? '- [ ] Main task\n  - [ ] Nested task\n  - [x] Done task'
        : 'Write...'
  packageToggle.hidden = !showPackageControls
  packageMenu.hidden = !showPackageControls
  if (!showPackageControls) {
    closePackageMenu()
  }
  packageSummary.textContent = 'packages'
  const packageCheckboxes = packageList.querySelectorAll<HTMLInputElement>('[data-package-checkbox]')
  packageCheckboxes.forEach((checkbox) => {
    checkbox.checked = state.latexPackages.includes(checkbox.value)
    checkbox.disabled = !showPackageControls
  })
  formatButtons.forEach((button) => {
    const isActive = isPrompt && button.dataset.format === node?.format
    button.disabled = !isPrompt
    button.setAttribute('aria-pressed', String(Boolean(isActive)))
  })
  copyButtons.forEach((button) => {
    button.disabled = !isPrompt
    button.classList.remove('is-copied', 'is-error')
    syncCopyButtonLabel(button, 'Copy')
  })
  localAiButtons.forEach((button) => {
    button.disabled = !isPrompt
  })
  if (!isPrompt) {
    closeEditorSearch()
  }
  syncEditorHighlightLayer()
  refreshEditorSearch()
  renderMeta(node)
}

function openEditorSearch() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return
  editorBody.classList.add('is-search-open')
  editorSearchBar.hidden = false
  editorSearchInput.focus()
  editorSearchInput.select()
  syncEditorHighlightLayer()
  refreshEditorSearch()
}

function closeEditorSearch() {
  editorBody.classList.remove('is-search-open')
  editorSearchBar.hidden = true
  editorSearchQuery = ''
  editorSearchMatches = []
  editorSearchActiveMatch = -1
  editorSearchInput.value = ''
  editorSearchCount.textContent = '0/0'
  syncEditorHighlightLayer()
}

function refreshEditorSearch() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt' || contentInput.hidden) {
    editorSearchMatches = []
    editorSearchActiveMatch = -1
    editorSearchCount.textContent = '0/0'
    syncEditorHighlightLayer()
    return
  }

  editorSearchMatches = buildEditorSearchMatches(contentInput.value, editorSearchQuery)
  if (!editorSearchMatches.length) {
    editorSearchActiveMatch = -1
    editorSearchCount.textContent = '0/0'
    syncEditorHighlightLayer()
    return
  }

  if (editorSearchActiveMatch < 0 || editorSearchActiveMatch >= editorSearchMatches.length) {
    editorSearchActiveMatch = 0
  }
  editorSearchCount.textContent = `${editorSearchActiveMatch + 1}/${editorSearchMatches.length}`
  applyEditorSearchSelection()
  syncEditorHighlightLayer()
}

function buildEditorSearchMatches(content: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  const haystack = content.toLowerCase()
  const matches: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset <= haystack.length) {
    const index = haystack.indexOf(normalizedQuery, offset)
    if (index === -1) break
    matches.push({ start: index, end: index + normalizedQuery.length })
    offset = index + Math.max(1, normalizedQuery.length)
  }
  return matches
}

function stepEditorSearch(direction: 1 | -1) {
  if (!editorSearchMatches.length) return
  editorSearchActiveMatch =
    (editorSearchActiveMatch + direction + editorSearchMatches.length) % editorSearchMatches.length
  editorSearchCount.textContent = `${editorSearchActiveMatch + 1}/${editorSearchMatches.length}`
  applyEditorSearchSelection()
  syncEditorHighlightLayer()
}

function applyEditorSearchSelection() {
  const active = editorSearchMatches[editorSearchActiveMatch]
  if (!active) return
  contentInput.setSelectionRange(active.start, active.end)
}

function syncEditorHighlightLayer() {
  const node = getSelectedNode()
  const isPrompt = node?.type === 'prompt'
  const query = editorSearchQuery.trim()
  const value = contentInput.value
  if (!isPrompt || !query) {
    editorHighlightLayer.innerHTML = escapeHtml(value)
    editorHighlightLayer.scrollTop = contentInput.scrollTop
    editorHighlightLayer.scrollLeft = contentInput.scrollLeft
    return
  }

  let cursor = 0
  const highlighted = editorSearchMatches
    .map((match, index) => {
      const start = Math.max(0, Math.min(value.length, match.start))
      const end = Math.max(start, Math.min(value.length, match.end))
      const before = escapeHtml(value.slice(cursor, start))
      const chunk = escapeHtml(value.slice(start, end))
      cursor = end
      const activeClass = index === editorSearchActiveMatch ? ' active' : ''
      return `${before}<mark class="editor-highlight-match${activeClass}">${chunk}</mark>`
    })
    .join('')

  editorHighlightLayer.innerHTML = `${highlighted}${escapeHtml(value.slice(cursor))}`
  editorHighlightLayer.scrollTop = contentInput.scrollTop
  editorHighlightLayer.scrollLeft = contentInput.scrollLeft
}

function renderMeta(node?: PromptNode | null) {
  if (!node || node.type !== 'prompt') {
    createdLabel.textContent = 'No prompt selected.'
    historyButton.hidden = true
    historyButton.disabled = true
    return
  }
  const created = new Date(node.createdAt).toLocaleString()
  createdLabel.textContent = `Created ${created}`
  historyButton.hidden = false
  historyButton.disabled = false
}

function renderPreview(node?: PromptNode | null) {
  if (!node || node.type !== 'prompt') {
    previewBody.classList.remove('latex-preview')
    previewBody.innerHTML = '<p>Select a prompt to preview markdown.</p>'
    return
  }
  const raw = node.content ?? ''
  if (node.format === 'latex') {
    previewBody.classList.remove('todo-preview')
    previewBody.classList.add('latex-preview')
    previewBody.innerHTML = renderLatexPreview(raw)
    return
  }
  previewBody.classList.remove('latex-preview')
  previewBody.classList.toggle('todo-preview', node.format === 'todo')
  const html = marked.parse(raw, { async: false }) as string
  const safeHtml = sanitizeMarkdownHtml(html)
  if (node.format === 'todo') {
    previewBody.innerHTML = `
      <div class="todo-progress" data-todo-progress></div>
      <div class="todo-preview-content">${safeHtml}</div>
    `
    enhanceTodoPreview(node)
    return
  }

  previewBody.innerHTML = safeHtml
  renderMathInElement(previewBody, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true }
    ],
    throwOnError: false
  })
  enableMarkdownTaskChecklist(node)
}

function enhanceTodoPreview(node: PromptNode) {
  const todoContent = previewBody.querySelector<HTMLElement>('.todo-preview-content')
  if (!todoContent) return

  initializeTodoCollapsibles(todoContent)
  updateTodoProgress(todoContent)
  enableMarkdownTaskChecklist(node)
}

function initializeTodoCollapsibles(root: HTMLElement) {
  const todoItems = root.querySelectorAll<HTMLLIElement>('li:has(> input[type="checkbox"]), li:has(input[type="checkbox"])')
  todoItems.forEach((item) => {
    const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!checkbox) return
    item.classList.add('todo-item')
    if (checkbox.checked) {
      item.classList.add('is-done')
    } else {
      item.classList.remove('is-done')
    }

    const nestedList = item.querySelector<HTMLOListElement | HTMLUListElement>(':scope > ul, :scope > ol')
    const existingControl = item.querySelector<HTMLElement>(':scope > .todo-collapse-btn, :scope > .todo-collapse-spacer')

    if (!nestedList) {
      item.classList.remove('todo-collapsible', 'is-collapsed')
      if (!existingControl || !existingControl.classList.contains('todo-collapse-spacer')) {
        const spacer = document.createElement('span')
        spacer.className = 'todo-collapse-spacer'
        spacer.setAttribute('aria-hidden', 'true')
        if (existingControl) {
          existingControl.replaceWith(spacer)
        } else {
          item.prepend(spacer)
        }
      }
      return
    }

    item.classList.add('todo-collapsible')

    if (!existingControl || !existingControl.classList.contains('todo-collapse-btn')) {
      const collapseButton = document.createElement('button')
      collapseButton.type = 'button'
      collapseButton.className = 'todo-collapse-btn'
      collapseButton.innerHTML = '<span class="todo-collapse-chevron" aria-hidden="true"></span>'
      collapseButton.setAttribute('aria-label', 'Collapse nested tasks')
      collapseButton.setAttribute('aria-expanded', 'true')
      collapseButton.addEventListener('click', () => {
        const collapsed = item.classList.toggle('is-collapsed')
        collapseButton.setAttribute('aria-expanded', String(!collapsed))
        collapseButton.setAttribute('aria-label', collapsed ? 'Expand nested tasks' : 'Collapse nested tasks')
      })
      if (existingControl) {
        existingControl.replaceWith(collapseButton)
      } else {
        item.prepend(collapseButton)
      }
    }
  })
}

function updateTodoProgress(root: HTMLElement) {
  const progressNode = previewBody.querySelector<HTMLElement>('[data-todo-progress]')
  if (!progressNode) return
  const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  const total = checkboxes.length
  const completed = Array.from(checkboxes).filter((checkbox) => checkbox.checked).length
  const percent = total ? Math.round((completed / total) * 100) : 0
  progressNode.innerHTML = `
    <div class="todo-progress-header">
      <strong>Progress</strong>
      <span>${completed}/${total} done (${percent}%)</span>
    </div>
    <div class="todo-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <span class="todo-progress-fill" style="width: ${percent}%"></span>
    </div>
  `
}

function sanitizeMarkdownHtml(html: string) {
  const safeHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled']
  })
  const template = document.createElement('template')
  template.innerHTML = safeHtml

  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const rawHref = anchor.getAttribute('href')?.trim() ?? ''
    if (!rawHref) return

    // Block only dangerous schemes while keeping normal markdown links clickable.
    const isSafeHref = !/^(?:javascript|data|vbscript):/i.test(rawHref)

    if (!isSafeHref) {
      anchor.removeAttribute('href')
      return
    }

    if (!rawHref.startsWith('#')) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  })

  return template.innerHTML
}

function enableMarkdownTaskChecklist(node: PromptNode) {
  if (node.type !== 'prompt' || (node.format !== 'markdown' && node.format !== 'todo')) return

  const taskCheckboxes = previewBody.querySelectorAll<HTMLInputElement>(
    'li > input[type="checkbox"], li input[type="checkbox"]'
  )

  taskCheckboxes.forEach((checkbox, index) => {
    checkbox.disabled = false
    checkbox.dataset.taskIndex = String(index)
    checkbox.addEventListener('change', () => {
      const targetIndex = Number(checkbox.dataset.taskIndex)
      if (!Number.isInteger(targetIndex)) return

      const updates = new Map<number, boolean>([[targetIndex, checkbox.checked]])
      if (node.format === 'todo') {
        const parentItem = checkbox.closest('li')
        const descendantCheckboxes = parentItem?.querySelectorAll<HTMLInputElement>('ul input[type="checkbox"], ol input[type="checkbox"]')
        descendantCheckboxes?.forEach((descendant) => {
          if (descendant === checkbox) return
          const descendantIndex = Number(descendant.dataset.taskIndex)
          if (!Number.isInteger(descendantIndex)) return
          updates.set(descendantIndex, checkbox.checked)
        })
      }

      let nextContent = node.content ?? ''
      Array.from(updates.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([taskIndex, checked]) => {
          nextContent = toggleMarkdownTaskAtIndex(nextContent, taskIndex, checked)
        })
      if (nextContent === node.content) return

      node.content = nextContent
      node.updatedAt = Date.now()
      contentInput.value = nextContent
      scheduleHistorySnapshot(node)
      persistState()
      renderPreview(node)
      renderMeta(node)
    })
  })
}

function toggleMarkdownTaskAtIndex(content: string, taskIndex: number, checked: boolean) {
  const lines = content.split('\n')
  let currentTask = 0
  const markerPattern = /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s.*)$/

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(markerPattern)
    if (!match) continue

    if (currentTask === taskIndex) {
      lines[i] = `${match[1]}${checked ? 'x' : ' '}${match[3]}`
      return lines.join('\n')
    }
    currentTask += 1
  }

  return content
}

function renderLatexPreview(raw: string) {
  const source = normalizeLatexSource(raw)

  try {
    const generator = parse(source, {
      generator: new HtmlGenerator({ hyphenate: false })
    })

    const page = document.createElement('div')
    page.className = 'page latex-document'
    const injectedAssets = (generator as { stylesAndScripts?: () => unknown }).stylesAndScripts?.()
    if (Array.isArray(injectedAssets)) {
      injectedAssets.forEach((asset) => {
        if (asset instanceof HTMLStyleElement || asset instanceof HTMLLinkElement) {
          page.appendChild(asset.cloneNode(true))
        }
      })
    } else if (injectedAssets instanceof HTMLStyleElement || injectedAssets instanceof HTMLLinkElement) {
      page.appendChild(injectedAssets.cloneNode(true))
    } else if (typeof injectedAssets === 'string' && injectedAssets.trim()) {
      const template = document.createElement('template')
      template.innerHTML = injectedAssets
      template.content
        .querySelectorAll('style,link[rel="stylesheet"]')
        .forEach((asset) => page.appendChild(asset.cloneNode(true)))
    }
    page.appendChild(generator.domFragment().cloneNode(true))
    generator.applyLengthsAndGeometryToDom(page)
    applyLatexColorFallback(page, raw)

    return page.outerHTML
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to render this LaTeX document.'
    return DOMPurify.sanitize(`
      <div class="latex-error">
        <h3>LaTeX render error</h3>
        <pre>${escapeHtml(message)}</pre>
      </div>
    `)
  }
}

function normalizeLatexSource(raw: string) {
  const compatibleRaw = normalizeInlineColorCommands(normalizeUnsupportedLatexEnvironments(raw))
  const packageBlock = buildLatexPackageBlock(compatibleRaw)
  const trimmed = compatibleRaw.trim()
  if (!trimmed) {
    return `\\documentclass{article}\n${packageBlock}\n\\begin{document}\n\\end{document}`
  }

  if (/\\documentclass\b/.test(trimmed)) {
    return injectLatexPackagesIntoDocument(trimmed, packageBlock)
  }

  if (/\\begin\{document\}/.test(trimmed)) {
    return `\\documentclass{article}\n${packageBlock}\n${trimmed}`
  }

  return `\\documentclass{article}\n${packageBlock}\n\\begin{document}\n${compatibleRaw}\n\\end{document}`
}

function createNode(type: NodeType) {
  const parentId = type === 'folder' ? null : getSelectedFolderId()
  const now = Date.now()
  const node: PromptNode = {
    id: crypto.randomUUID(),
    type,
    title: type === 'folder' ? 'Untitled folder' : 'Untitled prompt',
    parentId,
    format: type === 'prompt' ? 'markdown' : undefined,
    content: type === 'prompt' ? '' : undefined,
    createdAt: now,
    updatedAt: now,
    history: type === 'prompt' ? [] : undefined
  }
  state.nodes.push(node)
  if (type === 'prompt') {
    state.selectedId = node.id
    if (parentId) {
      state.expandedIds = Array.from(new Set([...state.expandedIds, parentId]))
    }
  } else {
    state.selectedId = node.id
    state.expandedIds = Array.from(new Set([...state.expandedIds, node.id]))
  }
  persistState()
  render()
  scrollSelectedTreeItemIntoView()
  if (type === 'prompt' || type === 'folder') {
    const label = tree.querySelector<HTMLElement>(`.tree-item.active .tree-name`)
    if (label) startInlineRename(node.id, label)
  }
}

function startInlineRename(id: string, labelEl: HTMLElement) {
  const node = state.nodes.find((n) => n.id === id)
  if (!node) return
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'tree-name-input'
  input.value = node.title
  input.spellcheck = false
  labelEl.replaceWith(input)
  input.focus()
  input.select()
  let committed = false
  const commit = () => {
    if (committed) return
    committed = true
    const next = input.value.trim()
    if (next && next !== node.title) {
      node.title = next
      node.updatedAt = Date.now()
      persistState()
    }
    render()
  }
  const cancel = () => {
    if (committed) return
    committed = true
    render()
  }
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  })
  input.addEventListener('blur', commit)
  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener('input', () => {
    if (state.selectedId === id) {
      topbarTitleLabel.textContent = input.value
    }
  })
}

function scrollSelectedTreeItemIntoView() {
  const active = tree.querySelector<HTMLElement>('.tree-item.active')
  if (active) {
    active.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

function openDeleteConfirm(id?: string) {
  if (!id) return
  const node = state.nodes.find((item) => item.id === id)
  if (!node) return
  const label = node.type === 'folder' ? 'folder and its contents' : 'prompt'
  pendingDeleteId = id
  confirmDeleteCopy.textContent = `Delete this ${label}? This cannot be undone.`
  confirmDeletePanel.hidden = false
}

function confirmDelete() {
  if (!pendingDeleteId) return
  const toDelete = collectNodeIds(pendingDeleteId)
  state.nodes = state.nodes.filter((item) => !toDelete.includes(item.id))
  if (state.selectedId && toDelete.includes(state.selectedId)) {
    const next = state.nodes.find((item) => item.type === 'prompt')
    state.selectedId = next?.id ?? null
  }
  state.expandedIds = state.expandedIds.filter((id) => !toDelete.includes(id))
  pendingDeleteId = null
  confirmDeletePanel.hidden = true
  persistState()
  render()
}

function closeDeleteConfirm() {
  pendingDeleteId = null
  confirmDeletePanel.hidden = true
}

function exportState() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'PrEditor',
    version: 1,
    state
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const timestamp = getExportTimestamp()

  link.href = url
  link.download = `${timestamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportSelectedPromptFile(extension: 'md' | 'tex') {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') {
    alert('Select a prompt file before exporting.')
    return
  }

  const content = node.content ?? ''
  const mimeType = extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/x-tex;charset=utf-8'
  const safeTitle = node.title.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled'
  const filename = `${safeTitle}-${getExportTimestamp()}.${extension}`
  downloadBlob(content, mimeType, filename)
}

function getExportTimestamp() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

function downloadBlob(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function canExportPreviewSnapshot(): boolean {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') {
    alert('Select a prompt file before exporting its preview.')
    return false
  }
  if (!(node.content ?? '').trim()) {
    alert('This prompt is empty; nothing to export.')
    return false
  }
  return true
}

function previewExportBaseName() {
  const node = getSelectedNode()
  const title = node?.type === 'prompt' ? node.title : 'preview'
  const safeTitle = title.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled'
  return `${safeTitle}-${getExportTimestamp()}`
}

async function exportPreviewAsPng() {
  if (!canExportPreviewSnapshot()) return
  confirmExportPanel.hidden = true
  try {
    const { default: html2canvas } = await import('html2canvas')
    const bg = getComputedStyle(previewBody).backgroundColor
    const canvas = await html2canvas(previewBody, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff',
      logging: false
    })
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG export failed'))
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${previewExportBaseName()}.png`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        resolve()
      }, 'image/png')
    })
  } catch {
    alert('Could not export PNG. Try again or simplify the document.')
  }
}

async function exportPreviewAsPdf() {
  if (!canExportPreviewSnapshot()) return
  confirmExportPanel.hidden = true
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf')
    ])
    const canvas = await html2canvas(previewBody, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false
    })
    const imgData = canvas.toDataURL('image/png')
    const pageWidthMm = 210
    const pageHeightMm = Math.max((canvas.height / canvas.width) * pageWidthMm, 1)
    const pdf = new jsPDF({
      unit: 'mm',
      format: [pageWidthMm, pageHeightMm],
      orientation: pageHeightMm > pageWidthMm ? 'portrait' : 'landscape'
    })
    pdf.addImage(imgData, 'PNG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST')
    pdf.save(`${previewExportBaseName()}.pdf`)
  } catch {
    alert('Could not export PDF. Try again or simplify the document.')
  }
}

function importState(raw: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    alert('Import file is not valid JSON.')
    return
  }

  const candidate =
    parsed && typeof parsed === 'object' && 'state' in parsed
      ? (parsed as { state?: unknown }).state
      : parsed

  const nextState = parseImportedState(candidate)
  if (!nextState) {
    alert('Import file does not contain a valid PrEditor export.')
    return
  }

  state.nodes = nextState.nodes
  state.selectedId = nextState.selectedId
  state.expandedIds = nextState.expandedIds
  state.viewMode = nextState.viewMode
  state.themeMode = nextState.themeMode
  state.sidebarCollapsed = nextState.sidebarCollapsed
  state.previewWidth = nextState.previewWidth
  state.latexPackages = nextState.latexPackages
  initializeState()
  closeDeleteConfirm()
  closeHistory()
  confirmExportPanel.hidden = true
  render()
}

function parseImportedState(value: unknown): AppState | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Partial<AppState>
  if (!Array.isArray(candidate.nodes)) return null
  const legacyShowPreview =
    'showPreview' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).showPreview === 'boolean'
      ? Boolean((value as Record<string, unknown>).showPreview)
      : null
  const parsedViewMode =
    candidate.viewMode === 'edit' || candidate.viewMode === 'split' || candidate.viewMode === 'preview'
      ? candidate.viewMode
      : null

  return {
    nodes: candidate.nodes.map(normalizeImportedNode).filter(Boolean) as PromptNode[],
    selectedId: typeof candidate.selectedId === 'string' || candidate.selectedId === null
      ? candidate.selectedId
      : null,
    expandedIds: Array.isArray(candidate.expandedIds)
      ? candidate.expandedIds.filter((id): id is string => typeof id === 'string')
      : [],
    viewMode:
      parsedViewMode ??
      (legacyShowPreview === null ? defaultState.viewMode : legacyShowPreview ? 'split' : 'edit'),
    themeMode: candidate.themeMode === 'dark' ? 'dark' : 'light',
    sidebarCollapsed: typeof candidate.sidebarCollapsed === 'boolean'
      ? candidate.sidebarCollapsed
      : defaultState.sidebarCollapsed,
    previewWidth:
      typeof candidate.previewWidth === 'number' && Number.isFinite(candidate.previewWidth)
        ? candidate.previewWidth
        : defaultState.previewWidth,
    latexPackages: normalizeLatexPackages(candidate.latexPackages)
  }
}

function normalizeViewMode(value: unknown): AppState['viewMode'] {
  if (value === 'edit' || value === 'split' || value === 'preview') {
    return value
  }
  return defaultState.viewMode
}

function nextViewMode(mode: AppState['viewMode']): AppState['viewMode'] {
  if (mode === 'edit') return 'split'
  if (mode === 'split') return 'preview'
  return 'edit'
}

function normalizeImportedNode(value: unknown): PromptNode | null {
  if (!value || typeof value !== 'object') return null

  const node = value as Partial<PromptNode>
  const type = node.type === 'folder' || node.type === 'prompt' ? node.type : null
  const id = typeof node.id === 'string' ? node.id : null
  const title = typeof node.title === 'string' ? node.title : null
  if (!type || !id || !title) return null

  const createdAt =
    typeof node.createdAt === 'number' && Number.isFinite(node.createdAt)
      ? node.createdAt
      : Date.now()
  const updatedAt =
    typeof node.updatedAt === 'number' && Number.isFinite(node.updatedAt)
      ? node.updatedAt
      : createdAt

  return {
    id,
    type,
    title,
    parentId: typeof node.parentId === 'string' || node.parentId === null ? node.parentId : null,
    format:
      type === 'prompt' ? (node.format === 'latex' || node.format === 'todo' ? node.format : 'markdown') : undefined,
    content: type === 'prompt' ? (typeof node.content === 'string' ? node.content : '') : undefined,
    createdAt,
    updatedAt,
    history:
      type === 'prompt' && Array.isArray(node.history)
        ? trimHistory(
            node.history
              .map((entry) => normalizeImportedHistoryEntry(entry))
              .filter(Boolean) as PromptHistoryEntry[]
          )
        : type === 'prompt'
          ? []
          : undefined
  }
}

function normalizeImportedHistoryEntry(value: unknown): PromptHistoryEntry | null {
  if (!value || typeof value !== 'object') return null

  const entry = value as Partial<PromptHistoryEntry>
  if (
    typeof entry.timestamp !== 'number' ||
    !Number.isFinite(entry.timestamp) ||
    typeof entry.content !== 'string'
  ) {
    return null
  }

  return {
    timestamp: entry.timestamp,
    content: entry.content
  }
}

function setSelectedFormat(format?: PromptFormat) {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt' || !format || node.format === format) return
  node.format = format
  node.updatedAt = Date.now()
  persistState()
  renderEditor()
  renderPreview(node)
}

function toggleLatexPackage(packageName?: string) {
  if (!packageName) return
  const nextPackages = new Set(state.latexPackages)

  if (nextPackages.has(packageName)) {
    nextPackages.delete(packageName)
  } else {
    nextPackages.add(packageName)
  }

  state.latexPackages = normalizeLatexPackages(Array.from(nextPackages))
  persistState()
  renderEditor()
  renderPreview(getSelectedNode())
}

function openPackageMenu() {
  packageList.hidden = false
  packageSummary.setAttribute('aria-expanded', 'true')
}

function closePackageMenu() {
  packageList.hidden = true
  packageSummary.setAttribute('aria-expanded', 'false')
}

function toggleSidebarOverflow() {
  const open = sidebarOverflowMenu.hidden
  sidebarOverflowMenu.hidden = !open
  sidebarOverflowBtn.setAttribute('aria-expanded', String(open))
}

function closeSidebarOverflow() {
  sidebarOverflowMenu.hidden = true
  sidebarOverflowBtn.setAttribute('aria-expanded', 'false')
}

async function copySelectedPrompt(button?: HTMLButtonElement | null) {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return

  const content = node.content ?? ''
  const targetButton = button ?? copyButtons[0] ?? null
  if (!targetButton) return

  try {
    await navigator.clipboard.writeText(content)
    setCopyButtonState(targetButton, 'Copied', 'is-copied')
  } catch {
    setCopyButtonState(targetButton, 'Copy failed', 'is-error')
  }
}

function openLocalAi() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') {
    alert('Select a prompt file first.')
    return
  }
  localAiPanel.hidden = false
  if (localAiLoadedModelId === localAiSelectedModelId && localAiEngine) {
    localAiStatus.textContent = `Model ready: ${localAiModelSelect.selectedOptions[0]?.textContent ?? localAiSelectedModelId}`
  } else {
    localAiStatus.textContent = 'Runs on-device. Press Run Local AI to load selected model and start.'
  }
  setLocalAiProgress(0, 'Idle', false)
  localAiInput.focus()
}

async function closeLocalAi() {
  await cancelLocalAi(false)
  localAiPanel.hidden = true
}

async function cancelLocalAi(keepPanelOpen = true) {
  localAiCancelRequested = true
  localAiRunId += 1
  localAiRunning = false
  localAiLoadingModelId = ''
  localAiCancelButton.disabled = true
  localAiInsertButton.disabled = true
  localAiStatus.textContent = 'Local AI canceled.'
  setLocalAiProgress(0, 'Canceled', false)
  if (keepPanelOpen) {
    localAiOutput.textContent = 'Canceled.'
  }

  if (localAiEngine) {
    try {
      if (typeof localAiEngine.interruptGenerate === 'function') {
        await localAiEngine.interruptGenerate()
      }
    } catch {
      // Ignore interrupt failures.
    }
    try {
      if (typeof localAiEngine.unload === 'function') {
        await localAiEngine.unload()
      }
    } catch {
      // Ignore unload failures.
    }
    localAiEngine = null
    localAiLoadedModelId = ''
    refreshLocalAiModelOptions()
  }

  if (!keepPanelOpen) {
    localAiOutput.textContent = ''
  }
}

function setLocalAiProgress(progress: number, label: string, visible: boolean) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  localAiProgress.hidden = !visible
  localAiProgressFill.style.width = `${pct}%`
  localAiProgressLabel.textContent = visible ? `${pct}% ${label}` : label
}

async function getLocalAiEngine(modelId: string) {
  if (localAiEngine && localAiLoadedModelId === modelId) return localAiEngine
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (!hasWebGpu) {
    throw new Error('WebGPU is not available in this browser/device. Local AI needs WebGPU.')
  }
  localAiStatus.textContent = `Loading model (${modelId}) on this device...`
  localAiLoadingModelId = modelId
  refreshLocalAiModelOptions()
  setLocalAiProgress(0, 'Starting', true)
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm')
  localAiEngine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report: { progress?: number; text?: string }) => {
      const percent = typeof report.progress === 'number' ? ` ${Math.round(report.progress * 100)}%` : ''
      const detail = report.text ? ` - ${report.text}` : ''
      localAiStatus.textContent = `Loading model (${modelId})${percent}${detail}`
      setLocalAiProgress((report.progress ?? 0) * 100, report.text ?? 'Loading', true)
    }
  })
  if (localAiCancelRequested) {
    if (typeof localAiEngine.unload === 'function') {
      await localAiEngine.unload()
    }
    localAiEngine = null
    localAiLoadedModelId = ''
    localAiLoadingModelId = ''
    refreshLocalAiModelOptions()
    throw new Error('Local AI run canceled while loading model.')
  }
  localAiLoadedModelId = modelId
  localAiLoadingModelId = ''
  refreshLocalAiModelOptions()
  localAiStatus.textContent = `Model ready: ${localAiModelSelect.selectedOptions[0]?.textContent ?? modelId}`
  setLocalAiProgress(100, 'Ready', false)
  return localAiEngine
}

async function runLocalAi() {
  if (localAiRunning) return
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') {
    alert('Select a prompt file first.')
    return
  }

  const instruction = localAiInput.value.trim()
  if (!instruction) {
    alert('Write what Local AI should do first.')
    return
  }

  const runId = ++localAiRunId
  localAiCancelRequested = false
  localAiRunning = true
  localAiCancelButton.disabled = false
  localAiInsertButton.disabled = true
  localAiOutput.textContent = 'Running local model...'
  localAiStatus.textContent = 'Thinking on-device...'
  setLocalAiProgress(0, 'Preparing', false)

  try {
    const selectedModelId = localAiSelectedModelId
    const engine = await getLocalAiEngine(selectedModelId)
    if (localAiCancelRequested || runId !== localAiRunId) {
      return
    }
    localAiStatus.textContent = `Running ${localAiModelSelect.selectedOptions[0]?.textContent ?? selectedModelId} locally...`
    const messages = [
      {
        role: 'system',
        content:
          'You are an assistant inside a prompt editor. Provide concise, high-quality output based on user instruction and file content.'
      },
      {
        role: 'user',
        content: `Instruction:\n${instruction}\n\nCurrent file format: ${node.format ?? 'markdown'}\nCurrent file content:\n${node.content ?? ''}`
      }
    ]
    const generationTimeoutMs = 120000
    const generation = engine.chat.completions.create({
      messages,
      temperature: 0.4,
      max_tokens: 512,
      stream: true
    })
    const timeoutPromise = new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(
          new Error(
            'Local generation timed out. Try a smaller model or shorter input, then run again.'
          )
        )
      }, generationTimeoutMs)
    })
    const stream = await Promise.race([generation, timeoutPromise])
    if (localAiCancelRequested || runId !== localAiRunId) {
      return
    }

    localAiResponse = ''
    for await (const chunk of stream as AsyncIterable<any>) {
      if (localAiCancelRequested || runId !== localAiRunId) {
        if (typeof engine.interruptGenerate === 'function') {
          await engine.interruptGenerate()
        }
        return
      }
      const piece = chunk?.choices?.[0]?.delta?.content
      if (typeof piece === 'string' && piece.length > 0) {
        localAiResponse += piece
        localAiOutput.textContent = localAiResponse
      }
    }
    localAiResponse = localAiResponse.trim()
    localAiOutput.textContent = localAiResponse || 'No output generated.'
    localAiInsertButton.disabled = !localAiResponse
    localAiStatus.textContent = 'Done locally.'
    setLocalAiProgress(100, 'Done', false)
  } catch (error) {
    if (localAiCancelRequested || runId !== localAiRunId) {
      localAiStatus.textContent = 'Local AI canceled.'
      localAiOutput.textContent = 'Canceled.'
      localAiInsertButton.disabled = true
      setLocalAiProgress(0, 'Canceled', false)
    } else {
      localAiStatus.textContent = 'Local AI failed.'
      localAiOutput.textContent = error instanceof Error ? error.message : 'Unknown error.'
      localAiInsertButton.disabled = true
      setLocalAiProgress(0, 'Failed', false)
    }
  } finally {
    if (runId === localAiRunId) {
      localAiRunning = false
      localAiCancelButton.disabled = true
    }
  }
}

function insertLocalAiOutput() {
  if (!localAiResponse) return
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return
  const existing = node.content ?? ''
  node.content = existing.trim() ? `${existing}\n\n${localAiResponse}` : localAiResponse
  node.updatedAt = Date.now()
  contentInput.value = node.content
  persistState()
  renderPreview(node)
  renderMeta(node)
}

async function openTypeSpeed() {
  void resetTypeSpeed()
  typeSpeedPanel.hidden = false
  window.setTimeout(() => {
    typeSpeedInput.focus()
    typeSpeedInput.setSelectionRange(typeSpeedInput.value.length, typeSpeedInput.value.length)
  }, 0)
}

function closeTypeSpeed() {
  typeSpeedPanel.hidden = true
}

async function resetTypeSpeed() {
  typeSpeedParagraphCount = normalizeTypeSpeedParagraphCount(Number(typeSpeedCountInput.value))
  typeSpeedCountInput.value = String(typeSpeedParagraphCount)

  const requestId = ++typeSpeedRequestId
  typeSpeedLoading = true
  typeSpeedError = ''
  typeSpeedInput.disabled = true
  renderTypeSpeed()

  try {
    const { paragraphs, sources, usedFallback } = await fetchMeaningfulTypeSpeedParagraphs(typeSpeedParagraphCount)
    if (requestId !== typeSpeedRequestId) return

    const fullText = paragraphs.join('\n\n')
    typeTestSession = {
      fullText,
      paragraphs,
      chunks: chunkTypeSpeedText(fullText, 72),
      paragraphCount: typeSpeedParagraphCount,
      sources,
      currentChunkIndex: 0,
      currentInput: '',
      startedAt: null,
      completedAt: null,
      totalTypedChars: 0,
      correctChars: 0
    }
    typeSpeedError = usedFallback
      ? 'Some paragraphs were filled locally because the text API did not return enough usable article content.'
      : ''
  } catch {
    if (requestId !== typeSpeedRequestId) return
    const paragraphs = buildTypeSpeedParagraphs(typeSpeedParagraphCount)
    const fullText = paragraphs.join('\n\n')
    typeTestSession = {
      fullText,
      paragraphs,
      chunks: chunkTypeSpeedText(fullText, 72),
      paragraphCount: typeSpeedParagraphCount,
      sources: ['Local fallback text'],
      currentChunkIndex: 0,
      currentInput: '',
      startedAt: null,
      completedAt: null,
      totalTypedChars: 0,
      correctChars: 0
    }
    typeSpeedError = 'Could not load internet text, so a local fallback passage was used.'
  }

  if (requestId !== typeSpeedRequestId) return
  typeSpeedLoading = false
  typeSpeedInput.value = ''
  renderTypeSpeed()
  if (!typeSpeedPanel.hidden) {
    window.setTimeout(() => typeSpeedInput.focus(), 0)
  }
}

function handleTypeSpeedInput() {
  if (!typeTestSession) return

  const session = typeTestSession
  const targetChunk = session.chunks[session.currentChunkIndex] ?? ''
  const sanitizedValue = typeSpeedInput.value.replace(/\n/g, '').slice(0, targetChunk.length)

  if (!session.startedAt && sanitizedValue.length > 0) {
    session.startedAt = Date.now()
  }

  session.currentInput = sanitizedValue
  typeSpeedInput.value = sanitizedValue

  renderTypeSpeed()
}

function advanceTypeSpeedChunk() {
  if (!typeTestSession) return
  const session = typeTestSession
  const targetChunk = session.chunks[session.currentChunkIndex] ?? ''
  if (!targetChunk) return
  if (session.currentInput.length < targetChunk.length) return

  session.totalTypedChars += targetChunk.length
  session.correctChars += countMatchingChars(session.currentInput, targetChunk)
  session.currentChunkIndex += 1
  session.currentInput = ''
  typeSpeedInput.value = ''

  if (session.currentChunkIndex >= session.chunks.length) {
    session.completedAt = Date.now()
    typeSpeedInput.blur()
  }
  renderTypeSpeed()
}

function renderTypeSpeed() {
  const session = typeTestSession
  if (!session && !typeSpeedLoading) return

  if (typeSpeedLoading) {
    typeSpeedStats.innerHTML = `
      <div class="type-speed-stat">
        <span class="type-speed-stat-label">Progress</span>
        <strong>0%</strong>
      </div>
      <div class="type-speed-stat">
        <span class="type-speed-stat-label">Speed</span>
        <strong>0 WPM</strong>
      </div>
      <div class="type-speed-stat">
        <span class="type-speed-stat-label">Accuracy</span>
        <strong>100%</strong>
      </div>
      <div class="type-speed-stat">
        <span class="type-speed-stat-label">Paragraphs</span>
        <strong>${typeSpeedParagraphCount}</strong>
      </div>
    `
    typeSpeedTarget.innerHTML = '<span class="type-speed-finished">Loading a fresh passage from online sources...</span>'
    typeSpeedStatus.textContent = 'Fetching meaningful text from Wikipedia and building a varied typing passage.'
    typeSpeedInput.disabled = true
    typeSpeedInput.placeholder = 'Loading text...'
    typeSpeedText.innerHTML = ''
    return
  }

  if (!session) return

  const activeChunk = session.chunks[session.currentChunkIndex] ?? ''
  const completed = session.currentChunkIndex >= session.chunks.length
  const currentCorrect = countMatchingChars(session.currentInput, activeChunk)
  const typedChars = session.totalTypedChars + session.currentInput.length
  const correctChars = session.correctChars + currentCorrect
  const accuracy = typedChars > 0 ? Math.round((correctChars / typedChars) * 100) : 100
  const elapsedMs =
    session.startedAt === null
      ? 0
      : (session.completedAt ?? Date.now()) - session.startedAt
  const wpm = elapsedMs > 0 ? Math.round((correctChars / 5) / (elapsedMs / 60000)) : 0
  const progress = session.chunks.length
    ? Math.min(100, Math.round((session.currentChunkIndex / session.chunks.length) * 100))
    : 0

  typeSpeedStats.innerHTML = `
    <div class="type-speed-stat">
      <span class="type-speed-stat-label">Progress</span>
      <strong>${progress}%</strong>
    </div>
    <div class="type-speed-stat">
      <span class="type-speed-stat-label">Speed</span>
      <strong>${wpm} WPM</strong>
    </div>
    <div class="type-speed-stat">
      <span class="type-speed-stat-label">Accuracy</span>
      <strong>${accuracy}%</strong>
    </div>
    <div class="type-speed-stat">
      <span class="type-speed-stat-label">Paragraphs</span>
      <strong>${session.paragraphCount}</strong>
    </div>
  `

  typeSpeedTarget.innerHTML = completed
    ? `<span class="type-speed-finished">Finished. Your final score is <strong>${wpm} WPM</strong> at <strong>${accuracy}%</strong> accuracy.</span>`
    : renderTypeSpeedReferenceLine(activeChunk, session.currentInput)

  typeSpeedStatus.textContent = completed
    ? 'The test is complete. Generate a new passage to try again.'
    : `Line ${session.currentChunkIndex + 1} of ${session.chunks.length}. Type left to right and the input lane will move forward automatically.`

  typeSpeedInput.disabled = completed
  typeSpeedInput.placeholder = completed
    ? 'Generate a new text to type again.'
    : 'Start typing the highlighted line...'

  typeSpeedText.innerHTML = session.paragraphs
    .map((paragraph, index) => {
      const paragraphChunks = chunkTypeSpeedText(paragraph, 72)
      const paragraphStart = session.paragraphs
        .slice(0, index)
        .reduce((total, item) => total + chunkTypeSpeedText(item, 72).length, 0)

      const markup = paragraphChunks
        .map((chunk, chunkIndex) => {
          const globalIndex = paragraphStart + chunkIndex
          const classes = [
            'type-speed-text-line',
            globalIndex < session.currentChunkIndex ? 'is-complete' : '',
            globalIndex === session.currentChunkIndex && !completed ? 'is-active' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return `<span class="${classes}">${escapeHtml(chunk)}</span>`
        })
        .join('')

      return `<p class="type-speed-paragraph">${markup}</p>`
    })
    .join('')

  if (session.sources.length || typeSpeedError) {
    const sourceMarkup = session.sources
      .map((source) => `<span class="type-speed-source-pill">${escapeHtml(source)}</span>`)
      .join('')
    typeSpeedText.innerHTML = `
      <div class="type-speed-source-list">${sourceMarkup}</div>
      ${typeSpeedError ? `<p class="type-speed-source-note">${escapeHtml(typeSpeedError)}</p>` : ''}
      ${typeSpeedText.innerHTML}
    `
  }
}

function renderTypeSpeedReferenceLine(target: string, input: string) {
  const chars = target.split('')
  return chars
    .map((char, index) => {
      const typedChar = input[index]
      let className = 'pending'
      if (typedChar !== undefined) {
        className = typedChar === char ? 'correct' : 'incorrect'
      }
      return `<span class="type-speed-char ${className}">${escapeHtml(char)}</span>`
    })
    .join('')
}

function countMatchingChars(input: string, target: string) {
  let count = 0
  const limit = Math.min(input.length, target.length)
  for (let index = 0; index < limit; index += 1) {
    if (input[index] === target[index]) {
      count += 1
    }
  }
  return count
}

function chunkTypeSpeedText(text: string, maxLineLength: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const words = normalized.split(' ')
  const lines: string[] = []
  let currentLine = ''

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word
    if (nextLine.length <= maxLineLength || !currentLine) {
      currentLine = nextLine
      return
    }
    lines.push(currentLine)
    currentLine = word
  })

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

function buildTypeSpeedParagraphs(count: number) {
  return Array.from({ length: count }, (_, index) => createTypeSpeedParagraph(index))
}

function normalizeTypeSpeedParagraphCount(value: number) {
  if (!Number.isFinite(value)) return 10
  return Math.min(30, Math.max(1, Math.round(value)))
}

async function fetchMeaningfulTypeSpeedParagraphs(count: number) {
  const paragraphs: string[] = []
  const sources: string[] = []
  const seenParagraphs = new Set<string>()
  const maxAttempts = Math.max(6, count * 2)

  for (let attempt = 0; attempt < maxAttempts && paragraphs.length < count; attempt += 1) {
    const article = await fetchRandomWikipediaExtract()
    if (!article) continue

    const extractedParagraphs = extractMeaningfulParagraphs(article.extract)
    if (!extractedParagraphs.length) continue

    sources.push(article.title)
    const perArticleLimit = Math.max(2, Math.ceil(count / 4))
    for (const paragraph of extractedParagraphs.slice(0, perArticleLimit)) {
      const signature = paragraph.toLowerCase()
      if (seenParagraphs.has(signature)) continue
      seenParagraphs.add(signature)
      paragraphs.push(paragraph)
      if (paragraphs.length >= count) break
    }
  }

  let usedFallback = false
  if (paragraphs.length < count) {
    usedFallback = true
    const fallbackParagraphs = buildTypeSpeedParagraphs(count - paragraphs.length)
    paragraphs.push(...fallbackParagraphs)
  }

  return {
    paragraphs: paragraphs.slice(0, count),
    sources: sources.slice(0, 8),
    usedFallback
  }
}

async function fetchRandomWikipediaExtract() {
  const randomResponse = await fetch(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=1&origin=*'
  )
  if (!randomResponse.ok) return null

  const randomData = (await randomResponse.json()) as {
    query?: { random?: Array<{ title?: string }> }
  }
  const title = randomData.query?.random?.[0]?.title?.trim()
  if (!title) return null

  const extractUrl = new URL('https://en.wikipedia.org/w/api.php')
  extractUrl.searchParams.set('action', 'query')
  extractUrl.searchParams.set('format', 'json')
  extractUrl.searchParams.set('prop', 'extracts')
  extractUrl.searchParams.set('explaintext', '1')
  extractUrl.searchParams.set('redirects', '1')
  extractUrl.searchParams.set('titles', title)
  extractUrl.searchParams.set('origin', '*')

  const extractResponse = await fetch(extractUrl.toString())
  if (!extractResponse.ok) return null

  const extractData = (await extractResponse.json()) as {
    query?: {
      pages?: Record<string, { title?: string; extract?: string }>
    }
  }
  const page = Object.values(extractData.query?.pages ?? {})[0]
  const extract = page?.extract?.trim() ?? ''
  if (!extract) return null

  return {
    title: page?.title?.trim() || title,
    extract
  }
}

function extractMeaningfulParagraphs(extract: string) {
  return extract
    .split(/\n{1,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length >= 180)
    .filter((paragraph) => /[.?!]$/.test(paragraph))
    .filter((paragraph) => !/^[A-Z][A-Za-z\s-]{0,40}$/.test(paragraph))
}

function createTypeSpeedParagraph(seedOffset: number) {
  const openings = [
    'Morning light slid across the station floor while commuters traded silence for momentum.',
    'A careful engineer treats each tiny decision as part of a larger rhythm.',
    'Rain tapped the glass roof and turned the market into a soft chamber of echoes.',
    'Every creative project begins with an uncertain shape and a strong pulse.',
    'On the hillside trail, the city looked less like a machine and more like weather.'
  ]
  const middles = [
    'Vendors adjusted signs, folded paper, and spoke in bursts that felt almost musical.',
    'Ideas improved when they were handled patiently, tested honestly, and trimmed without drama.',
    'Children ran ahead, then circled back, discovering that distance can feel playful.',
    'The room settled when everyone finally agreed that clarity mattered more than speed.',
    'A cyclist coasted past the square, leaving only the sound of a thin rattling chain.',
    'Some details were ordinary, yet they carried enough texture to make the scene memorable.',
    'People who listened closely could notice patterns long before they became obvious.',
    'The plan did not need to be perfect to become useful; it only needed direction.'
  ]
  const closings = [
    'By the time the hour changed, the place felt sharper, calmer, and fully awake.',
    'That small shift made the entire day seem more deliberate.',
    'Nothing dramatic happened, but the atmosphere kept gathering meaning.',
    'The result was simple to describe and surprisingly hard to forget.',
    'In that moment, progress felt steady instead of loud.'
  ]

  const sentenceCount = 4 + ((Date.now() + seedOffset) % 2)
  const opening = pickSeeded(openings, seedOffset)
  const chosenMiddles = Array.from({ length: sentenceCount }, (_, index) =>
    pickSeeded(middles, seedOffset * 3 + index + 1)
  )
  const closing = pickSeeded(closings, seedOffset * 7 + 2)
  return [opening, ...chosenMiddles, closing].join(' ')
}

function pickSeeded(values: string[], seed: number) {
  const timeSeed = Number(String(Date.now()).slice(-6))
  const index = Math.abs((seed * 37 + timeSeed) % values.length)
  return values[index]
}

function toggleSelectedLineComments() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return

  const value = contentInput.value
  const selectionStart = contentInput.selectionStart
  const selectionEnd = contentInput.selectionEnd
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
  const lineEndIndex = value.indexOf('\n', selectionEnd)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const selectedBlock = value.slice(lineStart, lineEnd)
  const lines = selectedBlock.split('\n')
  const commentSyntax = node.format === 'latex'
    ? { prefix: '% ', suffix: '' }
    : { prefix: '<!-- ', suffix: ' -->' }
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
  const shouldUncomment =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => isLineCommented(line, commentSyntax.prefix, commentSyntax.suffix))

  const nextLines = lines.map((line) =>
    shouldUncomment
      ? uncommentLine(line, commentSyntax.prefix, commentSyntax.suffix)
      : commentLine(line, commentSyntax.prefix, commentSyntax.suffix)
  )
  const nextBlock = nextLines.join('\n')
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`

  contentInput.value = nextValue
  contentInput.selectionStart = lineStart
  contentInput.selectionEnd = lineStart + nextBlock.length
  contentInput.dispatchEvent(new Event('input', { bubbles: true }))
}

function toggleFolder(id?: string) {
  if (!id) return
  const set = new Set(state.expandedIds)
  if (set.has(id)) {
    set.delete(id)
  } else {
    const target = state.nodes.find((node) => node.id === id)
    if (target?.type === 'folder') {
      const siblingIds = state.nodes
        .filter((node) => node.type === 'folder' && node.parentId === target.parentId)
        .map((node) => node.id)
      siblingIds.forEach((siblingId) => set.delete(siblingId))
    }
    set.add(id)
  }
  state.expandedIds = Array.from(set)
  persistState()
  renderTree()
}

function selectNode(id?: string) {
  if (!id) return
  const selected = state.nodes.find((node) => node.id === id) ?? null
  if (selected?.type === 'folder') {
    toggleFolder(selected.id)
    state.selectedId = selected.id
  } else {
    state.selectedId = id
  }
  persistState()
  renderEditor()
  renderTree()
  renderPreview(getSelectedNode())
  if (selected?.type === 'prompt') {
    if (treeSearchQuery) {
      const titleMatch = selected.title.toLowerCase().includes(treeSearchQuery)
      const contentMatch = (selected.content ?? '').toLowerCase().includes(treeSearchQuery)
      if (contentMatch && !titleMatch) {
        openEditorSearchWithQuery(treeSearchQuery)
        return
      }
    }
    contentInput.focus()
  }
}

function openEditorSearchWithQuery(query: string) {
  editorBody.classList.add('is-search-open')
  editorSearchBar.hidden = false
  editorSearchInput.value = query
  editorSearchQuery = query
  syncEditorHighlightLayer()
  refreshEditorSearch()
  editorSearchInput.focus()
  editorSearchInput.select()
}

function normalizeLatexPackages(value: unknown) {
  const fallback = [...defaultState.latexPackages]
  if (!Array.isArray(value)) return fallback

  const supportedPackages = new Set(SUPPORTED_LATEX_PACKAGES)
  const packages = value.filter(
    (item): item is string => typeof item === 'string' && supportedPackages.has(item)
  )

  return packages.length ? Array.from(new Set(packages)) : fallback
}

function buildLatexPackageBlock(raw: string) {
  const requiredPackages = detectRequiredLatexPackages(raw)
  const requestedPackages = new Set([...state.latexPackages, ...requiredPackages])
  const packages = Array.from(requestedPackages).filter(
    (packageName) => !new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${escapeRegExp(packageName)}\\}`).test(raw)
  )

  return packages.map((packageName) => `\\usepackage{${packageName}}`).join('\n')
}

function detectRequiredLatexPackages(raw: string) {
  const required = new Set<string>()

  // Common AMS math environments need amsmath to render correctly.
  if (/\\begin\{(?:align\*?|gather\*?|multline\*?|flalign\*?|alignat\*?|split)\}/.test(raw)) {
    required.add('amsmath')
  }

  if (/\\(?:color|textcolor)\b/.test(raw)) {
    required.add('xcolor')
  }

  return Array.from(required)
}

function normalizeUnsupportedLatexEnvironments(raw: string) {
  // latex.js does not support amsmath display environments like align/gather/multline.
  // Convert them to plain display math so authored content still renders.
  return raw.replace(
    /\\begin\{(?:align\*?|gather\*?|multline\*?|flalign\*?|alignat\*?)\}([\s\S]*?)\\end\{(?:align\*?|gather\*?|multline\*?|flalign\*?|alignat\*?)\}/g,
    (_match, body: string) => {
      const normalizedBody = body
        .split('\n')
        .map((line) => line.replace(/^\s*&\s?/, '').replace(/\s*&\s?/g, ' '))
        .join('\n')
        .trim()
      return `\\[\n${normalizedBody}\n\\]`
    }
  )
}

function normalizeInlineColorCommands(raw: string) {
  // Normalize \textcolor first for engines that only handle grouped \color robustly.
  const normalizedTextcolor = raw.replace(
    /\\textcolor\{([^}]+)\}\{([\s\S]*?)\}/g,
    (_match, color: string, content: string) => `{{\\color{${color}}${content}}}`
  )

  // Normalize ungrouped spans such as:
  // \color{red}Some text\color{black}
  // into:
  // {\color{red}Some text}\color{black}
  return normalizedTextcolor.replace(
    /\\color\{([^}]+)\}([\s\S]*?)(?=\\color\{|\\end\{document\}|$)/g,
    (_match, color: string, content: string) => {
      const normalizedContent = content.trim()
      if (!normalizedContent) {
        return `\\color{${color}}`
      }
      return `{\\color{${color}}${normalizedContent}}`
    }
  )
}

function applyLatexColorFallback(page: HTMLElement, raw: string) {
  const spans = extractLatexColorSpans(raw)
  spans.forEach((span) => applyColorToFirstMatchingText(page, span.text, span.color))
}

function extractLatexColorSpans(raw: string) {
  const spans: Array<{ color: string; text: string }> = []

  const textcolorPattern = /\\textcolor\{([^}]+)\}\{([^{}]+)\}/g
  let textcolorMatch: RegExpExecArray | null = textcolorPattern.exec(raw)
  while (textcolorMatch) {
    spans.push({ color: textcolorMatch[1].trim(), text: textcolorMatch[2] })
    textcolorMatch = textcolorPattern.exec(raw)
  }

  const colorPattern = /\\color\{([^}]+)\}([\s\S]*?)(?=\\color\{|$)/g
  let colorMatch: RegExpExecArray | null = colorPattern.exec(raw)
  while (colorMatch) {
    const text = colorMatch[2].replace(/\s+/g, ' ').trim()
    if (text) {
      spans.push({ color: colorMatch[1].trim(), text })
    }
    colorMatch = colorPattern.exec(raw)
  }

  return spans
}

function applyColorToFirstMatchingText(root: HTMLElement, text: string, color: string) {
  const target = text.replace(/\s+/g, ' ').trim()
  if (!target) return

  const textNodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0
  let current = walker.nextNode() as Text | null
  while (current) {
    const value = current.textContent ?? ''
    const length = value.length
    textNodes.push({ node: current, start: cursor, end: cursor + length })
    cursor += length
    current = walker.nextNode() as Text | null
  }

  if (!textNodes.length) return

  const flattened = textNodes.map((entry) => entry.node.textContent ?? '').join('')
  const matchIndex = flattened.indexOf(target)
  if (matchIndex === -1) return

  const matchEnd = matchIndex + target.length
  const startEntry = textNodes.find((entry) => matchIndex >= entry.start && matchIndex < entry.end)
  const endEntry = textNodes.find((entry) => matchEnd > entry.start && matchEnd <= entry.end)
  if (!startEntry || !endEntry) return

  const range = document.createRange()
  range.setStart(startEntry.node, matchIndex - startEntry.start)
  range.setEnd(endEntry.node, matchEnd - endEntry.start)

  const wrapper = document.createElement('span')
  wrapper.style.color = color
  const extracted = range.extractContents()
  wrapper.appendChild(extracted)
  range.insertNode(wrapper)
}

function injectLatexPackagesIntoDocument(source: string, packageBlock: string) {
  if (!packageBlock) return source

  const beginDocumentPattern = /\\begin\{document\}/
  if (beginDocumentPattern.test(source)) {
    return source.replace(beginDocumentPattern, `${packageBlock}\n\\begin{document}`)
  }

  return `${source}\n${packageBlock}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isLineCommented(line: string, prefix: string, suffix: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (!trimmed.startsWith(prefix)) return false
  return suffix ? trimmed.endsWith(suffix) : true
}

function commentLine(line: string, prefix: string, suffix: string) {
  if (!line.trim()) return line

  const indent = line.match(/^\s*/)?.[0] ?? ''
  const content = line.slice(indent.length)
  return `${indent}${prefix}${content}${suffix}`
}

function uncommentLine(line: string, prefix: string, suffix: string) {
  if (!line.trim()) return line

  const indent = line.match(/^\s*/)?.[0] ?? ''
  let content = line.slice(indent.length)
  if (content.startsWith(prefix)) {
    content = content.slice(prefix.length)
  }
  if (suffix && content.endsWith(suffix)) {
    content = content.slice(0, -suffix.length)
  }
  return `${indent}${content}`
}

function scheduleHistorySnapshot(node: PromptNode) {
  if (!node || node.type !== 'prompt') return

  const nextStepCount = (pendingHistorySteps.get(node.id) ?? 0) + 1
  pendingHistorySteps.set(node.id, nextStepCount)

  const captureSnapshot = () => {
    const history = node.history ?? []
    const latest = history[history.length - 1]
    const currentContent = node.content ?? ''
    if (!latest || latest.content !== currentContent) {
      history.push({ timestamp: Date.now(), content: currentContent })
      if (history.length > HISTORY_LIMIT) {
        history.shift()
      }
      node.history = history
      persistState()
    }
    pendingHistorySteps.set(node.id, 0)
  }

  // Aggregate frequent small edits into larger snapshots.
  if (nextStepCount >= HISTORY_STEP_BATCH) {
    if (historyTimer) {
      window.clearTimeout(historyTimer)
      historyTimer = null
    }
    captureSnapshot()
    return
  }

  if (historyTimer) {
    window.clearTimeout(historyTimer)
  }
  historyTimer = window.setTimeout(() => {
    captureSnapshot()
  }, HISTORY_IDLE_FLUSH_MS)
}

function trimHistory(history: PromptHistoryEntry[]) {
  const nextHistory = [...history]
  while (nextHistory.length > HISTORY_LIMIT) {
    nextHistory.shift()
  }
  return nextHistory
}

function openHistory() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return
  const history = node.history ?? []
  if (!history.length) {
    historyBody.innerHTML = '<p>No history recorded yet.</p>'
  } else {
    historyBody.innerHTML = history
      .map((entry, index) => {
        const previous = index > 0 ? history[index - 1] : null
        const time = new Date(entry.timestamp).toLocaleString()
        const diff = buildHistoryDiff(entry.content, previous?.content ?? null)
        return `
          <div class="history-entry">
            <div class="history-topline">
              <div class="history-time">${time}</div>
              <div class="history-stats">
                <span class="history-stat add">+${diff.added}</span>
                <span class="history-stat remove">-${diff.removed}</span>
              </div>
            </div>
            <div class="history-summary">${escapeHtml(diff.summary)}</div>
            <div class="history-diff">${diff.lines}</div>
            <div class="history-actions">
              <button class="btn ghost history-action-btn" data-action="create-from-history" data-history-index="${index}">
                Copy This Version
              </button>
            </div>
          </div>
        `
      })
      .reverse()
      .join('')
  }
  historyPanel.hidden = false
}

function closeHistory() {
  historyPanel.hidden = true
}

function createPromptFromHistory(historyIndex?: string) {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return

  const index = Number(historyIndex)
  if (!Number.isInteger(index)) return

  const entry = node.history?.[index]
  if (!entry) return

  const now = Date.now()
  const duplicate: PromptNode = {
    id: crypto.randomUUID(),
    type: 'prompt',
    title: `${node.title} Snapshot`,
    parentId: node.parentId ?? getSelectedFolderId(),
    format: node.format ?? 'markdown',
    content: entry.content,
    createdAt: now,
    updatedAt: now,
    history: [{ timestamp: now, content: entry.content }]
  }

  state.nodes.push(duplicate)
  state.selectedId = duplicate.id
  persistState()
  closeHistory()
  render()
  titleInput.focus()
  titleInput.select()
}

function getSelectedNode() {
  if (!state.selectedId) return null
  return state.nodes.find((node) => node.id === state.selectedId) ?? null
}

function getSelectedFolderId() {
  const node = getSelectedNode()
  const folders = state.nodes.filter((item) => item.type === 'folder')
  if (!node) {
    if (!folders.length) {
      const folder = createRootFolder()
      return folder.id
    }
    return folders[0].id
  }
  if (node.type === 'folder') return node.id
  if (node.parentId) return node.parentId
  if (!folders.length) {
    const folder = createRootFolder()
    return folder.id
  }
  return folders[0].id
}

function enforceHierarchy() {
  let rootFolder = state.nodes.find((node) => node.type === 'folder' && node.parentId === null)
  if (!rootFolder) {
    rootFolder = createRootFolder()
  }

  state.nodes.forEach((node) => {
    if (node.type === 'folder') {
      node.parentId = null
    }
  })

  state.nodes.forEach((node) => {
    if (node.type === 'prompt' && node.parentId === null) {
      node.parentId = rootFolder!.id
    }
    if (node.type === 'prompt' && node.parentId) {
      const parentExists = state.nodes.some(
        (parent) => parent.id === node.parentId && parent.type === 'folder'
      )
      if (!parentExists) {
        node.parentId = rootFolder!.id
      }
    }
  })
}

function createRootFolder() {
  const now = Date.now()
  const folder: PromptNode = {
    id: crypto.randomUUID(),
    type: 'folder',
    title: 'Prompts',
    parentId: null,
    createdAt: now,
    updatedAt: now
  }
  state.nodes.push(folder)
  state.expandedIds = Array.from(new Set([...state.expandedIds, folder.id]))
  return folder
}

function isSelected(id: string) {
  return state.selectedId === id
}

function collectNodeIds(id: string) {
  const ids = [id]
  const children = state.nodes.filter((node) => node.parentId === id)
  children.forEach((child) => ids.push(...collectNodeIds(child.id)))
  return ids
}

function escapeHtml(value: string) {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}

function buildHistoryDiff(current: string, previous: string | null) {
  const currentLines = splitLines(current)
  const previousLines = splitLines(previous ?? '')

  if (previous === null) {
    const initialLines = currentLines.length
      ? currentLines.slice(0, 4).map((line) => renderDiffLine('+', line)).join('')
      : renderDiffLine(' ', '(empty)')

    return {
      added: currentLines.length,
      removed: 0,
      summary: 'Initial version',
      lines: initialLines
    }
  }

  const start = findCommonPrefix(previousLines, currentLines)
  const end = findCommonSuffix(previousLines, currentLines, start)
  const removedLines = previousLines.slice(start, previousLines.length - end)
  const addedLines = currentLines.slice(start, currentLines.length - end)
  const changedLines = [
    ...removedLines.slice(0, 3).map((line) => renderDiffLine('-', line)),
    ...addedLines.slice(0, 3).map((line) => renderDiffLine('+', line))
  ]

  return {
    added: addedLines.length,
    removed: removedLines.length,
    summary:
      addedLines.length || removedLines.length
        ? `${addedLines.length + removedLines.length} line change`
        : 'No content change',
    lines: changedLines.length ? changedLines.join('') : renderDiffLine(' ', 'No visible line changes')
  }
}

function splitLines(value: string) {
  return value.split('\n')
}

function findCommonPrefix(previousLines: string[], currentLines: string[]) {
  let index = 0
  while (
    index < previousLines.length &&
    index < currentLines.length &&
    previousLines[index] === currentLines[index]
  ) {
    index += 1
  }
  return index
}

function findCommonSuffix(previousLines: string[], currentLines: string[], start: number) {
  let index = 0
  while (
    previousLines.length - 1 - index >= start &&
    currentLines.length - 1 - index >= start &&
    previousLines[previousLines.length - 1 - index] === currentLines[currentLines.length - 1 - index]
  ) {
    index += 1
  }
  return index
}

function renderDiffLine(prefix: '+' | '-' | ' ', line: string) {
  const safeLine = escapeHtml(line || ' ')
  const kind =
    prefix === '+'
      ? 'add'
      : prefix === '-'
        ? 'remove'
        : 'context'

  return `<div class="history-line ${kind}"><span class="history-prefix">${prefix}</span><span class="history-code">${safeLine}</span></div>`
}

function syncCopyButtonLabel(button: HTMLButtonElement, label: string) {
  const labelNode = button.querySelector<HTMLElement>('.copy-btn-label')
  if (labelNode) {
    labelNode.textContent = label
  }
  if (!labelNode) {
    button.textContent = label
  }
}

function setCopyButtonState(
  button: HTMLButtonElement,
  label: string,
  className: 'is-copied' | 'is-error'
) {
  copyButtons.forEach((copyButton) => {
    copyButton.classList.remove('is-copied', 'is-error')
    syncCopyButtonLabel(copyButton, 'Copy')
  })

  activeCopyButton = button
  button.classList.add(className)
  syncCopyButtonLabel(button, label)

  if (copyFeedbackTimer) {
    window.clearTimeout(copyFeedbackTimer)
  }

  copyFeedbackTimer = window.setTimeout(() => {
    if (activeCopyButton) {
      activeCopyButton.classList.remove('is-copied', 'is-error')
      syncCopyButtonLabel(activeCopyButton, 'Copy')
      activeCopyButton = null
    }
  }, 1600)
}
