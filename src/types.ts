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

export type ModelCapability = 'TEXT' | 'VISION' | 'AUDIO_INPUT' | 'TOOLS' | 'JSON_OUTPUT' | 'EMBEDDING'

export type ModelPreset = {
  id: string
  providerName: string
  displayName: string
  providerType: string
  baseUrl: string
  modelName: string
  credentialRef: string
  capabilities: ModelCapability[]
  notes: string
}

export type ModelSettings = {
  defaultModelProfileId: string
}

export type ModelTestResult = {
  modelProfileId: string
  success: boolean
  message: string
  responsePreview?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  rawModel?: string | null
}

export type Tool = {
  name: string
  description: string
  riskLevel: string
  requiresApproval: boolean
}

export type Skill = {
  id: string
  name: string
  description: string
  enabled: boolean
  installedAt?: string
  sourceRepository?: string
  sourceUrl?: string
  ref?: string
  path?: string
  fileCount?: number
  sizeBytes?: number
}

export type SkillRepository = {
  id: string
  name: string
  description: string
  url: string
  defaultBranch: string
  stars: number
  sourceType: string
}

export type RepositorySkill = {
  name: string
  description: string
  repositoryUrl: string
  ref: string
  path: string
  installId: string
}

export type McpConnection = {
  id: string
  name: string
  description?: string
  transportType?: string
  enabled: boolean
  status?: string
  command?: string
  args?: string[]
  endpoint?: string
  envKeys?: string[]
  tools?: { name: string; description?: string; enabled?: boolean; requiresApproval?: boolean }[]
  createdAt?: string
  updatedAt?: string
}

export type McpRepository = {
  id: string
  name: string
  description: string
  url: string
  defaultBranch: string
  stars: number
  sourceType: string
}

export type KnowledgeBase = {
  id: string
  name: string
  description?: string
  documentCount: number
  chunkCount: number
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeDocument = {
  id: string
  knowledgeBaseId: string
  sourceName: string
  contentHash?: string
  contentType?: string
  contentLength: number
  chunkCount: number
  summary?: string
  rebuildable: boolean
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeBaseDetail = {
  summary: KnowledgeBase
  documents: KnowledgeDocument[]
}

export type IngestionResult = {
  knowledgeBaseId: string
  documentId?: string | null
  sourceName: string
  chunkCount: number
  duplicate: boolean
}

export type RebuildIndexResult = {
  knowledgeBaseId: string
  documentId?: string | null
  rebuiltDocuments: number
  totalChunks: number
}

export type NodeConnection = {
  id: string
  name: string
  hostname?: string
  osName?: string
  osArch?: string
  clientVersion?: string
  enabled: boolean
  status?: string
  lastSeenAt?: string
  createdAt?: string
  updatedAt?: string
}

export type NodeTool = {
  id: number
  nodeId: string
  name: string
  description?: string
  riskLevel?: string
  enabled: boolean
  requiresApproval: boolean
  inputSchemaJson?: string
  createdAt?: string
  updatedAt?: string
}

export type NodeDetail = {
  node: NodeConnection
  tools: NodeTool[]
}

export type NodeRegistrationToken = {
  tokenId: string
  registrationToken: string
  expiresAt: string
  usageHint: string
}

export type NodeToolApproval = {
  id: string
  nodeId: string
  toolName: string
  runId?: string
  toolCallId?: string
  argumentsJson?: string
  timeoutSeconds?: number
  status: string
  requestedBy?: string
  decidedBy?: string
  createdAt?: string
  decidedAt?: string
  executedAt?: string
  executionStatus?: string
  resultJson?: string
  errorMessage?: string
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
  type: 'RUN_STARTED' | 'STEP_STARTED' | 'RETRIEVAL_COMPLETED' | 'TOOL_CALL_REQUESTED' | 'TOOL_CALL_STARTED' | 'TOOL_CALL_COMPLETED' | 'TOOL_CALL_FAILED' | 'TOKEN_DELTA' | 'STEP_COMPLETED' | 'FINAL_ANSWER' | 'RUN_FAILED' | 'RUN_CANCELLED'
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
  durationMs?: number
}
