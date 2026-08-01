import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { Agent, BatchIngestionResult, CodingRunEvidence, CodingRunQuality, Conversation, ConversationAttachment, ConversationQueue, CreateRunResponse, IngestionResult, KnowledgeBase, KnowledgeBaseDetail, KnowledgeDocument, McpConnection, McpRepository, McpTool, McpToolInvocation, ModelPreset, ModelProfile, ModelSettings, ModelTestResult, NodeConnection, NodeDetail, NodeRegistrationToken, NodeTool, NodeToolApproval, RebuildIndexResult, RepositorySkill, RotateNodeSecretResult, RunEvent, RunView, Skill, SkillRepository, Tool } from '../types'

const API_ROOT = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

function authenticationHeaders(): Record<string, string> {
  const configuredToken = import.meta.env.VITE_API_TOKEN
  const token = typeof configuredToken === 'string' && configuredToken.trim()
    ? configuredToken.trim()
    : sessionStorage.getItem('studio-api-token') ?? ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
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
    const body = await response.text()
    let detail = body
    try {
      const parsed = JSON.parse(body) as { detail?: string; message?: string }
      detail = parsed.detail || parsed.message || body
    } catch {
      // Keep plain-text proxy and server errors readable.
    }
    throw new Error(detail || `Request failed with ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const studioApi = {
  listAgents: () => request<Agent[]>('/agents'),
  listModels: () => request<ModelProfile[]>('/models'),
  listModelPresets: () => request<ModelPreset[]>('/models/presets'),
  getModelSettings: () => request<ModelSettings>('/models/settings'),
  saveModel: (payload: { id: string; providerType: string; baseUrl: string; modelName: string; credentialRef: string; apiKey?: string; capabilities: string[]; enabled: boolean }) => request<ModelProfile>('/models', { method: 'POST', body: JSON.stringify(payload) }),
  getModel: (id: string) => request<ModelProfile>(`/models/${encodeURIComponent(id)}`),
  deleteModel: (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testModel: (id: string, prompt?: string) => request<ModelTestResult>(`/models/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify(prompt ? { prompt } : {}) }),
  listTools: () => request<Tool[]>('/tools'),
  listSkills: () => request<Skill[]>('/skills'),
  listSkillRepositories: () => request<SkillRepository[]>('/skill-repositories'),
  searchSkillRepositories: (payload: { query?: string; limit?: number }) => request<SkillRepository[]>('/skill-repositories/search', { method: 'POST', body: JSON.stringify(payload) }),
  discoverRepositorySkills: (payload: { repoUrl: string; ref?: string; limit?: number }) => request<RepositorySkill[]>('/skill-repositories/discover', { method: 'POST', body: JSON.stringify(payload) }),
  installSkill: (payload: { repoUrl: string; ref?: string; path?: string; id?: string; enabled?: boolean; overwrite?: boolean }) => request<Skill>('/skills/install', { method: 'POST', body: JSON.stringify(payload) }),
  setSkillEnabled: (id: string, enabled: boolean) => request<Skill>(`/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteSkill: (id: string) => request<void>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listMcpConnections: () => request<McpConnection[]>('/mcp-connections'),
  listMcpRepositories: () => request<McpRepository[]>('/mcp-repositories'),
  searchMcpRepositories: (payload: { query?: string; limit?: number }) => request<McpRepository[]>('/mcp-repositories/search', { method: 'POST', body: JSON.stringify(payload) }),
  installNpmMcp: (payload: { id?: string; name: string; description?: string; npmPackage: string; packageArgs?: string[]; env?: Record<string, string>; enabled?: boolean; refreshTools?: boolean }) => request<McpConnection>('/mcp-connections/install-npm', { method: 'POST', body: JSON.stringify(payload) }),
  createMcpConnection: (payload: { name: string; description?: string; transportType: 'STDIO' | 'STREAMABLE_HTTP' | 'SSE'; command?: string; args?: string[]; endpoint?: string; env?: Record<string, string>; enabled?: boolean }) => request<McpConnection>('/mcp-connections', { method: 'POST', body: JSON.stringify(payload) }),
  updateMcpConnection: (id: string, payload: { name?: string; description?: string; transportType?: 'STDIO' | 'STREAMABLE_HTTP' | 'SSE'; command?: string; args?: string[]; endpoint?: string; env?: Record<string, string>; enabled?: boolean }) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteMcpConnection: (id: string) => request<void>(`/mcp-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setMcpEnabled: (id: string, enabled: boolean) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
  refreshMcpTools: (id: string) => request<McpConnection>(`/mcp-connections/${encodeURIComponent(id)}/refresh-tools`, { method: 'POST' }),
  listMcpTools: (id: string) => request<McpTool[]>(`/mcp-connections/${encodeURIComponent(id)}/tools`),
  listMcpToolInvocations: () => request<McpToolInvocation[]>('/mcp-tool-invocations'),
  setMcpToolEnabled: (connectionId: string, toolName: string, enabled: boolean) => request<McpTool>(`/mcp-connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
  listKnowledgeBases: () => request<KnowledgeBase[]>('/knowledge-bases'),
  createKnowledgeBase: (payload: { name: string; description?: string }) => request<KnowledgeBase>('/knowledge-bases', { method: 'POST', body: JSON.stringify(payload) }),
  getKnowledgeBase: (id: string) => request<KnowledgeBaseDetail>(`/knowledge-bases/${encodeURIComponent(id)}`),
  listKnowledgeDocuments: (id: string) => request<KnowledgeDocument[]>(`/knowledge-bases/${encodeURIComponent(id)}/documents`),
  ingestKnowledgeDocument: (id: string, payload: { sourceName: string; content: string }) => request<IngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents`, { method: 'POST', body: JSON.stringify(payload) }),
  uploadKnowledgeDocument: (id: string, file: File) => { const body = new FormData(); body.append('file', file); return request<IngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents/upload`, { method: 'POST', body }) },
  uploadKnowledgeDocuments: (id: string, files: File[]) => { const body = new FormData(); files.forEach((file) => body.append('files', file)); return request<BatchIngestionResult>(`/knowledge-bases/${encodeURIComponent(id)}/documents/batch-upload`, { method: 'POST', body }) },
  deleteKnowledgeDocument: (baseId: string, documentId: string) => request<void>(`/knowledge-bases/${encodeURIComponent(baseId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  rebuildKnowledgeDocument: (baseId: string, documentId: string) => request<RebuildIndexResult>(`/knowledge-bases/${encodeURIComponent(baseId)}/documents/${encodeURIComponent(documentId)}/rebuild-index`, { method: 'POST' }),
  rebuildKnowledgeBase: (id: string) => request<RebuildIndexResult>(`/knowledge-bases/${encodeURIComponent(id)}/rebuild-index`, { method: 'POST' }),
  deleteKnowledgeBase: (id: string) => request<void>(`/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateKnowledgeBase: (id: string, payload: { name: string; description?: string }) => request<KnowledgeBase>(`/knowledge-bases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  clearKnowledgeDocuments: (id: string) => request<RebuildIndexResult>(`/knowledge-bases/${encodeURIComponent(id)}/clear-documents`, { method: 'POST' }),
  listNodes: () => request<NodeConnection[]>('/nodes'),
  createNodeRegistrationToken: (payload?: { ttlSeconds?: number }) => request<NodeRegistrationToken>('/node-registration-tokens', { method: 'POST', body: JSON.stringify(payload ?? {}) }),
  getNode: (id: string) => request<NodeDetail>(`/nodes/${encodeURIComponent(id)}`),
  updateNode: (id: string, payload: { name?: string; enabled?: boolean }) => request<NodeConnection>(`/nodes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteNode: (id: string) => request<void>(`/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  rotateNodeCredentials: (id: string) => request<RotateNodeSecretResult>(`/nodes/${encodeURIComponent(id)}/credentials/rotate`, { method: 'POST' }),
  updateNodeTool: (nodeId: string, toolName: string, payload: { enabled?: boolean; requiresApproval?: boolean }) => request<NodeTool>(`/nodes/${encodeURIComponent(nodeId)}/tools/${encodeURIComponent(toolName)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  listNodeToolApprovals: () => request<NodeToolApproval[]>('/node-tool-approvals'),
  decideNodeToolApproval: (id: string, approved: boolean) => request(`/node-tool-approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ approved }) }),
  setModelEnabled: (id: string, enabled: boolean) => request<ModelProfile>(`/models/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  setDefaultModel: (modelProfileId: string) => request<{ defaultModelProfileId: string }>('/models/settings/default', { method: 'PATCH', body: JSON.stringify({ modelProfileId }) }),
  getConversation: (id: string) => request<Conversation>(`/conversations/${id}`),
  createConversation: (title: string) => request<{ id: string }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  uploadConversationAttachments: (conversationId: string, files: File[]) => {
    const body = new FormData()
    files.forEach((file) => body.append('files', file))
    return request<ConversationAttachment[]>(`/conversations/${encodeURIComponent(conversationId)}/attachments`, { method: 'POST', body })
  },
  createRun: (payload: {
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
  }) => request<CreateRunResponse>('/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  cancelRun: (id: string) => request<void>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  getRun: (id: string) => request<RunView>(`/runs/${encodeURIComponent(id)}`),
  getConversationQueue: (id: string) => request<ConversationQueue>(`/conversations/${encodeURIComponent(id)}/queue`),
  getCodingEvidence: (id: string) => request<CodingRunEvidence>(`/runs/${encodeURIComponent(id)}/coding-evidence`),
  getCodingQuality: (id: string) => request<CodingRunQuality>(`/runs/${encodeURIComponent(id)}/coding-quality`),
}

export async function streamRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
) {
  let lastEventId = ''
  let retryCount = 0
  let terminal = false

  while (!terminal) {
    if (signal?.aborted) throw new DOMException('The run stream was aborted.', 'AbortError')
    let response: Response
    try {
      response = await fetch(`${API_ROOT}/runs/${encodeURIComponent(runId)}/events`, {
        headers: {
          Accept: 'text/event-stream',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
          'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
          'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
          ...authenticationHeaders(),
        },
        signal,
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (retryCount >= 3) throw new Error('The run stream disconnected after three retries.')
      await waitForRetry(retryCount++, signal)
      continue
    }

    if (!response.ok || !response.body) throw new Error(`Unable to connect to run stream (${response.status})`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let ended = false
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.id) lastEventId = event.id
        if (!event.data) return
        try {
          const parsed = JSON.parse(event.data) as RunEvent
          onEvent(parsed)
          if (['FINAL_ANSWER', 'RUN_FAILED', 'RUN_CANCELLED'].includes(parsed.type)) terminal = true
        } catch {
          // Ignore keep-alive frames and malformed non-domain frames.
        }
      },
    })

    while (!ended) {
      const chunk = await reader.read()
      ended = chunk.done
      if (chunk.value) parser.feed(decoder.decode(chunk.value, { stream: !ended }))
    }
    if (!terminal) {
      if (retryCount >= 3) throw new Error('The run stream ended before a final answer was received.')
      await waitForRetry(retryCount++, signal)
    }
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
