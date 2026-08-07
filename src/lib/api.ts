import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { createUuid } from './uuid'
import type { Agent, AgentDraftTestResult, AgentEvaluationReport, AgentManifestV2, AgentManifestValidation, AgentV2, AgentVersionV2, AgentVisibility, ApprovalMode, Artifact, BatchIngestionResult, ClawHubSkill, CodingRunEvidence, CodingRunQuality, Conversation, ConversationAttachment, ConversationQueue, CreateRunResponse, ExecutionMode, ExecutionSettings, IngestionResult, KnowledgeBase, KnowledgeBaseDetail, KnowledgeChunk, KnowledgeDocument, KnowledgeSearchResult, KnowledgeSettings, KnowledgeSettingsUpdate, KnowledgeStats, McpConnection, McpRepository, McpTool, McpToolInvocation, ModelPreset, ModelProfile, ModelSettings, ModelTestResult, NodeConnection, NodeDetail, NodeRegistrationToken, NodeTool, NodeToolApproval, RebuildIndexResult, RepositorySkill, RotateNodeSecretResult, RunAudit, RunEvent, RunView, RunWorkflow, Skill, SkillDetail, SkillHubSkill, SkillPreflight, SkillRepository, SystemStatus, Tool, ToolApproval } from '../types'

const API_ROOT = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const API_V2_ROOT = import.meta.env.VITE_API_V2_BASE_URL ?? API_ROOT.replace(/\/v1\/?$/, '/v2')
const LOCAL_EXECUTOR_LAUNCHER_URL = (
  import.meta.env.VITE_LOCAL_EXECUTOR_LAUNCHER_URL ?? 'http://127.0.0.1:8094'
).replace(/\/+$/, '')
const API_REQUEST_TIMEOUT_MS = 8_000
const CORE_REQUEST_TIMEOUT_MS = 4_000

export type StudioApiFieldError = {
  field: string
  message: string
}

export class StudioApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly errors: StudioApiFieldError[]

  constructor(message: string, status: number, code?: string, errors: StudioApiFieldError[] = []) {
    super(message)
    this.name = 'StudioApiError'
    this.status = status
    this.code = code
    this.errors = errors
    Object.setPrototypeOf(this, StudioApiError.prototype)
  }
}

export class RunLaunchTimeoutError extends Error {
  readonly clientRequestId: string

  constructor(clientRequestId: string) {
    super('Run launch timed out; the server may still be processing the request.')
    this.name = 'RunLaunchTimeoutError'
    this.clientRequestId = clientRequestId
  }
}

export class RunStreamTimeoutError extends Error {
  constructor() {
    super('Run stream made no progress before the heartbeat deadline.')
    this.name = 'RunStreamTimeoutError'
  }
}

export type LocalExecutorLauncherHealth = {
  reachable: boolean
  online: boolean
  workspace?: string
}

type ProblemPayload = {
  detail?: string
  message?: string
  status?: number
  code?: string
  errors?: StudioApiFieldError[]
}

function authenticationHeaders(): Record<string, string> {
  const configuredToken = import.meta.env.VITE_API_TOKEN
  const token = typeof configuredToken === 'string' && configuredToken.trim()
    ? configuredToken.trim()
    : sessionStorage.getItem('studio-api-token') ?? ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestFromRoot<T>(API_ROOT, path, init)
}

async function requestV2<T>(path: string, init?: RequestInit): Promise<T> {
  return requestFromRoot<T>(API_V2_ROOT, path, init)
}

