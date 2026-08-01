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
  tools?: McpTool[]
  createdAt?: string
  updatedAt?: string
}

export type McpTool = {
  id: string
  name: string
  description?: string
  inputSchema?: string
  riskLevel?: string
  requiresApproval: boolean
  enabled: boolean
  discoveredAt?: string
}

export type McpToolInvocation = {
  id: string
  runId?: string | null
  connectionId: string
  toolName: string
  status: string
  argumentKeys?: string | null
  argumentsSha256?: string | null
  resultContentItems?: number | null
  errorCategory?: string | null
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
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

export type BatchIngestionResult = {
  files: Array<{
    sourceName: string
    documentId?: string | null
    chunkCount: number
    duplicate: boolean
    error?: string | null
    succeeded: boolean
  }>
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

export type RotateNodeSecretResult = {
  nodeId: string
  nodeSecret: string
  websocketUrl: string
  rotatedAt: string
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

export type ConversationAttachment = {
  id: string
  fileName: string
  contentType: string
  byteSize: number
  createdAt?: string
}

export type CodingRunEvidence = {
  runId: string
  toolCalls: number
  changedFiles: string[]
  verificationTools: string[]
  commandVerifications: string[]
  browserTraceArtifacts: string[]
  browserVerified: boolean
  failedTools: string[]
}

export type CodingRunQuality = {
  runId: string
  score: number
  grade: string
  checks: Array<{
    name: string
    earnedPoints: number
    maximumPoints: number
    passed: boolean
    explanation: string
  }>
  recommendations: string[]
}

export type RunView = {
  id: string
  conversationId: string
  modelProfileId: string
  agentId: string
  skillSnapshotDigest?: string | null
  status: 'QUEUED' | 'CREATED' | 'RUNNING' | 'WAITING_APPROVAL' | 'SUCCEEDED' | 'NEEDS_VERIFICATION' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'
  finalAnswer?: string | null
  errorMessage?: string | null
  queuePosition?: number | null
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
}

export type ConversationQueue = {
  conversationId: string
  activeRunId?: string | null
  pending: Array<{ runId: string; position?: number }>
  guide?: { message?: string; cancelHint?: string }
}

export type RunEvent = {
  sequence: number
  type: 'RUN_QUEUED' | 'SKILLS_RESOLVED' | 'RUN_STARTED' | 'STEP_STARTED' | 'RETRIEVAL_COMPLETED' | 'RETRIEVAL_SOURCES' | 'MODEL_RATE_LIMITED' | 'TOOL_CALL_REQUESTED' | 'TOOL_CALL_STARTED' | 'TOOL_APPROVAL_REQUIRED' | 'TOOL_CALL_COMPLETED' | 'TOOL_BUDGET_WARNING' | 'RUN_WAITING_APPROVAL' | 'RUN_RESUMED' | 'TOOL_CALL_FAILED' | 'TOKEN_DELTA' | 'STEP_COMPLETED' | 'RUN_NEEDS_VERIFICATION' | 'FINAL_ANSWER' | 'RUN_FAILED' | 'RUN_CANCELLED'
  payload: string
  createdAt?: string
}

export type CreateRunResponse = {
  runId: string
  status: string
  queuePosition: number
  eventsUrl: string
}

export type StepStatus = 'running' | 'waiting' | 'warning' | 'complete' | 'failed'

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
  retryInput?: string
  approvalId?: string
  approvalDecision?: 'pending' | 'approved' | 'rejected' | 'error'
  attachmentIds?: string[]
  attachmentSummaries?: Array<{ name: string; kind: 'file' | 'image' }>
  queuePosition?: number
  isStreaming?: boolean
  runState?: 'queued' | 'running' | 'waitingApproval' | 'needsVerification' | 'completed' | 'failed' | 'cancelled'
  error?: string
  durationMs?: number
}
