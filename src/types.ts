export type Role = 'USER' | 'ASSISTANT'

export type Agent = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultModelProfileId: string
  toolAllowList: string
  enabled: boolean
}

export type ModelProfile = {
  id: string
  providerType: string
  baseUrl: string
  modelName: string
  credentialRef: string
  apiKeyConfigured: boolean
  apiKeyPreview: string | null
  capabilities: string[]
  enabled: boolean
  defaultProfile: boolean
}

export type Message = {
  id: number | string
  role: Role
  content: string
  runId?: string | null
  createdAt?: string
}

export type Conversation = {
  id: string
  title: string
  createdAt?: string
  messages: Message[]
}

export type RunEvent = {
  sequence: number
  type: 'RUN_STARTED' | 'STEP_STARTED' | 'RETRIEVAL_COMPLETED' | 'TOKEN_DELTA' | 'STEP_COMPLETED' | 'FINAL_ANSWER' | 'RUN_FAILED' | 'RUN_CANCELLED'
  payload: string
  createdAt?: string
}

export type CreateRunResponse = {
  runId: string
  status: string
  eventsUrl: string
}

export type StepStatus = 'running' | 'complete' | 'failed'

export type RunStep = {
  id: string
  label: string
  detail?: string
  status: StepStatus
  duration?: string
}

export type Citation = {
  id: string
  source: string
  title: string
  quote: string
  location?: string
  type: 'knowledge' | 'web' | 'mcp'
}

export type StudioMessage = Message & {
  steps?: RunStep[]
  citations?: Citation[]
  isStreaming?: boolean
  error?: string
}