async function requestFromRoot<T>(root: string, path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const response = await fetch(`${root}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
        'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
        ...authenticationHeaders(),
        ...init?.headers,
      },
    })

  if (!response.ok) {
    throw await apiErrorFromResponse(response, `Request failed with ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function requestCore<T>(path: string): Promise<T> {
  return request<T>(path, { signal: AbortSignal.timeout(CORE_REQUEST_TIMEOUT_MS) })
}

async function requestLocalExecutorLauncherHealth(): Promise<LocalExecutorLauncherHealth> {
  try {
    const response = await fetch(`${LOCAL_EXECUTOR_LAUNCHER_URL}/health`, {
      method: 'GET',
      mode: 'cors',
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return { reachable: false, online: false }
    }
    const payload = await response.json().catch(() => ({} as { online?: boolean; workspace?: string }))
    return {
      reachable: true,
      online: Boolean(payload.online),
      workspace: typeof payload.workspace === 'string' ? payload.workspace : undefined,
    }
  } catch {
    return { reachable: false, online: false }
  }
}

async function waitForManagedLocalExecutorOnline(timeoutMs = 30_000): Promise<NodeConnection[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const nodes = await request<NodeConnection[]>('/nodes')
      if (nodes.some((node) => node.kind === 'MANAGED_LOCAL' && node.enabled && node.status?.toUpperCase() === 'ONLINE')) {
        return nodes
      }
    } catch {
      // The companion can be connecting while the backend is briefly unavailable.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000))
  }
  throw new Error('The local executor is still starting. Please wait and try again.')
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Accept: 'application/octet-stream',
      'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
      'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
      ...authenticationHeaders(),
    },
  })
  if (!response.ok) {
    throw await apiErrorFromResponse(response, `Request failed with ${response.status}`)
  }
  return response.blob()
}

async function apiErrorFromResponse(response: Response, fallback: string): Promise<StudioApiError> {
  const body = await response.text()
  let parsed: ProblemPayload | undefined
  try {
    parsed = JSON.parse(body) as ProblemPayload
  } catch {
    // Keep plain-text proxy and server errors readable.
  }
  const message = parsed?.detail || parsed?.message || body || fallback
  return new StudioApiError(message, parsed?.status ?? response.status, parsed?.code, parsed?.errors ?? [])
}

