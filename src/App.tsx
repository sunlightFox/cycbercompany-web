import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Archive,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Copy,
  FileText,
  FolderKanban,
  Globe2,
  HardDrive,
  History,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { studioApi, streamRunEvents } from './lib/api'
import { useStudioStore } from './store/useStudioStore'
import type { Agent, Citation, RunEvent, RunStep, StudioMessage } from './types'
import './App.css'

const demoAgents: Agent[] = [
  {
    id: 'default-assistant',
    name: '研究助理',
    description: '整理资料、分析问题并给出可执行的结论。',
    systemPrompt: '',
    defaultModelProfileId: 'minimax-m3',
    toolAllowList: '',
    enabled: true,
  },
]

const demoModels = [{
  id: 'minimax-m3', providerType: 'OPENAI_COMPATIBLE', baseUrl: '', modelName: 'MiniMax-M3', credentialRef: '', apiKeyConfigured: false, apiKeyPreview: null, capabilities: ['TEXT'], enabled: true, defaultProfile: true,
}]

function IconButton({ label, children, onClick, active = false }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className={`icon-button ${active ? 'is-active' : ''}`} aria-label={label} type="button" onClick={onClick}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function App() {
  const { t, i18n } = useTranslation()
  const theme = useStudioStore((state) => state.theme)
  const sidebarOpen = useStudioStore((state) => state.sidebarOpen)
  const settingsOpen = useStudioStore((state) => state.settingsOpen)
  const sourceCitationId = useStudioStore((state) => state.sourceCitationId)
  const selectedAgentId = useStudioStore((state) => state.selectedAgentId)
  const conversationId = useStudioStore((state) => state.conversationId)
  const messages = useStudioStore((state) => state.messages)
  const agents = useStudioStore((state) => state.agents)
  const models = useStudioStore((state) => state.models)
  const backendAvailable = useStudioStore((state) => state.backendAvailable)
  const setTheme = useStudioStore((state) => state.setTheme)
  const toggleSidebar = useStudioStore((state) => state.toggleSidebar)
  const setSettingsOpen = useStudioStore((state) => state.setSettingsOpen)
  const setSourceCitationId = useStudioStore((state) => state.setSourceCitationId)
  const setSelectedAgentId = useStudioStore((state) => state.setSelectedAgentId)
  const setConversationId = useStudioStore((state) => state.setConversationId)
  const setMessages = useStudioStore((state) => state.setMessages)
  const setAgents = useStudioStore((state) => state.setAgents)
  const setModels = useStudioStore((state) => state.setModels)
  const setBackendAvailable = useStudioStore((state) => state.setBackendAvailable)
  const [prompt, setPrompt] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | number | null>(null)
  const [copiedId, setCopiedId] = useState<string | number | null>(null)
  const [managerTab, setManagerTab] = useState('agents')
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const availableAgents = agents.length ? agents : demoAgents
  const availableModels = models.length ? models : demoModels
  const currentAgent = availableAgents.find((agent) => agent.id === selectedAgentId) ?? availableAgents[0]
  const selectedCitation = messages.flatMap((message) => message.citations ?? []).find((citation) => citation.id === sourceCitationId)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = i18n.language === 'en' ? 'en' : 'zh-CN'
  }, [i18n.language, theme])

  useEffect(() => {
    let active = true
    Promise.all([studioApi.listAgents(), studioApi.listModels()])
      .then(([loadedAgents, loadedModels]) => {
        if (!active) return
        setAgents(loadedAgents)
        setModels(loadedModels)
        setBackendAvailable(true)
        if (loadedAgents[0] && !loadedAgents.some((agent) => agent.id === selectedAgentId)) setSelectedAgentId(loadedAgents[0].id)
      })
      .catch(() => {
        if (active) setBackendAvailable(false)
      })
    return () => { active = false }
  }, [selectedAgentId, setAgents, setBackendAvailable, setModels, setSelectedAgentId])

  const resetTask = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setConversationId(null)
    setMessages([])
    setPrompt('')
    setSourceCitationId(null)
    textareaRef.current?.focus()
  }, [setConversationId, setMessages, setSourceCitationId])

  const updateAssistant = useCallback((runId: string, updater: (message: StudioMessage) => StudioMessage) => {
    setMessages(useStudioStore.getState().messages.map((message) => message.runId === runId ? updater(message) : message))
  }, [setMessages])

  const handleRunEvent = useCallback((runId: string, event: RunEvent) => {
    updateAssistant(runId, (message) => {
      const steps = [...(message.steps ?? [])]
      const completePrevious = (label?: string) => steps.map((step) => step.status === 'running' ? { ...step, status: 'complete' as const, duration: step.duration ?? 'done', label: label && step.label === t('executeEmployee') ? label : step.label } : step)
      if (event.type === 'RUN_STARTED') {
        if (!steps.length) steps.push({ id: `${runId}-start`, label: t('startCoordinator'), status: 'complete', duration: 'ready' })
      }
      if (event.type === 'STEP_STARTED') {
        steps.push({ id: `${runId}-agent`, label: t('executeEmployee'), detail: event.payload, status: 'running' })
      }
      if (event.type === 'RETRIEVAL_COMPLETED') {
        const next = completePrevious()
        next.push({ id: `${runId}-answer`, label: t('organizeAnswer'), status: 'running' })
        steps.splice(0, steps.length, ...next)
      }
      if (event.type === 'TOKEN_DELTA') {
        const next = steps.length ? steps : [{ id: `${runId}-answer`, label: t('organizeAnswer'), status: 'running' as const }]
        return { ...message, content: `${message.content}${event.payload}`, steps: next, isStreaming: true }
      }
      if (event.type === 'STEP_COMPLETED') {
        steps.splice(0, steps.length, ...completePrevious())
      }
      if (event.type === 'FINAL_ANSWER') {
        const next = completePrevious()
        return { ...message, content: event.payload || message.content, steps: next, isStreaming: false }
      }
      if (event.type === 'RUN_FAILED' || event.type === 'RUN_CANCELLED') {
        return { ...message, steps: completePrevious(), isStreaming: false, error: event.payload || 'Run failed' }
      }
      return { ...message, steps }
    })
  }, [t, updateAssistant])

  const ensureConversation = useCallback(async () => {
    const state = useStudioStore.getState()
    if (state.conversationId) return state.conversationId
    const result = await studioApi.createConversation(t('newTask'))
    setConversationId(result.id)
    return result.id
  }, [setConversationId, t])

  const handleSend = useCallback(async () => {
    const text = prompt.trim()
    if (!text || isRunning) return
    setPrompt('')
    setIsRunning(true)
    const userMessage: StudioMessage = { id: `user-${Date.now()}`, role: 'USER', content: text, createdAt: new Date().toISOString() }
    const runId = `pending-${Date.now()}`
    const assistantMessage: StudioMessage = { id: `assistant-${Date.now()}`, role: 'ASSISTANT', content: '', runId, steps: [], isStreaming: true, createdAt: new Date().toISOString() }
    setMessages([...useStudioStore.getState().messages, userMessage, assistantMessage])
    try {
      const conversation = await ensureConversation()
      const run = await studioApi.createRun({ conversationId: conversation, text, agentId: currentAgent?.id, modelProfileId: currentAgent?.defaultModelProfileId })
      updateAssistant(runId, (message) => ({ ...message, runId: run.runId }))
      const controller = new AbortController()
      abortRef.current = controller
      await streamRunEvents(run.runId, (event) => handleRunEvent(run.runId, event), controller.signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateAssistant(runId, (assistant) => ({ ...assistant, isStreaming: false, error: backendAvailable ? message : '后端尚未启动，请先运行 Spring Agent Studio。' }))
    } finally {
      abortRef.current = null
      setIsRunning(false)
    }
  }, [backendAvailable, currentAgent?.defaultModelProfileId, currentAgent?.id, ensureConversation, handleRunEvent, isRunning, prompt, setMessages, updateAssistant])

  const handleCopy = async (message: StudioMessage) => {
    await navigator.clipboard?.writeText(message.content)
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId(null), 1600)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="studio-shell">
        <Sidebar expanded={sidebarExpanded} mobileOpen={sidebarOpen} onExpandedChange={setSidebarExpanded} onNewTask={resetTask} onCloseMobile={toggleSidebar} t={t} />
        <main className="studio-main">
          <header className="topbar">
            <div className="topbar-leading">
              <IconButton label={t('workspace')} onClick={toggleSidebar}><Menu size={18} /></IconButton>
              <div className="conversation-title"><span className="status-dot" data-online={backendAvailable} /> <span>{conversationId ? t('newTask') : t('workspace')}</span></div>
            </div>
            <div className="topbar-actions">
              <AgentSelect agents={availableAgents} currentAgent={currentAgent} onChange={setSelectedAgentId} t={t} />
              <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
                <Dialog.Trigger asChild><button className="manage-button" type="button"><Settings2 size={15} /> <span>{t('manage')}</span></button></Dialog.Trigger>
                <ManagerDialog tab={managerTab} setTab={setManagerTab} agents={availableAgents} models={availableModels} t={t} />
              </Dialog.Root>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button className="icon-button" aria-label={t('more')} type="button"><MoreHorizontal size={18} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content className="menu" align="end" sideOffset={8}>
                  <DropdownMenu.Label className="menu-label">{t('settings')}</DropdownMenu.Label>
                  <DropdownMenu.Item className="menu-item" onSelect={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />} {theme === 'light' ? t('dark') : t('light')}</DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={() => void i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')}>{i18n.language === 'zh' ? t('english') : t('chinese')}</DropdownMenu.Item>
                  <DropdownMenu.Separator className="menu-separator" />
                  <DropdownMenu.Item className="menu-item" onSelect={resetTask}><Plus size={15} /> {t('newTask')}</DropdownMenu.Item>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>
          <section className="conversation-stage" aria-live="polite">
            <div className="message-feed">
              {messages.length === 0 ? <EmptyState onPrompt={(value) => { setPrompt(value); textareaRef.current?.focus() }} t={t} /> : messages.map((message) => <MessageBlock key={message.id} message={message} expanded={expandedMessageId === message.id} onToggle={() => setExpandedMessageId(expandedMessageId === message.id ? null : message.id)} onCitation={setSourceCitationId} onCopy={() => void handleCopy(message)} copied={copiedId === message.id} t={t} />)}
            </div>
          </section>
          <Composer value={prompt} onChange={setPrompt} onKeyDown={handleKeyDown} onSend={() => void handleSend()} onStop={() => abortRef.current?.abort()} running={isRunning} textareaRef={textareaRef} t={t} />
          <div className="connection-note"><span className="status-dot" data-online={backendAvailable} /> {backendAvailable ? t('backendOnline') : t('backendOffline')}</div>
        </main>
        {selectedCitation ? <CitationDrawer citation={selectedCitation} onClose={() => setSourceCitationId(null)} t={t} /> : null}
      </div>
    </Tooltip.Provider>
  )
}

