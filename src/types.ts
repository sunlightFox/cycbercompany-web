export type Role = 'USER' | 'ASSISTANT'

export type Agent = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultModelProfileId: string | null
  toolAllowList: string[]
  defaultSkillIds: string[]
  enabled: boolean
  promptVersion?: number
  createdAt?: string
  requestedAt?: string
  updatedAt?: string
}

export type AgentVisibility = 'PRIVATE' | 'TEAM' | 'TENANT'
export type AgentStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED'
export type AgentVersionState = 'DRAFT' | 'PUBLISHED'

export type AgentReference = {
  id: string
  revision?: string
  required?: boolean
}

export type AgentManifestV2 = {
  schemaVersion: 2
  identity: {
    displayName: string
    description: string
    avatarRef?: string
    category?: string
    tags?: string[]
  }
  persona: {
    role: string
    mission: string
    audience?: string
    responsibilities: string[]
    boundaries: string[]
    traits?: string[]
    communication?: {
      defaultLanguage?: string
      tone?: string[]
      responseDensity?: 'COMPACT' | 'BALANCED' | 'DETAILED'
      customInstructions?: string
    }
    greeting?: string
    conversationStarters?: string[]
    exampleDialogs?: Array<{ role: 'USER' | 'AGENT'; content: string }>
  }
  capabilities: {
    model: {
      defaultProfileId: string
      fallbackProfileIds?: string[]
      selectionMode?: 'FIXED' | 'POLICY'
    }
    tools: AgentReference[]
    skills: AgentReference[]
    mcpConnections: AgentReference[]
    knowledgeBases: AgentReference[]
    collaborators: Array<{ agentId: string; mode: 'AS_TOOL' | 'HANDOFF'; when: string }>
  }
  memory: {
    mode: 'OFF' | 'CONVERSATION' | 'PERSONALIZED'
    shortTerm: {
      strategy: 'WINDOW' | 'SUMMARY' | 'HYBRID'
      maxContextTokens: number
    }
    longTerm: {
      enabled: boolean
      categories: Array<'PROFILE' | 'SEMANTIC' | 'EPISODIC' | 'PROCEDURAL'>
      writeMode: 'EXPLICIT_ONLY' | 'SUGGEST' | 'AUTO'
      retrievalMode: 'KEYWORD' | 'SEMANTIC' | 'HYBRID'
      topK: number
      minRelevance?: number
      ttlDays?: number | null
      requireEvidence?: boolean
      sensitiveDataPolicy: 'REJECT' | 'CONFIRM'
    }
  }
  runtime: {
    autonomy: 'ASSIST' | 'EXECUTE' | 'ORCHESTRATE'
    planning: 'NONE' | 'IMPLICIT' | 'VISIBLE'
    maxSteps: number
    timeoutSeconds: number
    maxModelTokens?: number
    maxEstimatedCost?: number | null
    failureStrategy?: 'STOP' | 'RETRY_SAFE' | 'ASK_USER' | 'FALLBACK_MODEL'
  }
  safety: {
    approvalPreset: 'CONSERVATIVE' | 'BALANCED' | 'CUSTOM'
    inputGuardrails: AgentReference[]
    outputGuardrails: AgentReference[]
    customApprovalRules?: Array<{
      riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
      decision: 'ALLOW' | 'ASK' | 'DENY'
    }>
  }
  presentation?: {
    themeToken?: string
    showPlanByDefault?: boolean
    showMemoryUsage?: boolean
  }
  evaluation?: {
    suiteIds?: string[]
    requiredBeforePublish?: boolean
    minimumPassRate?: number
  }
  extensions?: Record<string, unknown>
}

export type AgentVersionV2 = {
  id: string
  revision: number
  versionNumber: number
  schemaVersion: number
  state: AgentVersionState
  manifest: AgentManifestV2
  manifestDigest: string
  compiledPromptDigest: string
  createdBy: string
  createdAt: string
  publishedAt: string | null
}

export type AgentV2 = {
  id: string
  displayName: string
  description: string
  avatarRef: string
  category: string
  tags: string[]
  visibility: AgentVisibility
  status: AgentStatus
  currentPublishedVersionId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  currentPublishedVersion: AgentVersionV2 | null
  latestDraft: AgentVersionV2 | null
}

export type AgentManifestValidation = {
  valid: boolean
  errors: string[]
  manifestDigest: string | null
  compiledPromptDigest: string | null
}

export type AgentDraftTestResult = {
  agentId: string
  versionId: string
  manifestDigest: string
  modelProfileId: string
  content: string
  promptTokens: number | null
  completionTokens: number | null
  rawModel: string | null
  finishReason: string | null
  toolCallsBlocked: boolean
  notices: string[]
}

export type AgentEvaluationReport = {
  agentId: string
  versionId: string
  manifestDigest: string
  score: number
  passed: boolean
  evaluatedAt: string
  suites: Array<{
    suiteId: string
    score: number
    passed: boolean
    cases: Array<{ caseId: string; passed: boolean; reason: string }>
  }>
}

