import './style.css'
import 'katex/dist/katex.min.css'
import '../node_modules/latex.js/dist/css/base.css'
import DOMPurify from 'dompurify'
import renderMathInElement from 'katex/contrib/auto-render'
import { HtmlGenerator, parse } from '../node_modules/latex.js/dist/latex.mjs'
import { marked } from 'marked'

type NodeType = 'folder' | 'prompt'
type PromptFormat = 'markdown' | 'latex'

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
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span class="brand-glyph"></span>
        </div>
        <div>
          <h1>PrEditor</h1>
        </div>
      </div>
      <div class="sidebar-actions">
        <button class="btn primary" data-action="new-prompt">New</button>
        <button class="btn" data-action="new-folder">Folder</button>
        <button class="btn" data-action="import-state">Import</button>
        <button class="btn" data-action="open-export-confirm">Export</button>
      </div>
      <div class="sidebar-search">
        <input type="search" data-tree-search placeholder="search..." aria-label="Search files and folders" />
        <button class="search-clear-btn" data-action="clear-tree-search" type="button" aria-label="Clear search" hidden></button>
      </div>
      <div class="sidebar-icons" aria-label="Quick actions">
        <button class="icon-btn" data-action="new-folder" aria-label="New folder">
          <span class="icon folder"></span>
        </button>
        <button class="icon-btn" data-action="new-prompt" aria-label="New prompt">
          <span class="icon prompt"></span>
        </button>
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
      <div class="editor-header">
        <div class="field">
          <input id="title" type="text" placeholder="Untitled" />
        </div>
        <div class="editor-actions">
          <div class="format-toggle">
            <button class="btn format-btn" data-action="set-format" data-format="markdown">Markdown</button>
            <button class="btn format-btn" data-action="set-format" data-format="latex">LaTeX</button>
          </div>
          <div class="package-toggle" data-package-toggle hidden>
            <div class="package-menu" data-package-menu>
              <button class="btn package-btn" data-action="toggle-package-menu" data-package-summary aria-expanded="false">
                Select packages
              </button>
              <div class="package-menu-list" data-package-list hidden></div>
            </div>
          </div>
        </div>
      </div>
      <div class="editor-body">
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
        <h2>Preview</h2>
        <div class="preview-actions">
          <button class="btn preview-btn" data-action="evaluate-prompt">Evaluate</button>
          <button class="btn preview-btn" data-action="copy-prompt" data-copy-button>Copy</button>
        </div>
      </div>
      <div class="preview-body" data-preview-body></div>
    </section>

    <div class="editor-footer">
      <div class="meta" data-meta>
        <span data-created></span>
        <button class="btn ghost" data-action="view-history">History</button>
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
const previewToggleChip = app.querySelector<HTMLButtonElement>('[data-toggle-chip="preview"]')!
const formatButtons = app.querySelectorAll<HTMLButtonElement>('[data-action="set-format"]')
const panelResizer = app.querySelector<HTMLDivElement>('[data-resizer]')!
const previewBody = app.querySelector<HTMLDivElement>('[data-preview-body]')!
const previewToggles = app.querySelectorAll<HTMLButtonElement>('[data-action="toggle-preview"]')
const themeToggle = app.querySelector<HTMLButtonElement>('[data-action="toggle-theme"]')!
const packageToggle = app.querySelector<HTMLDivElement>('[data-package-toggle]')!
const packageMenu = app.querySelector<HTMLDivElement>('[data-package-menu]')!
const packageSummary = app.querySelector<HTMLButtonElement>('[data-package-summary]')!
const packageList = app.querySelector<HTMLDivElement>('[data-package-list]')!
const historyPanel = app.querySelector<HTMLDivElement>('[data-history]')!
const historyBody = app.querySelector<HTMLDivElement>('[data-history-body]')!
const confirmDeletePanel = app.querySelector<HTMLDivElement>('[data-confirm-delete]')!
const confirmDeleteCopy = app.querySelector<HTMLParagraphElement>('[data-confirm-copy]')!
const confirmExportPanel = app.querySelector<HTMLDivElement>('[data-confirm-export]')!
const importInput = app.querySelector<HTMLInputElement>('[data-import-input]')!
const treeSearchInput = app.querySelector<HTMLInputElement>('[data-tree-search]')!
const clearSearchButton = app.querySelector<HTMLButtonElement>('[data-action="clear-tree-search"]')!