function Sidebar({ expanded, mobileOpen, onExpandedChange, onNewTask, onCloseMobile, t }: { expanded: boolean; mobileOpen: boolean; onExpandedChange: (open: boolean) => void; onNewTask: () => void; onCloseMobile: () => void; t: (key: string) => string }) {
  return <aside className={`sidebar ${expanded ? 'is-expanded' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`} onMouseEnter={() => onExpandedChange(true)} onMouseLeave={() => onExpandedChange(false)}>
    <div className="sidebar-brand"><div className="brand-mark"><Sparkles size={15} /></div>{expanded ? <span>Studio</span> : null}<button className="mobile-close" onClick={onCloseMobile} type="button" aria-label={t('close')}><X size={17} /></button></div>
    <nav className="sidebar-nav" aria-label={t('workspace')}>
      <button className="nav-button is-current" type="button" onClick={onNewTask}><Plus size={18} /><span>{t('newTask')}</span></button>
      <button className="nav-button" type="button"><Search size={18} /><span>{t('search')}</span></button>
      <button className="nav-button" type="button"><History size={18} /><span>{t('history')}</span></button>
    </nav>
    <div className="sidebar-spacer" />
    <nav className="sidebar-nav sidebar-bottom">
      <button className="nav-button" type="button"><FolderKanban size={18} /><span>{t('manage')}</span></button>
      <button className="nav-button" type="button"><Settings2 size={18} /><span>{t('settings')}</span></button>
    </nav>
  </aside>
}