export const studioApi = {
  getSystemStatus: () => requestCore<SystemStatus>('/system/status'),
  getExecutionSettings: () => requestCore<ExecutionSettings>('/execution-settings'),
  updateExecutionSettings: (mode: ExecutionMode) => request<ExecutionSettings>('/execution-settings', { method: 'PATCH', body: JSON.stringify({ mode }) }),
  listAgents: () => requestCore<Agent[]>('/agents'),
  createAgent: (payload: { id: string; name: string; description: string; systemPrompt: string; defaultModelProfileId?: string | null; toolAllowList?: string[]; defaultSkillIds?: string[]; enabled?: boolean }) => request<Agent>('/agents', { method: 'POST', body: JSON.stringify(payload) }),
  updateAgent: (id: string, payload: { name?: string; description?: string; systemPrompt?: string; defaultModelProfileId?: string | null; toolAllowList?: string[]; defaultSkillIds?: string[]; enabled?: boolean }) => request<Agent>(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  listAgentsV2: () => requestV2<AgentV2[]>('/agents'),
  getAgentV2: (id: string) => requestV2<AgentV2>(`/agents/${encodeURIComponent(id)}`),
  createAgentV2: (payload: { manifest: AgentManifestV2; visibility: AgentVisibility }) => requestV2<AgentV2>('/agents', { method: 'POST', body: JSON.stringify(payload) }),
  updateAgentV2Settings: (id: string, payload: { visibility?: AgentVisibility; status?: 'ACTIVE' | 'DISABLED'; expectedRevision: number }) => requestV2<AgentV2>(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  listAgentV2Versions: (id: string) => requestV2<AgentVersionV2[]>(`/agents/${encodeURIComponent(id)}/versions`),
  createAgentV2Draft: (id: string) => requestV2<AgentVersionV2>(`/agents/${encodeURIComponent(id)}/drafts`, { method: 'POST' }),
  updateAgentV2Manifest: (id: string, versionId: string, payload: { manifest: AgentManifestV2; expectedRevision: number }) => requestV2<AgentVersionV2>(`/agents/${encodeURIComponent(id)}/drafts/${encodeURIComponent(versionId)}/manifest`, { method: 'PUT', body: JSON.stringify(payload) }),
  validateAgentV2Draft: (id: string, versionId: string) => requestV2<AgentManifestValidation>(`/agents/${encodeURIComponent(id)}/drafts/${encodeURIComponent(versionId)}/validate`, { method: 'POST' }),
  testAgentV2Draft: (id: string, versionId: string, messages: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>, modelProfileId?: string) => requestV2<AgentDraftTestResult>(`/agents/${encodeURIComponent(id)}/drafts/${encodeURIComponent(versionId)}/test-runs`, { method: 'POST', body: JSON.stringify({ messages, modelProfileId: modelProfileId || null }) }),
  evaluateAgentV2Draft: (id: string, versionId: string) => requestV2<AgentEvaluationReport>(`/agents/${encodeURIComponent(id)}/drafts/${encodeURIComponent(versionId)}/evaluations`, { method: 'POST' }),
  publishAgentV2Draft: (id: string, versionId: string) => requestV2<AgentVersionV2>(`/agents/${encodeURIComponent(id)}/drafts/${encodeURIComponent(versionId)}/publish`, { method: 'POST' }),
  archiveAgentV2: (id: string) => requestV2<AgentV2>(`/agents/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  listModels: () => requestCore<ModelProfile[]>('/models'),
  listModelPresets: () => request<ModelPreset[]>('/models/presets'),
  getModelSettings: () => request<ModelSettings>('/models/settings'),
  saveModel: (payload: { id: string; providerType: string; baseUrl: string; modelName: string; credentialRef?: string; apiKey?: string; capabilities: string[]; enabled: boolean }) => request<ModelProfile>('/models', { method: 'POST', body: JSON.stringify(payload) }),
  getModel: (id: string) => request<ModelProfile>(`/models/${encodeURIComponent(id)}`),
  deleteModel: (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testModel: (id: string, prompt?: string) => request<ModelTestResult>(`/models/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify(prompt ? { prompt } : {}) }),
  listTools: () => request<Tool[]>('/tools'),
  listSkills: () => request<Skill[]>('/skills'),
  getSkill: (id: string) => request<SkillDetail>(`/skills/${encodeURIComponent(id)}`),
  createSkill: (payload: { id: string; skillMarkdown: string; enabled?: boolean; overwrite?: boolean }) => request<Skill>('/skills', { method: 'POST', body: JSON.stringify(payload) }),
  updateSkillContent: (id: string, payload: { skillMarkdown: string; enabled?: boolean }) => request<Skill>(`/skills/${encodeURIComponent(id)}/content`, { method: 'PUT', body: JSON.stringify(payload) }),
  listSkillRepositories: () => request<SkillRepository[]>('/skill-repositories'),
  searchSkillRepositories: (payload: { query?: string; limit?: number }) => request<SkillRepository[]>('/skill-repositories/search', { method: 'POST', body: JSON.stringify(payload) }),
  discoverRepositorySkills: (payload: { repoUrl: string; ref?: string; limit?: number }) => request<RepositorySkill[]>('/skill-repositories/discover', { method: 'POST', body: JSON.stringify(payload) }),
  getSkillMarketplace: (payload: { query?: string; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (payload.query?.trim()) params.set('query', payload.query.trim())
    if (payload.limit) params.set('limit', String(payload.limit))
    const suffix = params.size ? `?${params}` : ''
    return request<{ skillHubSkills: SkillHubSkill[]; clawHubSkills: ClawHubSkill[]; sources: Array<{ id: string; label: string; count: number; status: string }> }>(`/skill-marketplace${suffix}`)
  },
  installSkill: (payload: { repoUrl: string; ref?: string; path?: string; id?: string; enabled?: boolean; overwrite?: boolean }) => request<Skill>('/skills/install', { method: 'POST', body: JSON.stringify(payload) }),
  installSkillHubSkill: (payload: { reference: string; id?: string; enabled?: boolean; overwrite?: boolean }) => request<Skill>('/skills/install/skillhub', { method: 'POST', body: JSON.stringify(payload) }),
  searchClawHubSkills: (payload: { query?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (payload.query?.trim()) params.set('query', payload.query.trim())
    if (payload.limit) params.set('limit', String(payload.limit))
    const suffix = params.size ? `?${params}` : ''
    return request<ClawHubSkill[]>(`/skill-registries/clawhub/search${suffix}`)
  },
  installClawHubSkill: (payload: { reference: string; id?: string; enabled?: boolean; overwrite?: boolean }) => request<Skill>('/skills/install/clawhub', { method: 'POST', body: JSON.stringify(payload) }),
  setSkillEnabled: (id: string, enabled: boolean) => request<Skill>(`/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteSkill: (id: string) => request<void>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  preflightSkill: (payload: { agentId?: string; skillIds: string[]; toolNames?: string[]; knowledgeBaseIds?: string[]; mcpServerIds?: string[]; nodeId?: string }) => request<SkillPreflight>('/skills/preflight', { method: 'POST', body: JSON.stringify(payload) }),
  listMcpConnections: () => request<McpConnection[]>('/mcp-connections'),
  listMcpRepositories: () => request<McpRepository[]>('/mcp-repositories'),
  searchMcpRepositories: (payload: { query?: string; limit?: number; source?: 'registry' | 'github' }) => request<McpRepository[]>('/mcp-repositories/search', { method: 'POST', body: JSON.stringify(payload) }),
  installMcpRepository: (payload: { repositoryId: string; id?: string; name?: string; description?: string; enabled?: boolean; refreshTools?: boolean }) => request<McpConnection>('/mcp-connections/install', { method: 'POST', body: JSON.stringify(payload) }),
  installNpmMcp: (payload: { id?: string; name: string; description?: string; npmPackage: string; packageArgs?: string[]; env?: Record<string, string>; enabled?: boolean; refreshTools?: boolean }) => request<McpConnection>('/mcp-connections/install-npm', { method: 'POST', body: JSON.stringify(payload) }),
  importMcpJson: (payload: { json: string; overwrite?: boolean; enabled?: boolean; refreshTools?: boolean }) => request<McpConnection[]>('/mcp-connections/import-json', { method: 'POST', body: JSON.stringify(payload) }),
  createMcpConnection: (payload: { name: string; description?: string; transportType: 'STDIO' | 'STREAMABLE_HTTP' | 'SSE'; command?: string; args?: string[]; endpoint?: string; env?: Record<string, string>; enabled?: boolean }) => request<McpConnection>('/mcp-connections', { method: 'POST', body: JSON.stringify(payload) }),
  updateMcpConnection: (id: string, payload: { name?: string; description?: string; transportType?: 'STDIO' | 'STREAMABLE_HTTP' | 'SSE'; command?: string; args?: string[]; endpoint?: string; env?: Record<string, string>; enabled?: boolean }) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteMcpConnection: (id: string) => request<void>(`/mcp-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setMcpEnabled: (id: string, enabled: boolean) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
  refreshMcpTools: (id: string) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}/refresh-tools`, { method: 'POST' }),
  listMcpTools: (id: string) => request<McpTool[]>(`/mcp-connections/${encodeURIComponent(id)}/tools`),
  listMcpToolInvocations: () => request<McpToolInvocation[]>('/mcp-tool-invocations'),
  setMcpToolEnabled: (connectionId: string, toolName: string, enabled: boolean) => request<McpTool>(`/mcp-connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
  listKnowledgeBases: () => request<KnowledgeBase[]>('/knowledge-bases'),
  getKnowledgeSettings: () => request<KnowledgeSettings>('/knowledge-settings'),
  updateKnowledgeSettings: (payload: KnowledgeSettingsUpdate) => request<KnowledgeSettings>('/knowledge-settings', { method: 'PATCH', body: JSON.stringify(payload) }),
  createKnowledgeBase: (payload: { name: string; description?: string }) => request<KnowledgeBase>('/knowledge-bases', { method: 'POST', body: JSON.stringify(payload) }),
  getKnowledgeBase: (id: string) => request<KnowledgeBaseDetail>(`/knowledge-bases/${encodeURIComponent(id)}`),
  getKnowledgeStats: (id: string) => request<KnowledgeStats>(`/knowledge-bases/${encodeURIComponent(id)}/stats`),
  listKnowledgeDocuments: (id: string) => request<KnowledgeDocument[]>(`/knowledge-bases/${encodeURIComponent(id)}/documents`),
  listKnowledgeChunks: (baseId: string, documentId: string) => request<KnowledgeChunk[]>(`/knowledge-bases/${encodeURIComponent(baseId)}/documents/${encodeURIComponent(documentId)}/chunks`),
  searchKnowledge: (payload: { knowledgeBaseIds: string[]; query: string; limit?: number }) => request<KnowledgeSearchResult[]>('/knowledge-search', { method: 'POST', body: JSON.stringify(payload) }),
  ingestKnowledgeDocument: (id: string, payload: { sourceName: string; content: string }) => request<IngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents`, { method: 'POST', body: JSON.stringify(payload) }),
  uploadKnowledgeDocument: (id: string, file: File) => { const body = new FormData(); body.append('file', file); return request<IngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents/upload`, { method: 'POST', body }) },
  uploadKnowledgeDocuments: (id: string, files: File[]) => { const body = new FormData(); files.forEach((file) => body.append('files', file)); return request<BatchIngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents/batch-upload`, { method: 'POST', body }) },
  deleteKnowledgeDocument: (baseId: string, documentId: string) => request<void>(`/knowledge-bases/${encodeURIComponent(baseId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  rebuildKnowledgeDocument: (baseId: string, documentId: string) => request<RebuildIndexResult>(`/knowledge-bases/${encodeURIComponent(baseId)}/documents/${encodeURIComponent(documentId)}/rebuild-index`, { method: 'POST' }),
  rebuildKnowledgeBase: (id: string) => request<RebuildIndexResult>(`/knowledge-bases/${encodeURIComponent(id)}/rebuild-index`, { method: 'POST' }),
  deleteKnowledgeBase: (id: string) => request<void>(`/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateKnowledgeBase: (id: string, payload: { name: string; description?: string }) => request<KnowledgeBase>(`/knowledge-bases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  clearKnowledgeDocuments: (id: string) => request<KnowledgeStats>(`/knowledge-bases/${encodeURIComponent(id)}/clear-documents`, { method: 'POST' }),
  listNodes: () => request<NodeConnection[]>('/nodes'),
  createNodeRegistrationToken: (payload?: { ttlSeconds?: number }) => request<NodeRegistrationToken>('/node-registration-tokens', { method: 'POST', body: JSON.stringify(payload ?? {}) }),
  getNode: (id: string) => request<NodeDetail>(`/nodes/${encodeURIComponent(id)}`),
  updateNode: (id: string, payload: { name?: string; enabled?: boolean }) => request<NodeConnection>(`/nodes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteNode: (id: string) => request<void>(`/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  disconnectNode: (id: string) => request<NodeConnection>(`/nodes/${encodeURIComponent(id)}/disconnect`, { method: 'POST' }),
  getLocalExecutorLauncherHealth: requestLocalExecutorLauncherHealth,
  waitForManagedLocalExecutorOnline,
  startLocalExecutor: async (workspace?: string) => {
    const health = await requestLocalExecutorLauncherHealth()
    if (!health.reachable) {
      throw new Error(
        `Local executor launcher is not reachable at ${LOCAL_EXECUTOR_LAUNCHER_URL}. Start the local launcher on this machine, then try again.`,
      )
    }
    let response: Response
    try {
      response = await fetch(`${LOCAL_EXECUTOR_LAUNCHER_URL}/start`, {
        method: 'POST',
        mode: 'cors',
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspace?.trim() || null }),
      })
    } catch {
      throw new Error(
        `Local executor launcher is not reachable at ${LOCAL_EXECUTOR_LAUNCHER_URL}. Start the local launcher on this machine, then try again.`,
      )
    }
    const payload = await response.json().catch(() => ({})) as { message?: string; error?: string }
    if (!response.ok) {
      throw new Error(payload.message ?? payload.error ?? `Local executor launcher returned HTTP ${response.status}.`)
    }
    return payload
  },
  rotateNodeCredentials: (id: string) => request<RotateNodeSecretResult>(`/nodes/${encodeURIComponent(id)}/credentials/rotate`, { method: 'POST' }),
  setNodeSystemAccess: (nodeId: string, enabled: boolean) => request<void>(`/nodes/${encodeURIComponent(nodeId)}/system-access`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  updateNodeTool: (nodeId: string, toolName: string, payload: { enabled?: boolean; requiresApproval?: boolean }) => request<NodeTool>(`/nodes/${encodeURIComponent(nodeId)}/tools/${encodeURIComponent(toolName)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  listNodeToolApprovals: () => request<NodeToolApproval[]>('/node-tool-approvals'),
  listToolApprovals: () => request<ToolApproval[]>('/tool-approvals'),
  decideNodeToolApproval: (id: string, approved: boolean) => request(`/node-tool-approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ approved }) }),
  decideToolApproval: (id: string, approved: boolean) => request(`/tool-approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ approved }) }),
  setModelEnabled: (id: string, enabled: boolean) => request<ModelProfile>(`/models/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  setDefaultModel: (modelProfileId: string) => request<{ defaultModelProfileId: string }>('/models/settings/default', { method: 'PATCH', body: JSON.stringify({ modelProfileId }) }),
  getConversation: (id: string) => request<Conversation>(`/conversations/${encodeURIComponent(id)}`),
  archiveConversation: (id: string) => request<Conversation>(`/conversations/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  createConversation: (title: string) => request<{ id: string }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  uploadConversationAttachments: (conversationId: string, files: File[]) => {
    const body = new FormData()
    files.forEach((file) => body.append('files', file))
    return request<ConversationAttachment[]>(`/conversations/${encodeURIComponent(conversationId)}/attachments`, { method: 'POST', body })
  },
  listConversationAttachments: (conversationId: string) => request<ConversationAttachment[]>(`/conversations/${encodeURIComponent(conversationId)}/attachments`),
  downloadConversationAttachment: (conversationId: string, attachmentId: string) => requestBlob(`/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}/download`),
  deleteConversationAttachment: (conversationId: string, attachmentId: string) => request<void>(`/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
  createRun: async (payload: {
    conversationId: string
    text: string
    agentId?: string
    modelProfileId?: string
    knowledgeBaseIds?: string[]
    skillIds?: string[]
    mcpServerIds?: string[]
    toolNames?: string[]
    nodeId?: string
    attachmentIds?: string[]
    clientRequestId?: string
    approvalMode?: ApprovalMode
  }, options?: { idempotencyKey?: string; timeoutMs?: number }) => {
    const clientRequestId = payload.clientRequestId ?? createUuid()
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), options?.timeoutMs ?? 20_000)
    return request<CreateRunResponse>('/runs', {
      method: 'POST',
      body: JSON.stringify({ ...payload, clientRequestId }),
      signal: controller.signal,
      headers: {
        'Idempotency-Key': options?.idempotencyKey ?? clientRequestId,
        'X-Client-Request-Id': clientRequestId,
      },
    }).catch((error) => {
      if (controller.signal.aborted) throw new RunLaunchTimeoutError(clientRequestId)
      throw error
    }).finally(() => window.clearTimeout(timeout))
  },
  cancelRun: (id: string) => request<void>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryRun: (id: string) => request<CreateRunResponse>(`/runs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  getRun: (id: string) => request<RunView>(`/runs/${encodeURIComponent(id)}`),
  findRunByClientRequestId: (clientRequestId: string) => request<RunView | null>(`/runs?clientRequestId=${encodeURIComponent(clientRequestId)}`),
  listConversationRuns: (id: string) => request<RunView[]>(`/conversations/${encodeURIComponent(id)}/runs`),
  getRunAudit: (id: string) => request<RunAudit>(`/runs/${encodeURIComponent(id)}/audit`),
  getRunWorkflow: (id: string) => request<RunWorkflow>(`/runs/${encodeURIComponent(id)}/workflow`),
  getConversationQueue: (id: string) => request<ConversationQueue>(`/conversations/${encodeURIComponent(id)}/queue`),
  listRunArtifacts: (id: string) => request<Artifact[]>(`/runs/${encodeURIComponent(id)}/artifacts`),
  downloadArtifact: (id: string) => requestBlob(`/artifacts/${encodeURIComponent(id)}`),
  getCodingEvidence: (id: string) => request<CodingRunEvidence>(`/runs/${encodeURIComponent(id)}/coding-evidence`),
  getCodingQuality: (id: string) => request<CodingRunQuality>(`/runs/${encodeURIComponent(id)}/coding-quality`),
}

export async function streamRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
  options?: { onStatus?: (status: 'live' | 'reconnecting' | 'recovered' | 'lost') => void; heartbeatMs?: number },
) {
  let lastEventId = ''
  let lastSequence = 0
  let retryCount = 0
  let terminal = false
  const seenSequences = new Set<number>()
  const heartbeatMs = options?.heartbeatMs ?? 35_000

  while (!terminal) {
    if (signal?.aborted) throw new DOMException('The run stream was aborted.', 'AbortError')
    let response: Response
    try {
      response = await fetch(`${API_ROOT}/runs/${encodeURIComponent(runId)}/events`, {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
          'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
          'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
          ...authenticationHeaders(),
        },
        signal,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      options?.onStatus?.('reconnecting')
      if (retryCount >= 3) throw new Error('The run stream disconnected after three retries.')
      await waitForRetry(retryCount++, signal)
      continue
    }

    if (!response.ok) throw await apiErrorFromResponse(response, `Unable to connect to run stream (${response.status})`)
    if (!response.body) throw new Error(`Unable to connect to run stream (${response.status})`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let ended = false
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.id) lastEventId = event.id
        if (!event.data) return
        try {
          const parsed = JSON.parse(event.data) as RunEvent
          if (Number.isFinite(parsed.sequence)) {
            if (seenSequences.has(parsed.sequence) || parsed.sequence <= lastSequence) return
            seenSequences.add(parsed.sequence)
            lastSequence = Math.max(lastSequence, parsed.sequence)
          }
          onEvent(parsed)
          // A received event proves this connection is healthy; retries are consecutive.
          retryCount = 0
          options?.onStatus?.('live')
          if (['FINAL_ANSWER', 'RUN_FAILED', 'RUN_CANCELLED', 'RUN_INTERRUPTED'].includes(parsed.type)) terminal = true
        } catch {
          // Ignore keep-alive frames and malformed non-domain frames.
        }
      },
    })

    try {
      while (!ended) {
        const chunk = await readSseChunk(reader, heartbeatMs)
        ended = chunk.done
        if (chunk.value) {
          parser.feed(decoder.decode(chunk.value, { stream: !ended }))
          // The server may keep an SSE connection open for heartbeats after it
          // has emitted a terminal run event. Stop reading immediately so the
          // caller can finish the run and clear cancellation UI state without
          // waiting for the server-side connection timeout.
          if (terminal) {
            await reader.cancel().catch(() => undefined)
            ended = true
          }
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      options?.onStatus?.('reconnecting')
      if (retryCount >= 3) {
        options?.onStatus?.('lost')
        throw error
      }
      await waitForRetry(retryCount++, signal)
      continue
    }
    // Flush a final multibyte character or a complete event delivered with the last chunk.
    const trailing = decoder.decode()
    if (trailing) parser.feed(trailing)
    if (!terminal) {
      options?.onStatus?.('reconnecting')
      if (retryCount >= 3) throw new Error('The run stream ended before a final answer was received.')
      await waitForRetry(retryCount++, signal)
    }
  }
  options?.onStatus?.('recovered')
}

async function readSseChunk(reader: ReadableStreamDefaultReader<Uint8Array>, heartbeatMs: number) {
  let timer: number | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new RunStreamTimeoutError()), heartbeatMs)
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

async function waitForRetry(retryCount: number, signal?: AbortSignal) {
  const delay = 250 * (2 ** retryCount)
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('The run stream was aborted.', 'AbortError'))
    }, { once: true })
  })
}