export type MemoryType = 'PROFILE' | 'SEMANTIC' | 'EPISODIC' | 'PROCEDURAL'
export type MemoryScope = 'AGENT' | 'USER'
export type MemoryOrigin = 'USER_CREATED' | 'AUTO_EXTRACTED' | 'AUTO_MERGED'
export type MemoryStatus = 'CANDIDATE' | 'CONFIRMED' | 'REJECTED'
export type MemorySensitivity = 'NORMAL' | 'SENSITIVE' | 'PROHIBITED'

export type MemoryItem = {
  id: string
  agentId: string
  scope: MemoryScope
  origin: MemoryOrigin
  memoryKey: string | null
  supersededBy: string | null
  personaId: string | null
  type: MemoryType
  status: MemoryStatus
  sensitivity: MemorySensitivity
  content: string
  confidence: number
  importance: number
  sourceConversationId: string | null
  sourceRunId: string | null
  evidenceSummary: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revision: number
}

export type UserPersona = {
  id: string
  name: string
  description: string
  attributes: Record<string, unknown>
  defaultPersona: boolean
  revision: number
  createdAt: string
  updatedAt: string
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

export type ExecutionMode = 'PERSONAL_LOCAL' | 'LOCAL_AND_NODES' | 'NODES_ONLY'

export type ExecutionSettings = {
  mode: ExecutionMode
  updatedAt?: string | null
}

export type SystemStatus = {
  status: 'READY' | 'UNHEALTHY'
  code: string | null
  message: string
}

export type ApprovalMode = 'on-request' | 'auto-approve' | 'full-access'

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

export type SkillDetail = {
  summary: Skill
  skillMarkdown: string
  files: string[]
}

export type SkillRuntimeRequirement = {
  name: string
  versionConstraint?: string | null
  source: string
}

export type SkillCompatibilityIssue = {
  severity: string
  code: string
  skillId: string
  message: string
}

export type SkillCompatibility = {
  compatible: boolean
  issues: SkillCompatibilityIssue[]
  requiredTools: string[]
  runtimes: SkillRuntimeRequirement[]
  requiredFeatures: string[]
}

export type SkillPreflight = {
  ready: boolean
  agentId: string
  nodeId?: string | null
  skillIds: string[]
  allowedTools: string[]
  compatibility: SkillCompatibility
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

export type SkillHubSkill = {
  id: string
  name: string
  description: string
  reference: string
  url: string
  downloads: number
  verified: boolean
  source: string
}

export type ClawHubSkill = {
  id: string
  name: string
  description: string
  reference: string
  url: string
  downloads: number
  official: boolean
  suspicious: boolean
  verdict: string
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
  lastError?: string
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
  installType?: 'NPM' | 'REMOTE' | 'REPOSITORY'
  npmPackage?: string | null
  transportType?: 'STDIO' | 'STREAMABLE_HTTP' | 'SSE' | null
  endpoint?: string | null
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
  indexStatus?: 'READY' | 'INDEXING' | 'FAILED' | string
  indexError?: string | null
  indexedAt?: string | null
  indexDurationMs?: number | null
  duplicate?: boolean
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeBaseDetail = {
  summary: KnowledgeBase
  documents: KnowledgeDocument[]
}

export type KnowledgeStats = {
  knowledgeBaseId: string
  documentCount: number
  chunkCount: number
}

export type KnowledgeSettings = {
  embeddingEnabled: boolean
  embeddingCredentialConfigured: boolean
  embeddingModel: string
  embeddingBaseUrl: string
  embeddingCredentialEnv: string
  vectorStore: string
  chunkSize: number
  chunkOverlap: number
}

export type KnowledgeSettingsUpdate = {
  embeddingEnabled: boolean
  embeddingModel: string
  embeddingBaseUrl: string
  embeddingCredentialEnv?: string
  apiKey?: string
  vectorStore: string
  chunkSize: number
  chunkOverlap: number
}

export type KnowledgeChunk = {
  id: number
  knowledgeBaseId: string
  documentId: string
  sourceName: string
  chunkIndex: number
  content: string
  embeddingIndexed: boolean
}

export type KnowledgeSearchResult = KnowledgeChunk & {
  score: number
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
  rebuiltDocumentCount: number
  chunkCount: number
}

export type NodeConnection = {
  id: string
  name: string
  kind?: 'MANAGED_LOCAL' | 'REGISTERED'
  hostname?: string
  osName?: string
  osArch?: string
  clientVersion?: string
  features?: string[]
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
  requestedAt?: string
  decidedAt?: string
  executedAt?: string
  executionStatus?: string
  resultJson?: string
  errorMessage?: string
}

export type ToolApproval = {
  id: string
  runId?: string | null
  toolCallId?: string | null
  status: string
  createdAt?: string
  requestedAt?: string
  decidedAt?: string | null
  errorMessage?: string | null
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
  archived: boolean
  archivedAt?: string | null
  personaId?: string | null
  messages: Message[]
}

export type ConversationAttachment = {
  id: string
  fileName: string
  contentType: string
  byteSize: number
  createdAt?: string
}

export type Artifact = {
  id: string
  runId?: string | null
  artifactType: string
  filename: string
  mimeType: string
  sizeBytes: number
  digest: string
  downloadUrl: string
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
  retryOfRunId?: string | null
  skillSnapshotDigest?: string | null
  status: 'QUEUED' | 'CREATED' | 'RUNNING' | 'WAITING_APPROVAL' | 'SUCCEEDED' | 'NEEDS_VERIFICATION' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'INTERRUPTED' | string
  finalAnswer?: string | null
  errorMessage?: string | null
  queuePosition?: number | null
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
  clientRequestId?: string | null
  deliveryGate?: DeliveryGate | null
}

export type DeliveryGate = {
  status: 'VERIFIED' | 'NEEDS_VERIFICATION' | 'UNAVAILABLE' | string
  reasons?: string[]
  missingEvidence?: string[]
  desktopInspection?: 'PASSED' | 'FAILED' | 'TIMEOUT' | 'UNAVAILABLE' | string
  fileOperation?: 'PASSED' | 'FAILED' | 'NOT_REQUIRED' | 'UNAVAILABLE' | string
  finalEvidence?: boolean
}

export type RunAuditTimelineEntry = {
  id: string
  kind: 'event' | 'run' | 'model' | 'tool' | 'node-tool' | 'mcp' | 'approval' | 'artifact' | string
  title: string
  detail?: string | null
  status: string
  occurredAt: string
  sequence?: number | null
}

export type RunAudit = {
  run: RunView
  snapshot?: {
    agentId: string
    agentVersionId?: string | null
    modelProfileId: string
    allowedTools: string[]
    knowledgeBaseIds: string[]
    mcpConnectionIds: string[]
    nodeId?: string | null
    workingDirectory: string
    skillIds: string[]
    personaId?: string | null
    personaName?: string | null
    recalledMemoryCount: number
    recalledMemoryTypes: string[]
    createdAt: string
  } | null
  summary: {
    events: number
    modelCalls: number
    tools: number
    approvals: number
    artifacts: number
  }
  usage: {
    modelCalls: number
    providerReportedCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    modelLatencyMs: number
  }
  timing: {
    queueMs: number
    executionMs: number
    totalMs: number
  }
  timeline: RunAuditTimelineEntry[]
  citations: Citation[]
  artifacts: Artifact[]
}

export type RunWorkflow = {
  runId: string
  workspaceScope: string
  goal: string
  planJson: string
  phase: string
  lastToolName?: string | null
  completedToolCalls: number
  failedToolCalls: number
  lastError?: string | null
  createdAt: string
  updatedAt: string
}

export type ConversationQueue = {
  conversationId: string
  activeRunId?: string | null
  pending: Array<{ runId: string; position?: number }>
  guide?: { message?: string; cancelHint?: string }
}

export type RunEvent = {
  sequence: number
  type: 'RUN_QUEUED' | 'SKILLS_RESOLVED' | 'RUN_STARTED' | 'STEP_STARTED' | 'RETRIEVAL_COMPLETED' | 'RETRIEVAL_SOURCES' | 'MODEL_RATE_LIMITED' | 'TOOL_CALL_REQUESTED' | 'TOOL_CALL_STARTED' | 'TOOL_APPROVAL_REQUIRED' | 'TOOL_CALL_COMPLETED' | 'TOOL_BUDGET_WARNING' | 'RUN_WAITING_APPROVAL' | 'RUN_RESUMED' | 'TOOL_CALL_FAILED' | 'TOKEN_DELTA' | 'STEP_COMPLETED' | 'RUN_NEEDS_VERIFICATION' | 'FINAL_ANSWER' | 'RUN_FAILED' | 'RUN_CANCELLED' | 'RUN_INTERRUPTED'
  payload: string
  createdAt?: string
}

export type CreateRunResponse = {
  runId: string
  status: string
  queuePosition: number
  eventsUrl: string
}

export type StepStatus = 'running' | 'waiting' | 'warning' | 'complete' | 'failed' | 'cancelled'

export type RunStep = {
  id: string
  kind?: 'capabilities' | 'queue' | 'coordinator' | 'execution' | 'retrieval' | 'tool-request' | 'tool' | 'approval' | 'warning' | 'answer' | 'verification' | 'resume' | string
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
  runState?: 'queued' | 'running' | 'waitingApproval' | 'needsVerification' | 'completed' | 'failed' | 'cancelled' | 'timedOut' | 'interrupted' | 'unknown'
  lifecycle?: 'queued' | 'running' | 'waitingApproval' | 'terminal'
  outcome?: 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  delivery?: 'verified' | 'needsVerification' | 'unavailable'
  sync?: 'live' | 'reconnecting' | 'recovered' | 'lost'
  deliveryGate?: DeliveryGate | null
  error?: string
  durationMs?: number
}
