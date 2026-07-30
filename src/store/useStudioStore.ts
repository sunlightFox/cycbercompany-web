import { create } from 'zustand'
import type { Agent, ModelProfile, StudioMessage } from '../types'

type Theme = 'light' | 'dark'

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
  setSettingsOpen: (open: boolean) => void
  setSourceCitationId: (id: string | null) => void
  setSelectedAgentId: (id: string) => void
  setConversationId: (id: string | null) => void
  setMessages: (messages: StudioMessage[]) => void
  setAgents: (agents: Agent[]) => void
  setModels: (models: ModelProfile[]) => void
  setBackendAvailable: (available: boolean) => void
}

const storedTheme = localStorage.getItem('studio-theme')

export const useStudioStore = create<StudioState>((set) => ({
  theme: storedTheme === 'dark' ? 'dark' : 'light',
  sidebarOpen: false,
  settingsOpen: false,
  sourceCitationId: null,
  selectedAgentId: 'default-assistant',
  conversationId: null,
  messages: [],
  agents: [],
  models: [],
  backendAvailable: false,
  setTheme: (theme) => {
    localStorage.setItem('studio-theme', theme)
    set({ theme })
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSourceCitationId: (sourceCitationId) => set({ sourceCitationId }),
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
  setConversationId: (conversationId) => set({ conversationId }),
  setMessages: (messages) => set({ messages }),
  setAgents: (agents) => set({ agents }),
  setModels: (models) => set({ models }),
  setBackendAvailable: (backendAvailable) => set({ backendAvailable }),
}))