function AgentSelect({ agents, currentAgent, onChange, t }: { agents: Agent[]; currentAgent?: Agent; onChange: (id: string) => void; t: (key: string) => string }) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="agent-trigger" type="button"><span className="agent-avatar"><Bot size={15} /></span><span className="agent-trigger-copy"><small>{t('digitalEmployee')}</small><strong>{currentAgent?.name ?? t('digitalEmployee')}</strong></span><ChevronDown size={14} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu agent-menu" align="end" sideOffset={8}>{agents.map((agent) => <DropdownMenu.Item key={agent.id} className="agent-option" onSelect={() => onChange(agent.id)}><span className="agent-avatar"><Bot size={14} /></span><span><strong>{agent.name}</strong><small>{agent.description}</small></span></DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}

function EmptyState({ onPrompt, t }: { onPrompt: (prompt: string) => void; t: (key: string) => string }) {
  const suggestions = [t('suggestion1'), t('suggestion2'), t('suggestion3')]
  return <div className="empty-state"><div className="empty-glyph"><Sparkles size={18} /></div><h1>{t('emptyTitle')}</h1><p>{t('emptyHint')}</p><div className="suggestion-row">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => onPrompt(suggestion)}>{suggestion}<ArrowUp size={13} /></button>)}</div></div>
}

