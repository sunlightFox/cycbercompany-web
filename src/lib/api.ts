import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { Agent, Conversation, CreateRunResponse, ModelProfile, RunEvent } from '../types'

const API_ROOT = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
      'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed with ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const studioApi = {
  listAgents: () => request<Agent[]>('/agents'),
  listModels: () => request<ModelProfile[]>('/models'),
  getConversation: (id: string) => request<Conversation>(`/conversations/${id}`),
  createConversation: (title: string) => request<{ id: string }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }),
  createRun: (payload: {
    conversationId: string
    text: string
    agentId?: string
    modelProfileId?: string
    knowledgeBaseIds?: string[]
    skillIds?: string[]
    mcpServerIds?: string[]
    toolNames?: string[]
  }) => request<CreateRunResponse>('/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
}

export async function streamRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_ROOT}/runs/${runId}/events`, {
    headers: {
      Accept: 'text/event-stream',
      'X-Tenant-Id': localStorage.getItem('studio-tenant') ?? 'local',
      'X-User-Id': localStorage.getItem('studio-user') ?? 'local-user',
    },
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Unable to connect to run stream (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let ended = false
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (!event.data) return
      try {
        onEvent(JSON.parse(event.data) as RunEvent)
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
}