let historyTimer: number | null = null
let copyFeedbackTimer: number | null = null
let activeCopyButton: HTMLButtonElement | null = null
let pendingDeleteId: string | null = null
const pendingHistorySteps = new Map<string, number>()
let treeSearchQuery = ''

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

syncSearchClearButton()
initializeState()
initializePreviewResize()
render()

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
    case 'evaluate-prompt':
      evaluateSelectedPrompt()
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
    case 'import-state':
      importInput.click()
      break
    case 'toggle-expand':
      toggleFolder(actionElement?.dataset.id)
      break
    case 'delete-node':
      openDeleteConfirm(actionElement?.dataset.id)
      break
    case 'select':
      selectNode(actionElement?.dataset.id)
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

contentInput.addEventListener('input', () => {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return
  node.content = contentInput.value
  node.updatedAt = Date.now()
  scheduleHistorySnapshot(node)
  persistState()
  renderPreview(node)
  renderMeta(node)
})

contentInput.addEventListener('keydown', (event) => {
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
  persistState()
}

function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return structuredClone(defaultState)
  try {
    const parsed = JSON.parse(raw) as Partial<AppState> & { showPreview?: boolean }
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
      return structuredClone(defaultState)
    }
    const mergedState: AppState = { ...structuredClone(defaultState), ...parsed }
    if (!('viewMode' in parsed) && typeof parsed.showPreview === 'boolean') {
      mergedState.viewMode = parsed.showPreview ? 'split' : 'edit'
    }
    mergedState.viewMode = normalizeViewMode(mergedState.viewMode)
    return mergedState
  } catch {
    return structuredClone(defaultState)
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
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
          <span class="tree-chevron">▸</span>
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
    const promptIconClass = node.format === 'latex' ? 'file-latex' : 'file-markdown'
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
  titleInput.value = node?.title ?? ''
  titleInput.disabled = !node
  contentInput.value = isPrompt ? node.content ?? '' : ''
  contentInput.placeholder = node?.format === 'latex' ? '\\int_0^1 x^2 \\, dx' : 'Write...'
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
  renderMeta(node)
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
    previewBody.classList.add('latex-preview')
    previewBody.innerHTML = renderLatexPreview(raw)
    return
  }
  previewBody.classList.remove('latex-preview')
  const html = marked.parse(raw, { async: false }) as string
  previewBody.innerHTML = sanitizeMarkdownHtml(html)
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
  if (node.type !== 'prompt' || node.format !== 'markdown') return

  const taskCheckboxes = previewBody.querySelectorAll<HTMLInputElement>(
    'li > input[type="checkbox"], li input[type="checkbox"]'
  )

  taskCheckboxes.forEach((checkbox, index) => {
    checkbox.disabled = false
    checkbox.dataset.taskIndex = String(index)
    checkbox.addEventListener('change', () => {
      const targetIndex = Number(checkbox.dataset.taskIndex)
      if (!Number.isInteger(targetIndex)) return

      const nextContent = toggleMarkdownTaskAtIndex(node.content ?? '', targetIndex, checkbox.checked)
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
  } else {
    state.selectedId = node.id
    state.expandedIds = Array.from(new Set([...state.expandedIds, node.id]))
  }
  persistState()
  render()
  titleInput.focus()
  titleInput.select()
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
      type === 'prompt' ? (node.format === 'latex' ? 'latex' : 'markdown') : undefined,
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

function evaluateSelectedPrompt() {
  const node = getSelectedNode()
  if (!node || node.type !== 'prompt') return

  const content = node.content?.trim() ?? ''
  if (!content) {
    alert('Write a prompt first, then evaluate it.')
    return
  }

  const score = [
    content.length > 80 ? 'strong detail' : 'more detail needed',
    /\b(output|format|json|table|list|steps)\b/i.test(content)
      ? 'clear output format'
      : 'unclear output format',
    /\b(context|goal|audience|constraints|tone)\b/i.test(content)
      ? 'good context'
      : 'missing context'
  ]

  alert(`Prompt check:\n- ${score.join('\n- ')}`)
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
    contentInput.focus()
  }
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