function MessageBlock({ message, expanded, onToggle, onCitation, onCopy, copied, t }: { message: StudioMessage; expanded: boolean; onToggle: () => void; onCitation: (id: string) => void; onCopy: () => void; copied: boolean; t: (key: string) => string }) {
  if (message.role === 'USER') return <article className="message-row user-row"><div className="user-bubble">{message.content}</div></article>
  const steps = message.steps ?? []
  const hasRunning = steps.some((step) => step.status === 'running') || message.isStreaming
  const isCollapsed = !expanded && !hasRunning
  return <article className={`message-row assistant-row ${message.error ? 'has-error' : ''}`}>
    {steps.length ? <div className="execution-block"><button className="execution-summary" type="button" onClick={onToggle} aria-expanded={!isCollapsed}><span className={`execution-icon ${hasRunning ? 'is-running' : 'is-complete'}`}>{hasRunning ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}</span><span>{hasRunning ? t('running') : t('completed')} {steps.length} {t('stepCount')}</span><span className="execution-meta">{isCollapsed ? '· ' : ''}{hasRunning ? '' : '12 ' + t('seconds')}</span><ChevronRight size={15} className={`execution-chevron ${!isCollapsed ? 'is-open' : ''}`} /></button>{!isCollapsed ? <div className="step-list">{steps.map((step) => <StepRow key={step.id} step={step} />)}</div> : null}</div> : null}
    {message.content ? <div className="assistant-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div> : message.isStreaming ? <div className="typing-line"><span /><span /><span /></div> : null}
    {message.error ? <div className="run-error"><ShieldCheck size={15} /> {message.error}</div> : null}
    {message.citations?.length ? <div className="citation-row">{message.citations.map((citation, index) => <button type="button" key={citation.id} onClick={() => onCitation(citation.id)} aria-label={`${t('viewSources')} ${index + 1}`}>[{index + 1}]</button>)}</div> : null}
    {message.content ? <div className="message-actions"><button type="button" onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('copied') : t('copy')}</button><button type="button"><Archive size={14} /> {t('more')}</button></div> : null}
  </article>
}

function StepRow({ step }: { step: RunStep }) {
  return <button className="step-row" type="button"><span className={`step-status ${step.status}`}>{step.status === 'running' ? <LoaderCircle size={13} className="spin" /> : step.status === 'failed' ? <X size={13} /> : <Check size={13} />}</span><span className="step-label">{step.label}</span>{step.detail ? <span className="step-detail">{step.detail}</span> : null}<span className="step-duration">{step.duration ?? (step.status === 'running' ? '…' : '')}</span></button>
}

