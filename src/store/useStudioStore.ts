import { create } from 'zustand'
import type { Agent, ModelProfile, StudioMessage } from '../types'

type Theme = 'light' | 'dark'
type MessageUpdate = StudioMessage[] | ((messages: StudioMessage[]) => StudioMessage[])

type StudioState = {
  theme: Theme
  sidebarOpen: boolean
  settingsOpen: boolean
  sourceCitationId: string | null
  selectedAgentId: string
  conversationId: string | null
  messages: StudioMessage[]
  agents: Agent[]
  models: ModelProfile[]
  backendAvailable: boolean
  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSourceCitationId: (id: string | null) => void
  setSelectedAgentId: (id: string) => void
  setConversationId: (id: string | null) => void
  setMessages: (messages: MessageUpdate) => void
  setAgents: (agents: Agent[]) => void
  setModels: (models: ModelProfile[]) => void
  setBackendAvailable: (available: boolean) => void
}

const storedTheme = localStorage.getItem('studio-theme')
const storedConversationId = localStorage.getItem('studio-active-conversation')

export const useStudioStore = create<StudioState>((set) => ({
  theme: storedTheme === 'dark' ? 'dark' : 'light',
  sidebarOpen: false,
  settingsOpen: false,
  sourceCitationId: null,
  selectedAgentId: 'default-assistant',
  conversationId: storedConversationId || null,
  messages: [],
  agents: [],
  models: [],
  backendAvailable: false,
  setTheme: (theme) => {
    localStorage.setItem('studio-theme', theme)
    set({ theme })
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSourceCitationId: (sourceCitationId) => set({ sourceCitationId }),
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
  setConversationId: (conversationId) => {
    if (conversationId) localStorage.setItem('studio-active-conversation', conversationId)
    else localStorage.removeItem('studio-active-conversation')
    set({ conversationId })
  },
  setMessages: (update) => set((state) => ({
    messages: typeof update === 'function' ? update(state.messages) : update,
  })),
  setAgents: (agents) => set({ agents }),
  setModels: (models) => set({ models }),
  setBackendAvailable: (backendAvailable) => set({ backendAvailable }),
}))