function Composer({ value, onChange, onKeyDown, onSend, onStop, running, textareaRef, t }: { value: string; onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onSend: () => void; onStop: () => void; running: boolean; textareaRef: React.RefObject<HTMLTextAreaElement | null>; t: (key: string) => string }) {
  return <div className="composer-wrap"><div className="composer"><div className="composer-toolbar"><button type="button" className="composer-icon" aria-label={t('attach')}><Plus size={17} /></button><button type="button" className="capability-button"><Zap size={14} /> {t('chooseCapability')}</button><span className="composer-spacer" /><span className="composer-hint">⌘↵</span></div><textarea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} placeholder={t('placeholder')} rows={1} aria-label={t('placeholder')} /><div className="composer-footer"><span className="composer-context"><span className="context-dot" /> {t('digitalEmployee')}</span>{running ? <button type="button" className="send-button stop-button" onClick={onStop} aria-label={t('stop')}><CircleStop size={17} /></button> : <button type="button" className="send-button" onClick={onSend} disabled={!value.trim()} aria-label={t('send')}><ArrowUp size={17} /></button>}</div></div></div>
}

function CitationDrawer({ citation, onClose, t }: { citation: Citation; onClose: () => void; t: (key: string) => string }) {
  return <div className="citation-drawer"><div className="drawer-header"><div><small>{t('sources')}</small><h2>{citation.title}</h2></div><IconButton label={t('close')} onClick={onClose}><X size={17} /></IconButton></div><div className="drawer-body"><div className="source-type"><FileText size={15} /> {citation.source}</div><blockquote>{citation.quote}</blockquote>{citation.location ? <p className="source-location">{citation.location}</p> : null}</div></div>
}

function ManagerDialog({ tab, setTab, agents, models, t }: { tab: string; setTab: (tab: string) => void; agents: Agent[]; models: { id: string; modelName: string; providerType: string; defaultProfile: boolean }[]; t: (key: string) => string }) {
  const tabs = [{ id: 'agents', icon: Bot, label: t('agents') }, { id: 'skills', icon: Sparkles, label: t('skills') }, { id: 'mcp', icon: Globe2, label: t('mcp') }, { id: 'knowledge', icon: FileText, label: t('knowledge') }, { id: 'models', icon: TerminalSquare, label: t('models') }, { id: 'nodes', icon: HardDrive, label: t('nodes') }]
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="manager-dialog">
        <div className="dialog-header">
          <div><Dialog.Title>{t('configuration')}</Dialog.Title><Dialog.Description>{t('manageHint')}</Dialog.Description></div>
          <Dialog.Close asChild><IconButton label={t('close')}><X size={17} /></IconButton></Dialog.Close>
        </div>
        <Tabs.Root value={tab} onValueChange={setTab} orientation="vertical" className="manager-tabs">
          <Tabs.List className="manager-tab-list">
            {tabs.map(({ id, icon: Icon, label }) => <Tabs.Trigger value={id} key={id} className="manager-tab"><Icon size={16} /> {label}</Tabs.Trigger>)}
          </Tabs.List>
          <div className="manager-panel">
            {tabs.map(({ id, label }) => <Tabs.Content value={id} key={id} className="manager-content">
              <div className="panel-heading">
                <div><h3>{label}</h3><p>{id === 'agents' ? t('selectEmployeeHint') : t('comingSoon')}</p></div>
                <button type="button" className="secondary-button"><Plus size={15} /> {t('add')}</button>
              </div>
              {id === 'agents' ? <div className="manager-list">{agents.map((agent) => <div className="manager-list-item" key={agent.id}>
                <span className="agent-avatar"><Bot size={15} /></span><div><strong>{agent.name}</strong><span>{agent.description}</span></div>
                <span className="list-status"><span className="status-dot" data-online={agent.enabled} /> {agent.enabled ? t('online') : t('disabled')}</span>
              </div>)}</div> : id === 'models' ? <div className="manager-list">{models.map((model) => <div className="manager-list-item" key={model.id}>
                <span className="model-glyph"><TerminalSquare size={15} /></span><div><strong>{model.modelName}</strong><span>{model.providerType}</span></div>
                <span className="list-status">{model.defaultProfile ? t('default') : ''}</span>
              </div>)}</div> : <div className="manager-placeholder"><Settings2 size={19} /><span>{t('comingSoon')}</span></div>}
            </Tabs.Content>)}
          </div>
        </Tabs.Root>
        <div className="dialog-footer"><Dialog.Close asChild><button type="button" className="secondary-button">{t('close')}</button></Dialog.Close><button type="button" className="primary-button">{t('save')}</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export default App
