import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Copy,
  Database,
  ExternalLink,
  FileText,
  FolderKanban,
  Globe2,
  HardDrive,
  History,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Moon,
  Paperclip,
  Package,
  Pencil,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  Upload,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Children, useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { studioApi, streamRunEvents } from "./lib/api";
import { useStudioStore } from "./store/useStudioStore";
import type {
  Agent,
  Citation,
  CodingRunEvidence,
  CodingRunQuality,
  KnowledgeBase,
  KnowledgeDocument,
  McpConnection,
  McpRepository,
  McpTool,
  McpToolInvocation,
  Message,
  ModelCapability,
  ModelPreset,
  ModelProfile,
  ModelTestResult,
  NodeConnection,
  NodeRegistrationToken,
  NodeTool,
  NodeToolApproval,
  RepositorySkill,
  RotateNodeSecretResult,
  RunEvent,
  RunStep,
  Skill,
  SkillRepository,
  StudioMessage,
  Tool,
} from "./types";
import "./App.css";

type Attachment = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  kind: "file" | "image";
  previewUrl?: string;
};
type CapabilityState = {
  knowledgeBaseIds: string[];
  skillIds: string[];
  mcpServerIds: string[];
  toolNames: string[];
  nodeId?: string;
};
type CapabilityArrayKey =
  | "knowledgeBaseIds"
  | "skillIds"
  | "mcpServerIds"
  | "toolNames";
type HistoryEntry = { id: string; title: string; updatedAt: string };

const HISTORY_STORAGE_KEY = "studio-conversation-history";
const CITATION_STORAGE_KEY = "studio-conversation-citations";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function readHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is HistoryEntry =>
            Boolean(item?.id && item?.title && item?.updatedAt),
          )
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]) {
  localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(entries.slice(0, 30)),
  );
}

function citationStorageKey(conversationId: string, runId: string) {
  return `${conversationId}:${runId}`;
}

function readCitationCache() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(CITATION_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, Citation[]>)
      : {};
  } catch {
    return {};
  }
}

function persistCitations(
  conversationId: string,
  runId: string,
  citations: Citation[],
) {
  const cache = readCitationCache();
  const key = citationStorageKey(conversationId, runId);
  if (citations.length) cache[key] = citations;
  else delete cache[key];
  const entries = Object.entries(cache).slice(-100);
  localStorage.setItem(
    CITATION_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(entries)),
  );
}

function cachedCitations(conversationId: string, message: Message) {
  if (!message.runId) return [];
  return readCitationCache()[citationStorageKey(conversationId, message.runId)] ?? [];
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  tooltip = true,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  tooltip?: boolean;
  disabled?: boolean;
}) {
  const button = (
    <button
      className={`icon-button ${active ? "is-active" : ""}`}
      aria-label={label}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ConfirmDeleteButton({
  name,
  description,
  busy = false,
  onConfirm,
}: {
  name: string;
  description: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <span className="row-delete-confirm" role="alert">
        <span>
          <strong>{name}</strong>
          <small>{description}</small>
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          {t("cancel")}
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : null}
          {t("delete")}
        </button>
      </span>
    );
  return (
    <IconButton
      label={`${t("delete")} ${name}`}
      onClick={() => setConfirming(true)}
    >
      <Trash2 size={14} />
    </IconButton>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const theme = useStudioStore((state) => state.theme);
  const sidebarOpen = useStudioStore((state) => state.sidebarOpen);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const sourceCitationId = useStudioStore((state) => state.sourceCitationId);
  const selectedAgentId = useStudioStore((state) => state.selectedAgentId);
  const conversationId = useStudioStore((state) => state.conversationId);
  const messages = useStudioStore((state) => state.messages);
  const setTheme = useStudioStore((state) => state.setTheme);
  const toggleSidebar = useStudioStore((state) => state.toggleSidebar);
  const setSettingsOpen = useStudioStore((state) => state.setSettingsOpen);
  const setSourceCitationId = useStudioStore(
    (state) => state.setSourceCitationId,
  );
  const setSelectedAgentId = useStudioStore(
    (state) => state.setSelectedAgentId,
  );
  const setConversationId = useStudioStore((state) => state.setConversationId);
  const setMessages = useStudioStore((state) => state.setMessages);
  const setBackendAvailable = useStudioStore(
    (state) => state.setBackendAvailable,
  );
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [expandedMessageId, setExpandedMessageId] = useState<
    string | number | null
  >(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [managerTab, setManagerTab] = useState("agents");
  const [capabilityState, setCapabilityState] = useState<CapabilityState>({
    knowledgeBaseIds: [],
    skillIds: [],
    mcpServerIds: [],
    toolNames: [],
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] =
    useState<HistoryEntry[]>(readHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(
    null,
  );
  const [recoveryRunId, setRecoveryRunId] = useState<string | null>(null);
  const [auditRunId, setAuditRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);
  const runSessionRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return [];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === id);
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clearSentAttachments = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const sent = new Set(ids);
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (sent.has(attachment.id) && attachment.previewUrl)
          URL.revokeObjectURL(attachment.previewUrl);
      });
      return current.filter((attachment) => !sent.has(attachment.id));
    });
  }, []);

  const updateAssistant = useCallback(
    (runId: string, updater: (message: StudioMessage) => StudioMessage) => {
      setMessages(
        useStudioStore
          .getState()
          .messages.map((message) =>
            message.runId === runId ? updater(message) : message,
          ),
      );
    },
    [setMessages],
  );

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: studioApi.listAgents,
    retry: 1,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: studioApi.listModels,
    retry: 1,
  });

  useEffect(() => {
    if (!recoveryRunId) return;
    let disposed = false;
    const refreshRun = async () => {
      try {
        const run = await studioApi.getRun(recoveryRunId);
        if (disposed) return;
        const terminal = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
          run.status,
        );
        updateAssistant(run.id, (message) => {
          const completedSteps = (message.steps ?? []).map((step) =>
            step.status === "failed"
              ? step
              : { ...step, status: "complete" as const, duration: step.duration ?? t("stepDone") },
          );
          if (run.status === "SUCCEEDED")
            return {
              ...message,
              content: run.finalAnswer || message.content,
              steps: completedSteps,
              isStreaming: false,
              runState: "completed",
              error: undefined,
              durationMs: elapsedSince(message.createdAt),
            };
          if (run.status === "FAILED" || run.status === "TIMED_OUT")
            return {
              ...message,
              steps: completedSteps.map((step) => ({
                ...step,
                status: "failed" as const,
                duration: t("stepFailed"),
              })),
              isStreaming: false,
              runState: "failed",
              error: run.errorMessage || t("runFailed"),
              durationMs: elapsedSince(message.createdAt),
            };
          if (run.status === "CANCELLED")
            return {
              ...message,
              steps: completedSteps,
              isStreaming: false,
              runState: "cancelled",
              error: t("runCancelled"),
              durationMs: elapsedSince(message.createdAt),
            };
          if (run.status === "WAITING_APPROVAL")
            return {
              ...message,
              isStreaming: true,
              runState: "waitingApproval",
            };
          if (run.status === "NEEDS_VERIFICATION")
            return {
              ...message,
              isStreaming: true,
              runState: "needsVerification",
            };
          if (run.status === "QUEUED" || run.status === "CREATED")
            return {
              ...message,
              isStreaming: true,
              queuePosition: run.queuePosition ?? message.queuePosition,
              runState: "queued",
            };
          return { ...message, isStreaming: true, runState: "running" };
        });
        if (terminal) {
          setRecoveryRunId(null);
          if (activeRunIdRef.current === run.id) activeRunIdRef.current = null;
          setIsRunning(false);
          setIsStopping(false);
          setComposerNotice(null);
        }
      } catch {
        if (!disposed) setComposerNotice(t("streamDisconnected"));
      }
    };
    void refreshRun();
    const timer = window.setInterval(() => void refreshRun(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [recoveryRunId, t, updateAssistant]);
  const availableAgents = agentsQuery.data ?? [];
  const availableModels = modelsQuery.data ?? [];
  const defaultModelProfileId = modelsQuery.data?.find(
    (model) => model.defaultProfile,
  )?.id;
  const currentAgent =
    availableAgents.find((agent) => agent.id === selectedAgentId) ??
    availableAgents[0];
  const backendAvailable = agentsQuery.isSuccess && modelsQuery.isSuccess;
  const toolsQuery = useQuery({
    queryKey: ["tools"],
    queryFn: studioApi.listTools,
    retry: 1,
    enabled: backendAvailable,
  });
  const knowledgeBasesQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: studioApi.listKnowledgeBases,
    retry: 1,
    enabled: backendAvailable,
  });
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: studioApi.listSkills,
    retry: 1,
    enabled: backendAvailable,
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: studioApi.listMcpConnections,
    retry: 1,
    enabled: backendAvailable,
  });
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: studioApi.listNodes,
    retry: 1,
    enabled: backendAvailable,
  });
  const selectedCitation = messages
    .flatMap((message) => message.citations ?? [])
    .find((citation) => citation.id === sourceCitationId);
  const auditEvidenceQuery = useQuery({
    queryKey: ["run-audit-evidence", auditRunId],
    queryFn: () => studioApi.getCodingEvidence(auditRunId ?? ""),
    enabled: Boolean(auditRunId) && backendAvailable,
    retry: 1,
  });
  const auditQualityQuery = useQuery({
    queryKey: ["run-audit-quality", auditRunId],
    queryFn: () => studioApi.getCodingQuality(auditRunId ?? ""),
    enabled: Boolean(auditRunId) && backendAvailable,
    retry: 1,
  });
  const lastMessage = messages[messages.length - 1];
  const currentHistory = conversationId
    ? historyEntries.find((entry) => entry.id === conversationId)
    : undefined;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = i18n.language === "en" ? "en" : "zh-CN";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101111" : "#f7f7f5");
  }, [i18n.language, theme]);

  useEffect(() => {
    setBackendAvailable(backendAvailable);
    if (
      agentsQuery.data?.[0] &&
      !agentsQuery.data.some((agent) => agent.id === selectedAgentId)
    )
      setSelectedAgentId(agentsQuery.data[0].id);
  }, [
    agentsQuery.data,
    backendAvailable,
    selectedAgentId,
    setBackendAvailable,
    setSelectedAgentId,
  ]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const distanceFromBottom =
      stage.scrollHeight - stage.scrollTop - stage.clientHeight;
    if (distanceFromBottom < 260) stage.scrollTop = stage.scrollHeight;
  }, [messages.length, lastMessage?.content, lastMessage?.isStreaming]);

  const rememberConversation = useCallback(
    (id: string, title: string) => {
      setHistoryEntries((current) => {
        const existing = current.find((entry) => entry.id === id);
        const next = [
          {
            id,
            title: (existing?.title ?? title) || t("newTask"),
            updatedAt: new Date().toISOString(),
          },
          ...current.filter((entry) => entry.id !== id),
        ];
        writeHistory(next);
        return next;
      });
    },
    [t],
  );

  const resetTask = useCallback(() => {
    const activeRunId = activeRunIdRef.current;
    runSessionRef.current += 1;
    if (activeRunId)
      void studioApi.cancelRun(activeRunId).catch(() => undefined);
    abortRef.current?.abort();
    stopRequestedRef.current = false;
    activeRunIdRef.current = null;
    setIsRunning(false);
    setIsStopping(false);
    setConversationId(null);
    setMessages([]);
    setPrompt("");
    clearAttachments();
    setCapabilityState({
      knowledgeBaseIds: [],
      skillIds: [],
      mcpServerIds: [],
      toolNames: [],
    });
    setComposerNotice(null);
    setSourceCitationId(null);
    setExpandedMessageId(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [clearAttachments, setConversationId, setMessages, setSourceCitationId]);

  const handleRunEvent = useCallback(
    (runId: string, conversationId: string, event: RunEvent) => {
      updateAssistant(runId, (message) => {
        const steps = [...(message.steps ?? [])];
        const completePrevious = (failed = false) =>
          steps.map((step) =>
            step.status === "running" || step.status === "waiting"
              ? {
                  ...step,
                  status: failed ? ("failed" as const) : ("complete" as const),
                  duration: step.duration ?? (failed ? t("stepFailed") : t("stepDone")),
                }
              : step,
          );
        if (event.type === "SKILLS_RESOLVED")
          steps.push({
            id: `${runId}-skills-${event.sequence}`,
            label: t("resolveCapabilities"),
            status: "complete",
            duration: t("stepDone"),
          });
        if (event.type === "RUN_QUEUED") {
          const queuePosition = extractQueuePosition(event.payload);
          steps.push({
            id: `${runId}-queue-${event.sequence}`,
            label: t("queued"),
            detail:
              queuePosition && queuePosition > 1
                ? queuePositionLabel(t, queuePosition)
                : t("queueStarting"),
            status: "waiting",
          });
          return {
            ...message,
            steps,
            isStreaming: true,
            queuePosition: queuePosition ?? message.queuePosition,
            runState: "queued",
          };
        }
        if (event.type === "RUN_STARTED") {
          steps.splice(0, steps.length, ...completePrevious());
          steps.push({
            id: `${runId}-start`,
            label: t("startCoordinator"),
            status: "complete",
            duration: t("stepReady"),
          });
        }
        if (event.type === "STEP_STARTED")
          steps.push({
            id: `${runId}-step-${event.sequence}`,
            label: t("executeEmployee"),
            detail: event.payload,
            status: "running",
          });
        if (event.type === "RETRIEVAL_COMPLETED") {
          const next = completePrevious();
          next.push({
            id: `${runId}-retrieval-${event.sequence}`,
            label: t("retrieveContext"),
            detail: event.payload,
            status: "complete",
          });
          steps.splice(0, steps.length, ...next);
        }
        if (event.type === "RETRIEVAL_SOURCES") {
          const citations = parseRunCitations(event.payload);
          persistCitations(conversationId, runId, citations);
          return { ...message, citations, steps };
        }
        if (event.type === "TOOL_CALL_REQUESTED")
          steps.push({
            id: `${runId}-tool-${event.sequence}`,
            label: t("requestTool"),
            detail: event.payload,
            status: "running",
          });
        if (event.type === "TOOL_CALL_STARTED") {
          const active = [...steps]
            .reverse()
            .find(
              (step) =>
                step.status === "running" && step.label === t("requestTool"),
            );
          if (active) active.label = t("runTool");
          else
            steps.push({
              id: `${runId}-tool-${event.sequence}`,
              label: t("runTool"),
              detail: event.payload,
              status: "running",
            });
        }
        if (
          event.type === "TOOL_CALL_COMPLETED" ||
          event.type === "TOOL_CALL_FAILED"
        ) {
          const active = [...steps]
            .reverse()
            .find(
              (step) =>
                step.status === "running" &&
                (step.label === t("requestTool") ||
                  step.label === t("runTool")),
            );
          if (active) {
            active.status =
              event.type === "TOOL_CALL_FAILED" ? "failed" : "complete";
            active.detail = event.payload;
            active.duration =
              event.type === "TOOL_CALL_FAILED" ? t("stepFailed") : t("stepDone");
          } else
            steps.push({
              id: `${runId}-tool-${event.sequence}`,
              label: t("runTool"),
              detail: event.payload,
              status: event.type === "TOOL_CALL_FAILED" ? "failed" : "complete",
              duration:
                event.type === "TOOL_CALL_FAILED"
                  ? t("stepFailed")
                  : t("stepDone"),
            });
        }
        if (event.type === "MODEL_RATE_LIMITED")
          steps.push({
            id: `${runId}-rate-limit-${event.sequence}`,
            label: t("modelRateLimited"),
            detail: event.payload,
            status: "warning",
          });
        if (event.type === "TOOL_BUDGET_WARNING")
          steps.push({
            id: `${runId}-tool-budget-${event.sequence}`,
            label: t("toolBudgetWarning"),
            detail: event.payload,
            status: "warning",
          });
        if (
          event.type === "TOOL_APPROVAL_REQUIRED" ||
          event.type === "RUN_WAITING_APPROVAL"
        ) {
          const active = [...steps]
            .reverse()
            .find((step) => step.status === "running");
          if (active) {
            active.status = "waiting";
            active.detail = event.payload || active.detail;
          } else
            steps.push({
              id: `${runId}-approval-${event.sequence}`,
              label: t("awaitingApproval"),
              detail: event.payload,
              status: "waiting",
            });
          return {
            ...message,
            steps,
            approvalId: extractApprovalId(event.payload) ?? message.approvalId,
            approvalDecision: "pending",
            isStreaming: true,
            runState: "waitingApproval",
          };
        }
        if (event.type === "RUN_RESUMED") {
          steps.splice(0, steps.length, ...completePrevious());
          steps.push({
            id: `${runId}-resumed-${event.sequence}`,
            label: t("runResumed"),
            detail: event.payload,
            status: "running",
          });
          return { ...message, steps, isStreaming: true, runState: "running" };
        }
        if (event.type === "RUN_NEEDS_VERIFICATION") {
          steps.push({
            id: `${runId}-verification-${event.sequence}`,
            label: t("needsVerification"),
            detail: event.payload,
            status: "warning",
          });
          return {
            ...message,
            steps,
            isStreaming: true,
            runState: "needsVerification",
          };
        }
        if (event.type === "TOKEN_DELTA") {
          const next = steps.length
            ? steps
            : [
                {
                  id: `${runId}-answer`,
                  label: t("organizeAnswer"),
                  status: "running" as const,
                },
              ];
          if (
            !next.some(
              (step) =>
                step.label === t("organizeAnswer") && step.status === "running",
            )
          )
            next.push({
              id: `${runId}-answer`,
              label: t("organizeAnswer"),
              status: "running",
            });
          return {
            ...message,
            content: `${message.content}${event.payload}`,
            steps: next,
            isStreaming: true,
            runState: "running",
          };
        }
        if (event.type === "STEP_COMPLETED")
          steps.splice(0, steps.length, ...completePrevious());
        if (event.type === "FINAL_ANSWER") {
          const content = event.payload || message.content;
          const citations = message.citations ?? [];
          persistCitations(conversationId, runId, citations);
          return {
            ...message,
            content,
            citations,
            steps: completePrevious(),
            isStreaming: false,
            runState: "completed",
            durationMs: elapsedSince(message.createdAt),
          };
        }
        if (event.type === "RUN_FAILED")
          return {
            ...message,
            steps: completePrevious(true),
            isStreaming: false,
            runState: "failed",
            error: event.payload || t("runFailed"),
            durationMs: elapsedSince(message.createdAt),
          };
        if (event.type === "RUN_CANCELLED")
          return {
            ...message,
            steps: completePrevious(true),
            isStreaming: false,
            runState: "cancelled",
            error: t("runCancelled"),
            durationMs: elapsedSince(message.createdAt),
          };
        return {
          ...message,
          steps,
          runState:
            event.type === "RUN_STARTED" || event.type === "STEP_STARTED"
              ? "running"
              : message.runState,
        };
      });
    },
    [t, updateAssistant],
  );

  const ensureConversation = useCallback(
    async (title: string) => {
      const state = useStudioStore.getState();
      if (state.conversationId) {
        rememberConversation(state.conversationId, title);
        return state.conversationId;
      }
      const result = await studioApi.createConversation(title || t("newTask"));
      setConversationId(result.id);
      rememberConversation(result.id, title);
      return result.id;
    },
    [rememberConversation, setConversationId, t],
  );

  const openConversation = useCallback(
    async (id: string) => {
      if (isRunning) {
        setComposerNotice(t("taskRunningSwitchBlocked"));
        setHistoryOpen(false);
        setSearchOpen(false);
        return;
      }
      try {
        const conversation = await studioApi.getConversation(id);
        setConversationId(conversation.id);
        setMessages(
          conversation.messages.map((message) => ({
            ...message,
            citations: cachedCitations(conversation.id, message),
          })),
        );
        setHistoryOpen(false);
        setSearchOpen(false);
        setComposerNotice(null);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } catch (error) {
        setComposerNotice(
          error instanceof Error ? error.message : t("loadFailed"),
        );
      }
    },
    [isRunning, setConversationId, setMessages, t],
  );

  const handleSend = useCallback(
    async (overrideText?: string, retryAttachmentIds?: string[]) => {
      const rawText = overrideText ?? prompt;
      const text = rawText.trim();
      const localAttachments = retryAttachmentIds ? [] : attachments;
      if ((!text && !localAttachments.length && !retryAttachmentIds?.length) || isRunning)
        return;
      const runInput = text || t("attachmentOnlyPrompt");
      const displayInput =
        text || t("attachmentOnlyPrompt");
      setPrompt("");
      setComposerNotice(null);
      setIsRunning(true);
      setIsStopping(false);
      stopRequestedRef.current = false;
      const sessionId = ++runSessionRef.current;
      const userMessage: StudioMessage = {
        id: `user-${Date.now()}`,
        role: "USER",
        content: displayInput,
        attachmentSummaries: localAttachments.map((attachment) => ({
          name: attachment.name,
          kind: attachment.kind,
        })),
        createdAt: new Date().toISOString(),
      };
      const runId = `pending-${Date.now()}`;
      const assistantMessage: StudioMessage = {
        id: `assistant-${Date.now()}`,
        role: "ASSISTANT",
        content: "",
        runId,
        retryInput: text,
        steps: [],
        isStreaming: true,
        runState: "queued",
        createdAt: new Date().toISOString(),
      };
      setMessages([
        ...useStudioStore.getState().messages,
        userMessage,
        assistantMessage,
      ]);
      let serverRunId: string | null = null;
      let shouldRecoverRun = false;
      try {
        const conversation = await ensureConversation(
          (text || localAttachments[0]?.name || t("newTask")).slice(0, 64),
        );
        const attachmentIds = retryAttachmentIds ?? (
          localAttachments.length
            ? (await studioApi.uploadConversationAttachments(
                conversation,
                localAttachments.map((attachment) => attachment.file),
              )).map(
                (attachment) => attachment.id,
              )
            : []
        );
        const selectedCapabilities = {
          ...(capabilityState.knowledgeBaseIds.length
            ? { knowledgeBaseIds: capabilityState.knowledgeBaseIds }
            : {}),
          ...(capabilityState.skillIds.length
            ? { skillIds: capabilityState.skillIds }
            : {}),
          ...(capabilityState.mcpServerIds.length
            ? { mcpServerIds: capabilityState.mcpServerIds }
            : {}),
          ...(capabilityState.toolNames.length
            ? { toolNames: capabilityState.toolNames }
            : {}),
          ...(capabilityState.nodeId ? { nodeId: capabilityState.nodeId } : {}),
        };
        const run = await studioApi.createRun({
          conversationId: conversation,
          text: runInput,
          agentId: currentAgent?.id,
          modelProfileId:
            defaultModelProfileId ?? currentAgent?.defaultModelProfileId,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...selectedCapabilities,
        });
        serverRunId = run.runId;
        if (!retryAttachmentIds?.length)
          clearSentAttachments(localAttachments.map((attachment) => attachment.id));
        if (sessionId !== runSessionRef.current) {
          await studioApi.cancelRun(run.runId).catch(() => undefined);
          return;
        }
        activeRunIdRef.current = run.runId;
        updateAssistant(runId, (message) => ({
          ...message,
          runId: run.runId,
          attachmentIds,
          queuePosition: run.queuePosition,
          runState: "queued",
        }));
        const controller = new AbortController();
        abortRef.current = controller;
        await streamRunEvents(
          run.runId,
          (event) => handleRunEvent(run.runId, conversation, event),
          controller.signal,
        );
      } catch (error) {
        if (sessionId !== runSessionRef.current) return;
        if (!overrideText && rawText)
          setPrompt((current) => current || rawText);
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (aborted && !stopRequestedRef.current)
          updateAssistant(runId, (assistant) => ({
            ...assistant,
            isStreaming: false,
            error: t("streamDisconnected"),
          }));
        else if (aborted)
          updateAssistant(runId, (assistant) => ({
            ...assistant,
            isStreaming: false,
            error: t("runCancelled"),
            durationMs: elapsedSince(assistant.createdAt),
          }));
        else if (serverRunId) {
          shouldRecoverRun = true;
          setRecoveryRunId(serverRunId);
          setComposerNotice(t("streamDisconnected"));
          updateAssistant(runId, (assistant) => ({
            ...assistant,
            isStreaming: true,
            error: undefined,
          }));
        } else
          updateAssistant(runId, (assistant) => ({
            ...assistant,
            isStreaming: false,
            error: backendAvailable
              ? error instanceof Error
                ? error.message
                : String(error)
              : t("backendOffline"),
            durationMs: elapsedSince(assistant.createdAt),
          }));
      } finally {
        if (sessionId === runSessionRef.current) {
          abortRef.current = null;
          if (!shouldRecoverRun) {
            activeRunIdRef.current = null;
            setIsRunning(false);
          }
          setIsStopping(false);
        }
      }
    },
    [
      attachments,
      backendAvailable,
      capabilityState,
      clearSentAttachments,
      currentAgent?.defaultModelProfileId,
      currentAgent?.id,
      defaultModelProfileId,
      ensureConversation,
      handleRunEvent,
      isRunning,
      prompt,
      setMessages,
      t,
      updateAssistant,
    ],
  );

  const handleStop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (!runId || isStopping) return;
    stopRequestedRef.current = true;
    setIsStopping(true);
    setComposerNotice(t("stoppingRun"));
    try {
      await studioApi.cancelRun(runId);
    } catch (error) {
      setIsStopping(false);
      setComposerNotice(
        error instanceof Error ? error.message : t("runFailed"),
      );
    }
  }, [isStopping, t]);

  const handleCopy = async (message: StudioMessage) => {
    try {
      await navigator.clipboard?.writeText(message.content);
    } catch {
      /* Clipboard can be unavailable in an insecure preview. */
    }
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const retryMessage = useCallback(
    (message: StudioMessage) => {
      const index = useStudioStore
        .getState()
        .messages.findIndex((item) => item.id === message.id);
      const previous =
        index > 0 ? useStudioStore.getState().messages[index - 1] : undefined;
      if (previous?.role === "USER")
        void handleSend(message.retryInput ?? previous.content, message.attachmentIds);
    },
    [handleSend],
  );

  const handleApproval = useCallback(
    async (message: StudioMessage, approved: boolean) => {
      if (!message.runId || !message.approvalId || approvingApprovalId) return;
      setApprovingApprovalId(message.approvalId);
      try {
        await studioApi.decideNodeToolApproval(message.approvalId, approved);
        updateAssistant(message.runId, (current) => ({
          ...current,
          approvalDecision: approved ? "approved" : "rejected",
        }));
      } catch (error) {
        updateAssistant(message.runId, (current) => ({
          ...current,
          approvalDecision: "error",
          error: error instanceof Error ? error.message : t("runFailed"),
        }));
      } finally {
        setApprovingApprovalId(null);
      }
    },
    [approvingApprovalId, t, updateAssistant],
  );

  const handleAttach = (files: File[]) => {
    const accepted: Attachment[] = [];
    let hasOversizedFile = false;
    let hasLimitedAttachment = false;

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        hasOversizedFile = true;
        continue;
      }
      const isImage = file.type.startsWith("image/");
      const isText =
        file.type.startsWith("text/") ||
        /\.(md|txt|csv|json|xml|log)$/i.test(file.name);
      if (!isText) hasLimitedAttachment = true;
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        kind: isImage ? "image" : "file",
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }

    if (accepted.length) {
      setAttachments((current) => {
        const existing = new Set(
          current.map(
            (file) => `${file.name}-${file.size}-${file.type}-${file.kind}`,
          ),
        );
        const additions = accepted.filter((file) => {
          const key = `${file.name}-${file.size}-${file.type}-${file.kind}`;
          if (!existing.has(key)) return true;
          if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
          return false;
        });
        return [...current, ...additions];
      });
    }

    setComposerNotice(
      hasOversizedFile
        ? t("attachTooLarge")
        : hasLimitedAttachment
          ? t("attachmentModelLimited")
          : null,
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="studio-shell">
        <Sidebar
          expanded={sidebarExpanded}
          mobileOpen={sidebarOpen}
          onExpandedChange={setSidebarExpanded}
          historyEntries={historyEntries}
          currentConversationId={conversationId}
          onNewTask={resetTask}
          onSearch={() => {
            setSearchOpen(true);
            if (sidebarOpen) toggleSidebar();
          }}
          onHistory={() => {
            setHistoryOpen(true);
            if (sidebarOpen) toggleSidebar();
          }}
          onOpenConversation={openConversation}
          onManage={() => {
            setManagerTab("agents");
            setSettingsOpen(true);
            if (sidebarOpen) toggleSidebar();
          }}
          onSettings={() => {
            setManagerTab("models");
            setSettingsOpen(true);
            if (sidebarOpen) toggleSidebar();
          }}
          onCloseMobile={toggleSidebar}
          t={t}
        />
        {sidebarOpen ? (
          <button
            className="sidebar-scrim"
            type="button"
            aria-label={t("close")}
            onClick={toggleSidebar}
          />
        ) : null}
        <main className="studio-main">
          <header className="topbar">
            <div className="topbar-leading">
              <IconButton label={t("workspace")} onClick={toggleSidebar}>
                <Menu size={18} />
              </IconButton>
              <div className="conversation-title">
                <span className="status-dot" data-online={backendAvailable} />
                <span>
                  {conversationId
                    ? (currentHistory?.title ?? t("newTask"))
                    : t("workspace")}
                </span>
              </div>
            </div>
            <div className="topbar-actions">
              <AgentSelect
                agents={availableAgents}
                currentAgent={currentAgent}
                onChange={setSelectedAgentId}
                t={t}
              />
              <button
                className="manage-button"
                type="button"
                aria-label={t("manage")}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 size={15} />
                <span>{t("manage")}</span>
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="icon-button"
                    aria-label={t("more")}
                    type="button"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="menu"
                    align="end"
                    sideOffset={8}
                  >
                    <DropdownMenu.Label className="menu-label">
                      {t("settings")}
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() =>
                        setTheme(theme === "light" ? "dark" : "light")
                      }
                    >
                      {theme === "light" ? (
                        <Moon size={15} />
                      ) : (
                        <Sun size={15} />
                      )}{" "}
                      {theme === "light" ? t("dark") : t("light")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() =>
                        void i18n.changeLanguage(
                          i18n.language === "zh" ? "en" : "zh",
                        )
                      }
                    >
                      {i18n.language === "zh" ? t("english") : t("chinese")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="menu-separator" />
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={resetTask}
                    >
                      <Plus size={15} /> {t("newTask")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>
          <section
            className="conversation-stage"
            aria-label={t("workspace")}
            aria-live="off"
            ref={stageRef}
          >
            <div className="message-feed">
              {messages.length === 0 ? (
                <EmptyState
                  onPrompt={(value) => {
                    setPrompt(value);
                    textareaRef.current?.focus();
                  }}
                  t={t}
                />
              ) : (
                messages.map((message) => (
                  <MessageBlock
                    key={message.id}
                    message={message}
                    expanded={expandedMessageId === message.id}
                    onToggle={() =>
                      setExpandedMessageId(
                        expandedMessageId === message.id ? null : message.id,
                      )
                    }
                    onCitation={setSourceCitationId}
                    onCopy={() => void handleCopy(message)}
                    onRetry={() => retryMessage(message)}
                    onViewAudit={() => setAuditRunId(message.runId ?? null)}
                    onApproval={handleApproval}
                    approving={approvingApprovalId === message.approvalId}
                    copied={copiedId === message.id}
                    t={t}
                  />
                ))
              )}
            </div>
          </section>
          <span className="visually-hidden" role="status" aria-live="polite">
            {composerNotice ?? (isRunning ? t("running") : "")}
          </span>
          <Composer
            value={prompt}
            onChange={setPrompt}
            onKeyDown={handleKeyDown}
            onSend={() => void handleSend()}
            onStop={() => void handleStop()}
            running={isRunning}
            stopping={isStopping}
            backendAvailable={backendAvailable}
            textareaRef={textareaRef}
            t={t}
            onAttach={(files) => void handleAttach(files)}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            composerNotice={composerNotice}
            toolsQuery={toolsQuery}
            knowledgeBasesQuery={knowledgeBasesQuery}
            skillsQuery={skillsQuery}
            mcpQuery={mcpQuery}
            nodesQuery={nodesQuery}
            capabilityState={capabilityState}
            onCapabilityChange={setCapabilityState}
          />
        </main>
        {settingsOpen ? (
          <ConfigurationWorkspace
            tab={managerTab}
            setTab={setManagerTab}
            agents={availableAgents}
            models={availableModels}
            onClose={() => setSettingsOpen(false)}
            t={t}
          />
        ) : null}
        {selectedCitation ? (
          <CitationDrawer
            citation={selectedCitation}
            onClose={() => setSourceCitationId(null)}
            t={t}
          />
        ) : null}
        {auditRunId ? (
          <RunAuditDrawer
            evidence={auditEvidenceQuery.data}
            quality={auditQualityQuery.data}
            loading={auditEvidenceQuery.isLoading || auditQualityQuery.isLoading}
            error={auditEvidenceQuery.isError || auditQualityQuery.isError}
            onClose={() => setAuditRunId(null)}
            t={t}
          />
        ) : null}
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          messages={messages}
          t={t}
        />
        <HistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          entries={historyEntries}
          currentId={conversationId}
          onOpenConversation={openConversation}
          t={t}
        />
      </div>
    </Tooltip.Provider>
  );
}

function Sidebar({
  expanded,
  mobileOpen,
  onExpandedChange,
  historyEntries,
  currentConversationId,
  onNewTask,
  onSearch,
  onHistory,
  onOpenConversation,
  onManage,
  onSettings,
  onCloseMobile,
  t,
}: {
  expanded: boolean;
  mobileOpen: boolean;
  onExpandedChange: (open: boolean) => void;
  historyEntries: HistoryEntry[];
  currentConversationId: string | null;
  onNewTask: () => void;
  onSearch: () => void;
  onHistory: () => void;
  onOpenConversation: (id: string) => void;
  onManage: () => void;
  onSettings: () => void;
  onCloseMobile: () => void;
  t: (key: string) => string;
}) {
  const closePanel = () => onExpandedChange(false);
  const openTask = () => {
    onNewTask();
    closePanel();
  };
  const openSearch = () => {
    onSearch();
    closePanel();
  };
  const openHistory = () => {
    onHistory();
    closePanel();
  };
  const openManager = () => {
    onManage();
    closePanel();
  };
  const openSettings = () => {
    onSettings();
    closePanel();
  };
  const recentEntries = historyEntries.slice(0, 5);
  const panelOpen = expanded || mobileOpen;

  return (
    <aside
      className={`sidebar ${expanded ? "is-expanded" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
    >
      <div className="sidebar-brand">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              className="brand-trigger"
              type="button"
              aria-label={t("workspace")}
              aria-expanded={expanded}
              aria-controls="workspace-navigation-panel"
              onClick={() => onExpandedChange(!expanded)}
            >
              <span className="brand-mark">
                <Sparkles size={15} />
              </span>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="tooltip" side="right" sideOffset={8}>
              {t("workspace")}
              <Tooltip.Arrow className="tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <button
          className="mobile-close"
          onClick={onCloseMobile}
          type="button"
          aria-label={t("close")}
        >
          <X size={17} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label={t("workspace")}>
        <RailButton label={t("newTask")} onClick={openTask} variant="command">
          <Plus size={18} />
        </RailButton>
        <RailButton label={t("search")} onClick={openSearch}>
          <Search size={18} />
        </RailButton>
        <RailButton label={t("history")} onClick={openHistory}>
          <History size={18} />
        </RailButton>
      </nav>
      <div className="sidebar-spacer" />
      <nav className="sidebar-nav sidebar-bottom" aria-label={t("manage")}>
        <RailButton label={t("manage")} onClick={openManager}>
          <FolderKanban size={18} />
        </RailButton>
        <RailButton label={t("settings")} onClick={openSettings}>
          <Settings2 size={18} />
        </RailButton>
      </nav>
      {panelOpen ? (
        <section
          className="sidebar-panel"
          id="workspace-navigation-panel"
          aria-label={t("workspace")}
        >
          <header className="sidebar-panel-header">
            <div>
              <strong>Studio</strong>
              <span>{t("workspace")}</span>
            </div>
            <IconButton label={t("close")} onClick={closePanel}>
              <X size={17} />
            </IconButton>
          </header>
          <div className="sidebar-panel-body">
            <div className="sidebar-panel-actions">
              <button
                className="panel-command"
                type="button"
                onClick={openTask}
              >
                <Plus size={17} />
                {t("newTask")}
              </button>
              <button
                className="panel-action panel-action-icon"
                type="button"
                aria-label={t("search")}
                onClick={openSearch}
              >
                <Search size={16} />
                <span className="visually-hidden">{t("search")}</span>
              </button>
            </div>
            <section
              className="recent-conversations"
              aria-labelledby="recent-conversations-heading"
            >
              <div className="sidebar-section-heading">
                <strong id="recent-conversations-heading">
                  {t("history")}
                </strong>
                <button
                  className="text-button"
                  type="button"
                  onClick={openHistory}
                >
                  {t("more")}
                </button>
              </div>
              {recentEntries.length ? (
                <div className="recent-conversation-list">
                  {recentEntries.map((entry) => (
                    <button
                      className={`recent-conversation ${entry.id === currentConversationId ? "is-current" : ""}`}
                      type="button"
                      key={entry.id}
                      aria-label={entry.title}
                      title={entry.title}
                      onClick={() => {
                        onOpenConversation(entry.id);
                        closePanel();
                      }}
                    >
                      <History size={15} />
                      <span aria-hidden="true">{entry.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="recent-conversation-empty">
                  {t("noHistory")}
                </div>
              )}
            </section>
            <section className="sidebar-management" aria-label={t("manage")}>
              <div className="sidebar-section-heading">
                <strong>{t("manage")}</strong>
              </div>
              <button
                className="panel-action"
                type="button"
                onClick={openManager}
              >
                <FolderKanban size={16} />
                {t("manage")}
              </button>
              <button
                className="panel-action"
                type="button"
                onClick={openSettings}
              >
                <Settings2 size={16} />
                {t("settings")}
              </button>
            </section>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function RailButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "command";
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`rail-button ${variant === "command" ? "is-command" : ""}`}
          type="button"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="right" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SearchDialog({
  open,
  onOpenChange,
  messages,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: StudioMessage[];
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const normalized = query.trim().toLowerCase();
  const results = normalized
    ? messages.filter((message) =>
        message.content.toLowerCase().includes(normalized),
      )
    : [];
  const jumpToMessage = (id: string | number) => {
    onOpenChange(false);
    window.setTimeout(() => {
      const stage = document.querySelector<HTMLElement>(".conversation-stage");
      const target = document.getElementById(`message-${id}`);
      if (!stage || !target) return;
      const stageRect = stage.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      stage.scrollTo({
        behavior: "smooth",
        top: Math.max(
          0,
          stage.scrollTop +
            targetRect.top -
            stageRect.top -
            (stage.clientHeight - targetRect.height) / 2,
        ),
      });
    }, 0);
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="utility-dialog">
          <div className="dialog-header">
            <div>
              <Dialog.Title>{t("searchCurrent")}</Dialog.Title>
              <Dialog.Description>{t("searchCurrentHint")}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")} tooltip={false}>
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="utility-content">
            <div className="search-field">
              <Search size={15} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
            </div>
            {query.trim() ? (
              <div className="search-results">
                {results.length ? (
                  results.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      className="search-result"
                      onClick={() => jumpToMessage(message.id)}
                    >
                      <span className="search-result-role">
                        {message.role === "USER"
                          ? t("you")
                          : t("digitalEmployee")}
                      </span>
                      <span>{message.content}</span>
                    </button>
                  ))
                ) : (
                  <div className="utility-empty">{t("noSearchResults")}</div>
                )}
              </div>
            ) : (
              <div className="utility-empty">{t("searchPrompt")}</div>
            )}
          </div>
          <div className="dialog-footer">
            <Dialog.Close asChild>
              <button type="button" className="secondary-button">
                {t("close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HistoryDialog({
  open,
  onOpenChange,
  entries,
  currentId,
  onOpenConversation,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: HistoryEntry[];
  currentId: string | null;
  onOpenConversation: (id: string) => void;
  t: (key: string) => string;
}) {
  const sorted = [...entries].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="utility-dialog">
          <div className="dialog-header">
            <div>
              <Dialog.Title>{t("historyTitle")}</Dialog.Title>
              <Dialog.Description>{t("historyHint")}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")} tooltip={false}>
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="utility-content">
            {sorted.length ? (
              <div className="history-list">
                {sorted.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={`history-item ${entry.id === currentId ? "is-current" : ""}`}
                    onClick={() => onOpenConversation(entry.id)}
                  >
                    <span className="history-item-icon">
                      <History size={15} />
                    </span>
                    <span className="history-item-copy">
                      <strong>{entry.title}</strong>
                      <small>
                        {new Date(entry.updatedAt).toLocaleString()}
                      </small>
                    </span>
                    {entry.id === currentId ? (
                      <Check size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="utility-empty">
                <History size={18} />
                {t("noHistory")}
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <Dialog.Close asChild>
              <button type="button" className="secondary-button">
                {t("close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AgentSelect({
  agents,
  currentAgent,
  onChange,
  t,
}: {
  agents: Agent[];
  currentAgent?: Agent;
  onChange: (id: string) => void;
  t: (key: string) => string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="agent-trigger"
          type="button"
          aria-label={`${t("digitalEmployee")} ${currentAgent?.name ?? ""}`}
        >
          <span className="agent-avatar">
            <Bot size={15} />
          </span>
          <span className="agent-trigger-copy">
            <small>{t("digitalEmployee")}</small>
            <strong>{currentAgent?.name ?? t("digitalEmployee")}</strong>
          </span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu agent-menu"
          align="end"
          sideOffset={8}
        >
          {agents
            .filter((agent) => agent.enabled)
            .map((agent) => (
              <DropdownMenu.Item
                key={agent.id}
                className="agent-option"
                onSelect={() => onChange(agent.id)}
              >
                <span className="agent-avatar">
                  <Bot size={14} />
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.description}</small>
                </span>
                {agent.id === currentAgent?.id ? <Check size={14} /> : null}
              </DropdownMenu.Item>
            ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function EmptyState({
  onPrompt,
  t,
}: {
  onPrompt: (prompt: string) => void;
  t: (key: string) => string;
}) {
  const suggestions = [t("suggestion1"), t("suggestion2"), t("suggestion3")];
  return (
    <div className="empty-state" aria-label={t("workspace")}>
      <span className="empty-state-label">{t("startTask")}</span>
      <div className="suggestion-row">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPrompt(suggestion)}
          >
            {suggestion}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  expanded,
  onToggle,
  onCitation,
  onCopy,
  onRetry,
  onViewAudit,
  onApproval,
  approving,
  copied,
  t,
}: {
  message: StudioMessage;
  expanded: boolean;
  onToggle: () => void;
  onCitation: (id: string) => void;
  onCopy: () => void;
  onRetry: () => void;
  onViewAudit: () => void;
  onApproval: (message: StudioMessage, approved: boolean) => void;
  approving: boolean;
  copied: boolean;
  t: (key: string) => string;
}) {
  if (message.role === "USER")
    return (
      <article id={`message-${message.id}`} className="message-row user-row">
        <div className="user-bubble">
          <span>{message.content}</span>
          {message.attachmentSummaries?.length ? (
            <span className="user-attachment-row">
              {message.attachmentSummaries.map((attachment) => (
                <span className="user-attachment" key={`${attachment.kind}-${attachment.name}`}>
                  <Paperclip size={11} /> {attachment.name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </article>
    );
  const steps = message.steps ?? [];
  const queued = message.runState === "queued";
  const waitingApproval = message.runState === "waitingApproval";
  const needsVerification = message.runState === "needsVerification";
  const hasRunning =
    !queued &&
    !waitingApproval &&
    !needsVerification &&
    (steps.some((step) => step.status === "running") || message.isStreaming);
  const isCollapsed =
    !expanded &&
    !hasRunning &&
    !queued &&
    !waitingApproval &&
    !needsVerification &&
    !message.error;
  const executionLabel = queued
    ? message.queuePosition && message.queuePosition > 1
      ? queuePositionLabel(t, message.queuePosition)
      : t("queued")
    : waitingApproval
    ? t("waitingApproval")
    : needsVerification
      ? t("needsVerification")
      : hasRunning
        ? t("running")
        : message.error
          ? t("runFailed")
          : t("completed");
  const executionIconClass = queued
    ? "is-waiting"
    : waitingApproval
    ? "is-waiting"
    : needsVerification
      ? "is-warning"
      : hasRunning
        ? "is-running"
        : message.error
          ? "is-failed"
          : "is-complete";
  return (
    <article
      id={`message-${message.id}`}
      className={`message-row assistant-row ${message.error ? "has-error" : ""}`}
    >
      {steps.length ? (
        <div className="execution-block">
          <button
            className="execution-summary"
            type="button"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
          >
            <span className={`execution-icon ${executionIconClass}`}>
              {hasRunning ? (
                <LoaderCircle size={15} className="spin" />
              ) : queued || waitingApproval || needsVerification || message.error ? (
                <CircleAlert size={15} />
              ) : (
                <Check size={15} />
              )}
            </span>
            <span>
              {executionLabel} {steps.length} {t("stepCount")}
            </span>
            {message.durationMs ? (
              <span className="execution-meta">
                · {formatDuration(message.durationMs)} {t("seconds")}
              </span>
            ) : null}
            <ChevronRight
              size={15}
              className={`execution-chevron ${!isCollapsed ? "is-open" : ""}`}
            />
          </button>
          {!isCollapsed ? (
            <div className="step-list">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} t={t} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {waitingApproval && message.approvalId ? (
        <div className="approval-request" role="status">
          <div>
            <strong>{t("approvalRequired")}</strong>
            <span>
              {message.approvalDecision === "approved"
                ? t("approvalApproved")
                : message.approvalDecision === "rejected"
                  ? t("approvalRejected")
                  : t("approvalHint")}
            </span>
          </div>
          <div className="approval-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={
                approving ||
                message.approvalDecision === "approved" ||
                message.approvalDecision === "rejected"
              }
              onClick={() => onApproval(message, false)}
            >
              {t("reject")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={
                approving ||
                message.approvalDecision === "approved" ||
                message.approvalDecision === "rejected"
              }
              onClick={() => onApproval(message, true)}
            >
              {approving ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              {t("approve")}
            </button>
          </div>
        </div>
      ) : null}
      {message.content ? (
        <div className="assistant-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      ) : message.isStreaming && !waitingApproval ? (
        <div className="typing-line">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {message.error ? (
        <div className="run-error">
          <ShieldCheck size={15} /> {message.error}
        </div>
      ) : null}
      {message.citations?.length ? (
        <div className="citation-row" aria-label={t("sources")}>
          {message.citations.map((citation, index) => (
            <button
              type="button"
              key={citation.id}
              onClick={() => onCitation(citation.id)}
              aria-label={`${t("viewSources")} ${index + 1}`}
            >
              [{index + 1}]
            </button>
          ))}
        </div>
      ) : null}
      {message.content || message.error ? (
        <div className="message-actions">
          <button type="button" onClick={onCopy} disabled={!message.content}>
            {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
            {copied ? t("copied") : t("copy")}
          </button>
          <button type="button" onClick={onRetry}>
            <RotateCcw size={14} /> {t("retry")}
          </button>
          {message.runId && !message.runId.startsWith("pending-") ? (
            <button type="button" onClick={onViewAudit}>
              <ShieldCheck size={14} /> {t("runAudit")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StepRow({ step, t }: { step: RunStep; t: (key: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`step-row-wrap ${step.status}`}>
      <button
        className="step-row"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={`step-status ${step.status}`}>
          {step.status === "running" ? (
            <LoaderCircle size={13} className="spin" />
          ) : step.status === "failed" ? (
            <X size={13} />
          ) : step.status === "waiting" || step.status === "warning" ? (
            <CircleAlert size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <span className="step-label">{step.label}</span>
        {step.detail ? (
          <span className="step-detail">{step.detail}</span>
        ) : null}
        <span className="step-duration">
          {step.duration ?? (step.status === "running" ? "…" : "")}
        </span>
        {step.detail ? (
          <ChevronRight
            size={12}
            className={`step-chevron ${open ? "is-open" : ""}`}
          />
        ) : null}
      </button>
      {open && step.detail ? (
        <div className="step-detail-expanded">
          <span>{t("stepDetail")}</span>
          <code>{step.detail}</code>
        </div>
      ) : null}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onKeyDown,
  onSend,
  onStop,
  running,
  stopping,
  backendAvailable,
  textareaRef,
  t,
  onAttach,
  attachments,
  onRemoveAttachment,
  composerNotice,
  toolsQuery,
  knowledgeBasesQuery,
  skillsQuery,
  mcpQuery,
  nodesQuery,
  capabilityState,
  onCapabilityChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  stopping: boolean;
  backendAvailable: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  t: (key: string) => string;
  onAttach: (files: File[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  composerNotice: string | null;
  toolsQuery: { data?: Tool[] };
  knowledgeBasesQuery: { data?: KnowledgeBase[] };
  skillsQuery: { data?: Skill[] };
  mcpQuery: { data?: McpConnection[] };
  nodesQuery: { data?: NodeConnection[] };
  capabilityState: CapabilityState;
  onCapabilityChange: (state: CapabilityState) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const totalCapabilities =
    capabilityState.knowledgeBaseIds.length +
    capabilityState.skillIds.length +
    capabilityState.mcpServerIds.length +
    capabilityState.toolNames.length +
    (capabilityState.nodeId ? 1 : 0);
  const builtInTools = (toolsQuery.data ?? []).filter(
    (tool) => !tool.name.startsWith("mcp:") && !tool.name.startsWith("node:"),
  );
  const selectedCapabilityChips = [
    ...(knowledgeBasesQuery.data ?? [])
      .filter((base) => capabilityState.knowledgeBaseIds.includes(base.id))
      .map((base) => ({ id: base.id, label: base.name, key: "knowledgeBaseIds" as const })),
    ...builtInTools
      .filter((tool) => capabilityState.toolNames.includes(tool.name))
      .map((tool) => ({ id: tool.name, label: tool.name, key: "toolNames" as const })),
    ...(skillsQuery.data ?? [])
      .filter((skill) => capabilityState.skillIds.includes(skill.id))
      .map((skill) => ({ id: skill.id, label: skill.name, key: "skillIds" as const })),
    ...(mcpQuery.data ?? [])
      .filter((connection) => capabilityState.mcpServerIds.includes(connection.id))
      .map((connection) => ({ id: connection.id, label: connection.name, key: "mcpServerIds" as const })),
    ...((nodesQuery.data ?? [])
      .filter((node) => node.id === capabilityState.nodeId)
      .map((node) => ({ id: node.id, label: node.name, key: "nodeId" as const }))),
  ];
  const removeCapability = (chip: (typeof selectedCapabilityChips)[number]) => {
    if (chip.key === "nodeId") {
      onCapabilityChange({ ...capabilityState, nodeId: undefined });
      return;
    }
    onCapabilityChange({
      ...capabilityState,
      [chip.key]: capabilityState[chip.key].filter((id) => id !== chip.id),
    });
  };
  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragActive ? "is-drag-active" : ""}`}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes("Files"))
            event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDragActive(false);
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (!files.length) return;
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragActive(false);
          onAttach(files);
        }}
      >
        <div className="composer-toolbar">
          <input
            ref={fileRef}
            type="file"
            className="visually-hidden"
            aria-hidden="true"
            tabIndex={-1}
            multiple
            onChange={(event) => {
              onAttach(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <IconButton
            label={t("attach")}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={16} />
          </IconButton>
          <CapabilityMenu
            tools={builtInTools}
            knowledgeBases={knowledgeBasesQuery.data ?? []}
            skills={skillsQuery.data ?? []}
            mcpConnections={mcpQuery.data ?? []}
            nodes={(nodesQuery.data ?? []).filter(
              (node) => node.enabled && node.status?.toUpperCase() === "ONLINE",
            )}
            state={capabilityState}
            onChange={onCapabilityChange}
            t={t}
          />
          <span className="composer-spacer" />
        </div>
        {selectedCapabilityChips.length ? (
          <div className="selected-capability-row" aria-label={t("capabilityTitle")}>
            {selectedCapabilityChips.map((chip) => (
              <span className="selected-capability-chip" key={`${chip.key}-${chip.id}`}>
                <Zap size={12} />
                <span>{chip.label}</span>
                <button
                  type="button"
                  aria-label={`${t("removeCapability")} ${chip.label}`}
                  title={t("removeCapability")}
                  onClick={() => removeCapability(chip)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <div className="attachment-row">
            {attachments.map((file) => (
              <span className="attachment-chip" key={file.id}>
                {file.previewUrl ? (
                  <img
                    className="attachment-thumbnail"
                    src={file.previewUrl}
                    alt=""
                  />
                ) : (
                  <FileText size={12} />
                )}
                <span className="attachment-name">{file.name}</span>
                <button
                  type="button"
                  aria-label={`${t("removeAttachment")} ${file.name}`}
                  onClick={() => onRemoveAttachment(file.id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) return;
            event.preventDefault();
            onAttach(files);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          rows={1}
          aria-label={t("placeholder")}
        />
        <div className="composer-footer">
          <span className="composer-context">
            <span className="context-dot" data-online={backendAvailable} />
            <span className="composer-employee-label">{t("digitalEmployee")}</span>
            <span className="composer-connection-label">
              {backendAvailable ? t("connected") : t("offline")}
            </span>
            {totalCapabilities ? (
              <span className="capability-count">+{totalCapabilities}</span>
            ) : null}
          </span>
          {running ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={onStop}
              disabled={stopping}
              aria-label={stopping ? t("stoppingRun") : t("stop")}
            >
              {stopping ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <CircleStop size={17} />
              )}
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={onSend}
              disabled={
                !backendAvailable || (!value.trim() && !attachments.length)
              }
              aria-label={t("send")}
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
        {composerNotice ? (
          <div className="composer-notice">
            <CircleAlert size={13} />
            {composerNotice}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CapabilityMenu({
  tools,
  knowledgeBases,
  skills,
  mcpConnections,
  nodes,
  state,
  onChange,
  t,
}: {
  tools: Tool[];
  knowledgeBases: KnowledgeBase[];
  skills: Skill[];
  mcpConnections: McpConnection[];
  nodes: NodeConnection[];
  state: CapabilityState;
  onChange: (state: CapabilityState) => void;
  t: (key: string) => string;
}) {
  const toggle = (key: CapabilityArrayKey, id: string, checked: boolean) =>
    onChange({
      ...state,
      [key]: checked
        ? [...state[key], id]
        : state[key].filter((item) => item !== id),
    });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="capability-button">
          <Zap size={14} />
          {t("chooseCapability")}
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu capability-menu"
          align="start"
          sideOffset={8}
        >
          <DropdownMenu.Label className="menu-label">
            {t("capabilityTitle")}
          </DropdownMenu.Label>
          <p className="capability-hint">{t("capabilityHint")}</p>
          {knowledgeBases.length ? (
            <CapabilityGroup
              title={t("knowledge")}
              items={knowledgeBases.map((base) => ({
                id: base.id,
                label: base.name,
                detail: base.description ?? "",
                key: "knowledgeBaseIds" as const,
                checked: state.knowledgeBaseIds.includes(base.id),
              }))}
              onToggle={toggle}
            />
          ) : null}
          {tools.length ? (
            <CapabilityGroup
              title={t("builtInTools")}
              items={tools.map((tool) => ({
                id: tool.name,
                label: tool.name,
                detail: tool.description,
                key: "toolNames" as const,
                checked: state.toolNames.includes(tool.name),
              }))}
              onToggle={toggle}
            />
          ) : null}
          {skills.length ? (
            <CapabilityGroup
              title={t("installedSkills")}
              items={skills
                .filter((skill) => skill.enabled)
                .map((skill) => ({
                  id: skill.id,
                  label: skill.name,
                  detail: skill.description,
                  key: "skillIds" as const,
                  checked: state.skillIds.includes(skill.id),
                }))}
              onToggle={toggle}
            />
          ) : null}
          {mcpConnections.length ? (
            <CapabilityGroup
              title={t("mcpConnections")}
              items={mcpConnections
                .filter((connection) => connection.enabled)
                .map((connection) => ({
                  id: connection.id,
                  label: connection.name,
                  detail: connection.description ?? connection.status ?? "",
                  key: "mcpServerIds" as const,
                  checked: state.mcpServerIds.includes(connection.id),
                }))}
              onToggle={toggle}
            />
          ) : null}
          {nodes.length ? (
            <div className="capability-group">
              <div className="capability-group-title">
                {t("executionNodes")}
              </div>
              <DropdownMenu.RadioGroup
                value={state.nodeId ?? ""}
                onValueChange={(value) =>
                  onChange({ ...state, nodeId: value || undefined })
                }
              >
                <DropdownMenu.RadioItem value="" className="capability-item">
                  <DropdownMenu.ItemIndicator className="item-indicator">
                    <Check size={13} />
                  </DropdownMenu.ItemIndicator>
                  <span>
                    <strong>{t("noExecutionNode")}</strong>
                    <small>{t("noExecutionNodeHint")}</small>
                  </span>
                </DropdownMenu.RadioItem>
                {nodes.map((node) => (
                  <DropdownMenu.RadioItem
                    key={node.id}
                    value={node.id}
                    className="capability-item"
                  >
                    <DropdownMenu.ItemIndicator className="item-indicator">
                      <Check size={13} />
                    </DropdownMenu.ItemIndicator>
                    <span>
                      <strong>{node.name}</strong>
                      <small>
                        {node.hostname ?? node.osName ?? t("online")}
                      </small>
                    </span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </div>
          ) : null}
          {!tools.length &&
          !knowledgeBases.length &&
          !skills.length &&
          !mcpConnections.length &&
          !nodes.length ? (
            <div className="capability-empty">
              <Wrench size={15} />
              {t("noCapabilities")}
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function CapabilityGroup({
  title,
  items,
  onToggle,
}: {
  title: string;
  items: {
    id: string;
    label: string;
    detail: string;
    key: CapabilityArrayKey;
    checked: boolean;
  }[];
  onToggle: (key: CapabilityArrayKey, id: string, checked: boolean) => void;
}) {
  return (
    <div className="capability-group">
      <div className="capability-group-title">{title}</div>
      {items.map((item) => (
        <DropdownMenu.CheckboxItem
          key={item.id}
          className="capability-item"
          checked={item.checked}
          onCheckedChange={(checked) => onToggle(item.key, item.id, checked)}
        >
          <DropdownMenu.ItemIndicator className="item-indicator">
            <Check size={13} />
          </DropdownMenu.ItemIndicator>
          <span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </span>
        </DropdownMenu.CheckboxItem>
      ))}
    </div>
  );
}

function CitationDrawer({
  citation,
  onClose,
  t,
}: {
  citation: Citation;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-scrim" />
        <Dialog.Content className="citation-drawer">
          <div className="drawer-header">
            <div>
              <small>{t("sources")}</small>
              <Dialog.Title asChild>
                <h2>{citation.title}</h2>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")} tooltip={false}>
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Description className="visually-hidden">
            {t("sources")}
          </Dialog.Description>
          <div className="drawer-body">
            <div className="source-type">
              <FileText size={15} />
              {citation.source}
            </div>
            <blockquote>{citation.quote}</blockquote>
            {citation.location ? (
              <p className="source-location">
                {t("location")}: {citation.location}
              </p>
            ) : null}
            {citation.type === "web" ? (
              <a
                className="source-link"
                href={citation.location}
                target="_blank"
                rel="noreferrer"
              >
                {citation.location}
              </a>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RunAuditDrawer({
  evidence,
  quality,
  loading,
  error,
  onClose,
  t,
}: {
  evidence?: CodingRunEvidence;
  quality?: CodingRunQuality;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const auditLists = [
    [t("changedFiles"), evidence?.changedFiles ?? []],
    [t("verificationTools"), evidence?.verificationTools ?? []],
    [t("commandVerifications"), evidence?.commandVerifications ?? []],
    [t("failedTools"), evidence?.failedTools ?? []],
  ] as const;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-scrim" />
        <Dialog.Content className="citation-drawer audit-drawer">
          <div className="drawer-header">
            <div>
              <small>{t("runAudit")}</small>
              <Dialog.Title asChild>
                <h2>{quality ? `${quality.score}/100 ${quality.grade}` : t("deliveryEvidence")}</h2>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")} tooltip={false}>
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Description className="visually-hidden">
            {t("runAudit")}
          </Dialog.Description>
          <div className="drawer-body audit-body">
            {loading ? <div className="audit-state"><LoaderCircle size={15} className="spin" /> {t("loading")}</div> : null}
            {error ? <div className="audit-state"><CircleAlert size={15} /> {t("loadFailed")}</div> : null}
            {!loading && !error ? (
              <>
                <div className="audit-summary">
                  <span>{t("toolCalls")}</span>
                  <strong>{evidence?.toolCalls ?? 0}</strong>
                  <span>{t("browserVerification")}</span>
                  <strong>{evidence?.browserVerified ? t("verified") : t("notVerified")}</strong>
                </div>
                {auditLists.map(([label, entries]) => entries.length ? (
                  <section className="audit-section" key={label}>
                    <h3>{label}</h3>
                    <ul>{entries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                  </section>
                ) : null)}
                {quality?.checks.length ? (
                  <section className="audit-section">
                    <h3>{t("qualityChecks")}</h3>
                    <ul className="quality-checks">
                      {quality.checks.map((check) => (
                        <li className={check.passed ? "" : "is-failed"} key={check.name}>
                          <span>{check.passed ? <Check size={14} /> : <CircleAlert size={14} />}</span>
                          <div><strong>{check.name} {check.earnedPoints}/{check.maximumPoints}</strong><small>{check.explanation}</small></div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {quality?.recommendations.length ? (
                  <section className="audit-section">
                    <h3>{t("recommendations")}</h3>
                    <ul>{quality.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ) : null}
                {!evidence?.changedFiles.length && !quality?.checks.length ? <div className="audit-state">{t("auditNoEvidence")}</div> : null}
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConfigurationWorkspace({
  tab,
  setTab,
  agents,
  models,
  onClose,
  t,
}: {
  tab: string;
  setTab: (tab: string) => void;
  agents: Agent[];
  models: ModelProfile[];
  onClose: () => void;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [compactNavigation, setCompactNavigation] = useState(
    () => window.matchMedia("(max-width: 1199px)").matches,
  );
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: studioApi.listSkills,
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: studioApi.listMcpConnections,
  });
  const knowledgeQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: studioApi.listKnowledgeBases,
  });
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: studioApi.listNodes,
  });
  const approvalsQuery = useQuery({
    queryKey: ["node-tool-approvals"],
    queryFn: studioApi.listNodeToolApprovals,
  });
  const toggleSkill = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      studioApi.setSkillEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });
  const toggleMcp = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      studioApi.setMcpEnabled(id, enabled),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] }),
  });
  const refreshMcp = useMutation({
    mutationFn: (id: string) => studioApi.refreshMcpTools(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] }),
  });
  const toggleModel = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      studioApi.setModelEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
  });
  const setDefaultModel = useMutation({
    mutationFn: studioApi.setDefaultModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
  });
  const createKnowledge = useMutation({
    mutationFn: studioApi.createKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setCreatingKnowledge(false);
    },
  });
  const [creatingKnowledge, setCreatingKnowledge] = useState(false);
  const knowledgeSchema = z.object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
  });
  const form = useForm<{ name: string; description?: string }>({
    defaultValues: { name: "", description: "" },
  });
  const tabs = [
    { id: "agents", icon: Bot, label: t("agents") },
    { id: "skills", icon: Sparkles, label: t("skills") },
    { id: "mcp", icon: Globe2, label: t("mcp") },
    { id: "knowledge", icon: Database, label: t("knowledge") },
    { id: "models", icon: TerminalSquare, label: t("models") },
    { id: "nodes", icon: HardDrive, label: t("nodes") },
  ];
  const submitKnowledge = form.handleSubmit((values) => {
    const parsed = knowledgeSchema.safeParse(values);
    if (parsed.success) createKnowledge.mutate(parsed.data);
  });
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1199px)");
    const update = () => setCompactNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="configuration-overlay" />
        <Dialog.Content className="configuration-workspace">
          <header className="configuration-header">
            <Dialog.Close asChild>
              <button
                className="configuration-back"
                type="button"
                aria-label={t("workspace")}
                title={t("workspace")}
              >
                <ArrowLeft size={17} />
                {t("workspace")}
              </button>
            </Dialog.Close>
            <div className="configuration-heading">
              <Dialog.Title asChild>
                <h1>{t("configuration")}</h1>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p>{t("manageHint")}</p>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")}>
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </header>
          <Tabs.Root
            value={tab}
            onValueChange={setTab}
            orientation={compactNavigation ? "horizontal" : "vertical"}
            className="configuration-layout"
          >
            <Tabs.List className="configuration-tab-list">
              {tabs.map(({ id, icon: Icon, label }) => (
                <Tabs.Trigger value={id} key={id} className="configuration-tab">
                  <Icon size={16} />
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="configuration-panel">
              {tabs.map(({ id, label }) => (
                <Tabs.Content
                  value={id}
                  key={id}
                  className="configuration-content"
                >
                  <ManagerPanelHeading
                    label={label}
                    id={id}
                    t={t}
                    onAdd={
                      id === "knowledge"
                        ? () => setCreatingKnowledge((current) => !current)
                        : undefined
                    }
                    onRefresh={() =>
                      queryClient.invalidateQueries({
                        queryKey: idToQueryKey(id),
                      })
                    }
                  />
                  <ManagerPanelBody
                    id={id}
                    agents={agents}
                    models={models}
                    skills={skillsQuery.data}
                    mcpConnections={mcpQuery.data}
                    knowledgeBases={knowledgeQuery.data}
                    nodes={nodesQuery.data}
                    queries={{
                      skills: skillsQuery,
                      mcp: mcpQuery,
                      knowledge: knowledgeQuery,
                      nodes: nodesQuery,
                      approvals: approvalsQuery,
                    }}
                    onSkillToggle={(item) => toggleSkill.mutate(item)}
                    onMcpToggle={(item) => toggleMcp.mutate(item)}
                    onMcpRefresh={(id) => refreshMcp.mutate(id)}
                    onModelToggle={(item) => toggleModel.mutate(item)}
                    onSetDefault={(id) => setDefaultModel.mutate(id)}
                    creatingKnowledge={creatingKnowledge}
                    knowledgeForm={form}
                    onKnowledgeSubmit={submitKnowledge}
                    knowledgeSubmitting={createKnowledge.isPending}
                    t={t}
                  />
                </Tabs.Content>
              ))}
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ManagerPanelHeading({
  label,
  id,
  t,
  onAdd,
  onRefresh,
}: {
  label: string;
  id: string;
  t: (key: string) => string;
  onAdd?: () => void;
  onRefresh: () => void;
}) {
  const hintKey = `${id}Hint`;
  return (
    <div className="panel-heading">
      <div>
        <h3>{label}</h3>
        <p>{t(hintKey)}</p>
      </div>
      {onAdd ? (
        <button type="button" className="secondary-button" onClick={onAdd}>
          <Plus size={15} />
          {t("createKnowledge")}
        </button>
      ) : (
        <button type="button" className="secondary-button" onClick={onRefresh}>
          <RefreshCw size={15} />
          {t("refresh")}
        </button>
      )}
    </div>
  );
}

function ManagerPanelBody({
  id,
  agents,
  models,
  skills,
  mcpConnections,
  knowledgeBases,
  nodes,
  queries,
  onSkillToggle,
  onMcpToggle,
  onMcpRefresh,
  onModelToggle,
  onSetDefault,
  creatingKnowledge,
  knowledgeForm,
  onKnowledgeSubmit,
  knowledgeSubmitting,
  t,
}: {
  id: string;
  agents: Agent[];
  models: ModelProfile[];
  skills?: Skill[];
  mcpConnections?: McpConnection[];
  knowledgeBases?: KnowledgeBase[];
  nodes?: NodeConnection[];
  queries: Record<
    string,
    { isLoading: boolean; isError: boolean; refetch: () => unknown }
  >;
  onSkillToggle: (item: { id: string; enabled: boolean }) => void;
  onMcpToggle: (item: { id: string; enabled: boolean }) => void;
  onMcpRefresh: (id: string) => void;
  onModelToggle: (item: { id: string; enabled: boolean }) => void;
  onSetDefault: (id: string) => void;
  creatingKnowledge: boolean;
  knowledgeForm: ReturnType<
    typeof useForm<{ name: string; description?: string }>
  >;
  onKnowledgeSubmit: () => void;
  knowledgeSubmitting: boolean;
  t: (key: string) => string;
}) {
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(
    null,
  );
  const inspectedAgent = agents.find((agent) => agent.id === inspectedAgentId);
  const inspectedModel = inspectedAgent
    ? models.find((model) => model.id === inspectedAgent.defaultModelProfileId)
    : undefined;

  if (id === "agents")
    return (
      <div className="agent-manager">
        <div className="manager-list">
          {agents.map((agent) => (
            <ResourceRow
              key={agent.id}
              icon={<Bot size={15} />}
              title={agent.name}
              detail={agent.description}
              status={agent.enabled ? t("enabled") : t("disabled")}
              trailing={
                <span className="row-actions">
                  <span className="list-status">
                    <span className="status-dot" data-online={agent.enabled} />
                    {agent.enabled ? t("online") : t("disabled")}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setInspectedAgentId(agent.id)}
                  >
                    {t("viewAgentConfig")}
                  </button>
                </span>
              }
            />
          ))}
        </div>
        {inspectedAgent ? (
          <section className="agent-inspector" aria-label={t("agentConfiguration")}>
            <div className="agent-inspector-header">
              <div>
                <h4>{inspectedAgent.name}</h4>
                <p>{t("agentConfiguration")}</p>
              </div>
              <IconButton
                label={t("close")}
                onClick={() => setInspectedAgentId(null)}
              >
                <X size={15} />
              </IconButton>
            </div>
            <div className="agent-inspector-grid">
              <div className="agent-inspector-field">
                <span>{t("description")}</span>
                <strong>{inspectedAgent.description || t("noDescription")}</strong>
              </div>
              <div className="agent-inspector-field">
                <span>{t("agentDefaultModel")}</span>
                <strong>
                  {inspectedModel?.modelName ?? inspectedAgent.defaultModelProfileId}
                </strong>
              </div>
              <div className="agent-inspector-field">
                <span>{t("agentTools")}</span>
                <strong>{inspectedAgent.toolAllowList || t("noDescription")}</strong>
              </div>
            </div>
            <div className="agent-inspector-field">
              <span>{t("agentSystemPrompt")}</span>
              <pre className="agent-prompt">
                {inspectedAgent.systemPrompt || t("noDescription")}
              </pre>
            </div>
            <p className="agent-readonly-note">{t("agentReadOnlyHint")}</p>
          </section>
        ) : null}
      </div>
    );
  if (id === "skills")
    return (
      <SkillsManager
        installed={skills ?? []}
        query={queries.skills}
        onToggle={onSkillToggle}
        t={t}
      />
    );
  if (id === "mcp")
    return (
      <McpManager
        connections={mcpConnections ?? []}
        query={queries.mcp}
        onToggle={onMcpToggle}
        onRefresh={onMcpRefresh}
        t={t}
      />
    );
  if (id === "knowledge")
    return (
      <div className="manager-stack">
        {creatingKnowledge ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              onKnowledgeSubmit();
            }}
          >
            <label>
              {t("knowledgeName")}
              <input {...knowledgeForm.register("name")} autoFocus />
            </label>
            <label>
              {t("knowledgeDescription")}
              <textarea {...knowledgeForm.register("description")} rows={2} />
            </label>
            <div className="inline-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => knowledgeForm.reset()}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={knowledgeSubmitting}
              >
                <Plus size={14} />
                {t("create")}
              </button>
            </div>
          </form>
        ) : null}
        <KnowledgeManager
          bases={knowledgeBases ?? []}
          query={queries.knowledge}
          t={t}
        />
      </div>
    );
  if (id === "models")
    return (
      <ModelManager
        models={models}
        onToggle={onModelToggle}
        onSetDefault={onSetDefault}
        t={t}
      />
    );
  return (
    <NodeManager
      nodes={nodes ?? []}
      nodesQuery={queries.nodes}
      approvalsQuery={queries.approvals}
      t={t}
    />
  );
}

function NodeManager({
  nodes,
  nodesQuery,
  approvalsQuery,
  t,
}: {
  nodes: NodeConnection[];
  nodesQuery: ResourceQuery;
  approvalsQuery: ResourceQuery & { data?: NodeToolApproval[] };
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"nodes" | "approvals">("nodes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registration, setRegistration] =
    useState<NodeRegistrationToken | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCredentialRotation, setConfirmCredentialRotation] =
    useState(false);
  const [rotatedCredentials, setRotatedCredentials] =
    useState<RotateNodeSecretResult | null>(null);
  const [copiedCredential, setCopiedCredential] = useState(false);
  const detailsQuery = useQuery({
    queryKey: ["node", selectedId],
    queryFn: () => studioApi.getNode(selectedId!),
    enabled: Boolean(selectedId),
  });
  const registerNode = useMutation({
    mutationFn: () => studioApi.createNodeRegistrationToken(),
    onSuccess: (value) => {
      setRegistration(value);
      setCopiedCommand(false);
    },
  });
  const updateNode = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { name?: string; enabled?: boolean };
    }) => studioApi.updateNode(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", variables.id] });
    },
  });
  const updateTool = useMutation({
    mutationFn: ({
      nodeId,
      toolName,
      payload,
    }: {
      nodeId: string;
      toolName: string;
      payload: { enabled?: boolean; requiresApproval?: boolean };
    }) => studioApi.updateNodeTool(nodeId, toolName, payload),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["node", variables.nodeId] }),
  });
  const removeNode = useMutation({
    mutationFn: studioApi.deleteNode,
    onSuccess: () => {
      setSelectedId(null);
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const rotateCredentials = useMutation({
    mutationFn: studioApi.rotateNodeCredentials,
    onSuccess: (result) => {
      setRotatedCredentials(result);
      setCopiedCredential(false);
      setConfirmCredentialRotation(false);
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", result.nodeId] });
    },
  });
  const decideApproval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      studioApi.decideNodeToolApproval(id, approved),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["node-tool-approvals"] }),
  });
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const pendingApprovals = (approvalsQuery.data ?? []).filter(
    (approval) => approval.status?.toUpperCase() === "PENDING",
  );
  const copyCommand = async () => {
    if (!registration) return;
    try {
      await navigator.clipboard?.writeText(registration.usageHint);
      setCopiedCommand(true);
    } catch {
      setCopiedCommand(false);
    }
  };
  const copyRotatedCredential = async () => {
    if (!rotatedCredentials) return;
    try {
      await navigator.clipboard?.writeText(rotatedCredentials.nodeSecret);
      setCopiedCredential(true);
    } catch {
      setCopiedCredential(false);
    }
  };

  if (selectedNode)
    return (
      <div className="node-detail">
        <button
          type="button"
          className="text-button back-button"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft size={14} />
          {t("nodes")}
        </button>
        <div className="node-detail-heading">
          <div>
            <div className="node-title-row">
              <h4>{detailsQuery.data?.node.name ?? selectedNode.name}</h4>
              <span className="list-status">
                <span
                  className="status-dot"
                  data-online={
                    detailsQuery.data?.node.status?.toUpperCase() === "ONLINE"
                  }
                />
                {statusLabel(
                  detailsQuery.data?.node.status ?? selectedNode.status,
                  t,
                )}
              </span>
            </div>
            <p>
              {detailsQuery.data?.node.hostname ??
                selectedNode.hostname ??
                t("unknownHost")}
            </p>
          </div>
          <div className="knowledge-detail-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setEditingName((current) => !current);
                setNameDraft(detailsQuery.data?.node.name ?? selectedNode.name);
              }}
            >
              <Pencil size={14} />
              {t("editName")}
            </button>
            <button
              className="secondary-button danger-button"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              {t("delete")}
            </button>
          </div>
        </div>
        {editingName ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameDraft.trim()) {
                updateNode.mutate({
                  id: selectedNode.id,
                  payload: { name: nameDraft.trim() },
                });
                setEditingName(false);
              }
            }}
          >
            <label>
              {t("editName")}
              <input
                value={nameDraft}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <div className="inline-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditingName(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!nameDraft.trim() || updateNode.isPending}
              >
                {t("saveName")}
              </button>
            </div>
          </form>
        ) : null}
        {confirmDelete ? (
          <div className="node-danger-confirm">
            <CircleAlert size={16} />
            <div>
              <strong>{t("confirmDeleteNode")}</strong>
              <p>{t("deleteNodeHint")}</p>
            </div>
            <div className="inline-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirmDelete(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={removeNode.isPending}
                onClick={() => removeNode.mutate(selectedNode.id)}
              >
                {t("deleteNode")}
              </button>
            </div>
          </div>
        ) : null}
        <section className="node-credentials" aria-label={t("nodeCredentials")}>
          <div className="knowledge-documents-heading">
            <div>
              <strong>{t("nodeCredentials")}</strong>
              <span>{t("nodeCredentialsHint")}</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setConfirmCredentialRotation(true);
                setRotatedCredentials(null);
              }}
            >
              <RefreshCw size={14} />
              {t("rotateNodeCredentials")}
            </button>
          </div>
          {confirmCredentialRotation ? (
            <div className="node-danger-confirm">
              <CircleAlert size={16} />
              <div>
                <strong>{t("confirmRotateNodeCredentials")}</strong>
                <p>{t("rotateNodeCredentialsHint")}</p>
              </div>
              <div className="inline-form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setConfirmCredentialRotation(false)}
                >
                  {t("cancel")}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={rotateCredentials.isPending}
                  onClick={() => rotateCredentials.mutate(selectedNode.id)}
                >
                  {rotateCredentials.isPending ? <LoaderCircle size={14} className="spin" /> : null}
                  {t("rotateNodeCredentials")}
                </button>
              </div>
            </div>
          ) : null}
          {rotateCredentials.isError ? (
            <p className="form-error">{t("loadFailed")}</p>
          ) : null}
          {rotatedCredentials ? (
            <div className="node-command node-rotated-secret">
              <div>
                <span>{t("nodeSecret")}</span>
                <strong>{formatTimestamp(rotatedCredentials.rotatedAt)}</strong>
              </div>
              <p>{t("nodeSecretOneTimeHint")}</p>
              <code>{rotatedCredentials.nodeSecret}</code>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyRotatedCredential()}
              >
                <Copy size={14} />
                {copiedCredential ? t("commandCopied") : t("copyCommand")}
              </button>
            </div>
          ) : null}
        </section>
        <div className="node-meta-grid">
          <NodeMeta
            label={t("lastSeen")}
            value={formatTimestamp(
              detailsQuery.data?.node.lastSeenAt ?? selectedNode.lastSeenAt,
            )}
          />
          <NodeMeta
            label={t("nodeVersion")}
            value={
              detailsQuery.data?.node.clientVersion ??
              selectedNode.clientVersion ??
              "-"
            }
          />
          <NodeMeta
            label={t("nodeArchitecture")}
            value={
              [
                detailsQuery.data?.node.osName ?? selectedNode.osName,
                detailsQuery.data?.node.osArch ?? selectedNode.osArch,
              ]
                .filter(Boolean)
                .join(" · ") || "-"
            }
          />
        </div>
        <div className="knowledge-documents-heading">
          <div>
            <strong>{t("nodeTools")}</strong>
            <span>
              {detailsQuery.isLoading
                ? t("loading")
                : `${detailsQuery.data?.tools.length ?? 0}`}
            </span>
          </div>
        </div>
        {detailsQuery.isError ? (
          <div className="manager-placeholder compact">
            <CircleAlert size={16} />
            <span>{t("loadFailed")}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void detailsQuery.refetch()}
            >
              {t("retryLoad")}
            </button>
          </div>
        ) : detailsQuery.isLoading ? (
          <div className="manager-placeholder compact">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        ) : detailsQuery.data?.tools.length ? (
          <div className="node-tool-list">
            {detailsQuery.data.tools.map((tool) => (
              <NodeToolPolicyRow
                key={tool.id}
                tool={tool}
                busy={updateTool.isPending}
                onChange={(payload) =>
                  updateTool.mutate({
                    nodeId: selectedNode.id,
                    toolName: tool.name,
                    payload,
                  })
                }
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="manager-placeholder compact">
            <Wrench size={16} />
            <span>{t("noNodeTools")}</span>
          </div>
        )}
      </div>
    );

  return (
    <div className="node-manager">
      <div className="manager-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "nodes"}
          className={section === "nodes" ? "is-active" : ""}
          onClick={() => setSection("nodes")}
        >
          <HardDrive size={13} />
          {t("nodes")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "approvals"}
          className={section === "approvals" ? "is-active" : ""}
          onClick={() => setSection("approvals")}
        >
          <ShieldCheck size={13} />
          {t("nodeApprovals")}
          {pendingApprovals.length ? (
            <span className="tab-count">{pendingApprovals.length}</span>
          ) : null}
        </button>
      </div>
      {section === "nodes" ? (
        <>
          <div className="node-onboarding">
            <div>
              <strong>{t("nodeConnectTitle")}</strong>
              <p>{t("nodeConnectHint")}</p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={registerNode.isPending}
              onClick={() => registerNode.mutate()}
            >
              {registerNode.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <PlugZap size={14} />
              )}
              {registration ? t("generateAgain") : t("addNode")}
            </button>
          </div>
          {registration ? (
            <div className="node-command">
              <div>
                <span>{t("nodeTokenExpires")}</span>
                <strong>{formatTimestamp(registration.expiresAt)}</strong>
              </div>
              <code>{registration.usageHint}</code>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyCommand()}
              >
                <Copy size={14} />
                {copiedCommand ? t("commandCopied") : t("copyCommand")}
              </button>
            </div>
          ) : null}
          <QueryResourceState query={nodesQuery} t={t}>
            {nodes.map((node) => (
              <ResourceRow
                key={node.id}
                icon={<HardDrive size={15} />}
                title={node.name}
                detail={`${node.hostname ?? t("unknownHost")} · ${node.osName ?? "-"}`}
                status={statusLabel(node.status, t)}
                trailing={
                  <span className="row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setSelectedId(node.id);
                        setEditingName(false);
                        setConfirmDelete(false);
                        setConfirmCredentialRotation(false);
                        setRotatedCredentials(null);
                        setNameDraft(node.name);
                      }}
                    >
                      {t("manageNode")}
                    </button>
                    <ToggleButton
                      checked={node.enabled}
                      onChange={(enabled) =>
                        updateNode.mutate({ id: node.id, payload: { enabled } })
                      }
                      label={node.enabled ? t("disable") : t("enable")}
                    />
                  </span>
                }
              />
            ))}
          </QueryResourceState>
        </>
      ) : (
        <QueryResourceState query={approvalsQuery} t={t}>
          {pendingApprovals.length ? (
            pendingApprovals.map((approval) => (
              <NodeApprovalRow
                key={approval.id}
                approval={approval}
                busy={decideApproval.isPending}
                onDecision={(approved) =>
                  decideApproval.mutate({ id: approval.id, approved })
                }
                t={t}
              />
            ))
          ) : (
            <div className="manager-placeholder compact">
              <ShieldCheck size={16} />
              <span>{t("noPendingApprovals")}</span>
            </div>
          )}
        </QueryResourceState>
      )}
    </div>
  );
}

function NodeMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="node-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeToolPolicyRow({
  tool,
  busy,
  onChange,
  t,
}: {
  tool: NodeTool;
  busy: boolean;
  onChange: (payload: {
    enabled?: boolean;
    requiresApproval?: boolean;
  }) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="node-tool-row">
      <span className="model-glyph">
        <Wrench size={15} />
      </span>
      <div>
        <div className="node-tool-title">
          <strong>{tool.name}</strong>
          {tool.riskLevel ? (
            <span className="risk-mark">{tool.riskLevel}</span>
          ) : null}
        </div>
        <span>{tool.description || "-"}</span>
      </div>
      <div className="node-tool-controls">
        <label>
          <span>{t("toolEnabled")}</span>
          <ToggleButton
            checked={tool.enabled}
            onChange={(enabled) => onChange({ enabled })}
            label={tool.enabled ? t("disable") : t("enable")}
          />
        </label>
        <label>
          <span>{t("approvalRequired")}</span>
          <ToggleButton
            checked={tool.requiresApproval}
            onChange={(requiresApproval) => onChange({ requiresApproval })}
            label={t("approvalRequired")}
          />
        </label>
        {busy ? <LoaderCircle size={14} className="spin" /> : null}
      </div>
    </div>
  );
}

function NodeApprovalRow({
  approval,
  busy,
  onDecision,
  t,
}: {
  approval: NodeToolApproval;
  busy: boolean;
  onDecision: (approved: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="node-approval-row">
      <div className="node-approval-heading">
        <div>
          <strong>{approval.toolName}</strong>
          <span>{approval.nodeId}</span>
        </div>
        <span className="list-status">
          {formatTimestamp(approval.createdAt)}
        </span>
      </div>
      {approval.argumentsJson ? (
        <div className="node-approval-arguments">
          <span>{t("approvalArguments")}</span>
          <code>{approval.argumentsJson}</code>
        </div>
      ) : null}
      <div className="node-approval-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => onDecision(false)}
        >
          {t("reject")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => onDecision(true)}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          {t("approve")}
        </button>
      </div>
    </div>
  );
}

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

type ModelFormValues = {
  id: string;
  providerType: "OPENAI_COMPATIBLE" | "OLLAMA";
  baseUrl: string;
  modelName: string;
  credentialRef: string;
  apiKey?: string;
  capabilities: ModelCapability[];
  enabled: boolean;
};

const modelFormSchema = z.object({
  id: z.string().trim().min(1),
  providerType: z.enum(["OPENAI_COMPATIBLE", "OLLAMA"]),
  baseUrl: z.string().trim().url(),
  modelName: z.string().trim().min(1),
  credentialRef: z.string().trim().min(1),
  apiKey: z.string().optional(),
  capabilities: z.array(z.string()).min(1),
  enabled: z.boolean(),
});

const emptyModelForm: ModelFormValues = {
  id: "",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.openai.com/v1",
  modelName: "",
  credentialRef: "OPENAI_API_KEY",
  apiKey: "",
  capabilities: ["TEXT", "JSON_OUTPUT"],
  enabled: true,
};

function ModelManager({
  models,
  onToggle,
  onSetDefault,
  t,
}: {
  models: ModelProfile[];
  onToggle: (item: { id: string; enabled: boolean }) => void;
  onSetDefault: (id: string) => void;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState("installed");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelProfile | null>(null);
  const presetsQuery = useQuery({
    queryKey: ["model-presets"],
    queryFn: studioApi.listModelPresets,
    enabled: section === "presets",
  });
  const form = useForm<ModelFormValues>({ defaultValues: emptyModelForm });
  const saveMutation = useMutation({
    mutationFn: studioApi.saveModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditorOpen(false);
      setNotice(t("modelSaved"));
      setError("");
    },
    onError: () => setError(t("modelSaveFailed")),
  });
  const deleteMutation = useMutation({
    mutationFn: studioApi.deleteModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setDeleteTarget(null);
      setNotice(t("delete"));
      setError("");
    },
    onError: (failure) =>
      setError(failure instanceof Error ? failure.message : t("loadFailed")),
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => studioApi.testModel(id),
    onSuccess: (result) => {
      setTestResult(result);
      setError("");
    },
    onError: () => setError(t("modelTestFailed")),
  });
  const capabilities = form.watch("capabilities");
  const fieldError = (field: keyof ModelFormValues) =>
    form.formState.errors[field] ? t("loadFailed") : null;
  const capabilityOptions: { value: ModelCapability; label: string }[] = [
    { value: "TEXT", label: t("capabilityText") },
    { value: "VISION", label: t("capabilityVision") },
    { value: "AUDIO_INPUT", label: t("capabilityAudio") },
    { value: "TOOLS", label: t("capabilityTools") },
    { value: "JSON_OUTPUT", label: t("capabilityJson") },
    { value: "EMBEDDING", label: t("capabilityEmbedding") },
  ];
  const capabilityLabel = (value: string) =>
    capabilityOptions.find((option) => option.value === value)?.label ?? value;
  const openEditor = (model?: ModelProfile, preset?: ModelPreset) => {
    const source = model ?? preset;
    form.reset(
      source
        ? {
            id: source.id,
            providerType:
              source.providerType === "OLLAMA" ? "OLLAMA" : "OPENAI_COMPATIBLE",
            baseUrl: source.baseUrl,
            modelName: source.modelName,
            credentialRef: source.credentialRef,
            apiKey: "",
            capabilities: source.capabilities as ModelCapability[],
            enabled: model?.enabled ?? true,
          }
        : emptyModelForm,
    );
    setEditingId(model?.id ?? null);
    setEditorOpen(true);
    setError("");
  };
  const submit = form.handleSubmit((values) => {
    const parsed = modelFormSchema.safeParse(values);
    if (!parsed.success) {
      setError(t("loadFailed"));
      return;
    }
    saveMutation.mutate({
      ...parsed.data,
      apiKey: parsed.data.apiKey?.trim() || undefined,
      capabilities: parsed.data.capabilities,
    });
  });
  const removeModel = (model: ModelProfile) => {
    if (model.defaultProfile) {
      setError(t("modelDeleteDefaultHint"));
      return;
    }
    setDeleteTarget(model);
  };

  return (
    <div className="model-manager">
      {deleteTarget ? (
        <InlineDangerConfirm
          title={`${t("deleteModel")} · ${deleteTarget.modelName}`}
          description={t("modelDeleteHint")}
          confirmLabel={t("deleteModel")}
          busy={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}
      <div className="manager-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "installed"}
          className={section === "installed" ? "is-active" : ""}
          onClick={() => {
            setSection("installed");
            setNotice("");
            setError("");
          }}
        >
          {t("modelInstalled")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "presets"}
          className={section === "presets" ? "is-active" : ""}
          onClick={() => {
            setSection("presets");
            setNotice("");
            setError("");
          }}
        >
          {t("modelPresets")}
        </button>
      </div>
      {notice ? (
        <div className="manager-notice success">
          <CheckCircle2 size={14} />
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="manager-notice error">
          <CircleAlert size={14} />
          {error}
        </div>
      ) : null}
      {section === "installed" ? (
        <div className="model-installed">
          <div className="model-toolbar">
            <span>
              {models.length
                ? `${models.length} ${t("models")}`
                : t("modelEmpty")}
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => openEditor()}
            >
              <Plus size={14} />
              {t("addModel")}
            </button>
          </div>
          {models.length ? (
            <div className="model-profile-list">
              {models.map((model) => (
                <div className="model-profile-row" key={model.id}>
                  <span className="model-glyph">
                    <TerminalSquare size={15} />
                  </span>
                  <div className="model-profile-copy">
                    <div className="model-profile-title">
                      <strong>{model.modelName}</strong>
                      {model.defaultProfile ? (
                        <span className="default-mark">
                          <CheckCircle2 size={13} />
                          {t("default")}
                        </span>
                      ) : null}
                    </div>
                    <span>
                      {model.providerType === "OLLAMA"
                        ? t("ollama")
                        : t("openaiCompatible")}{" "}
                      · {model.baseUrl}
                    </span>
                    <div className="model-profile-meta">
                      {model.capabilities.map((capability) => (
                        <span className="capability-tag" key={capability}>
                          {capabilityLabel(capability)}
                        </span>
                      ))}
                      <span
                        className={
                          model.apiKeyConfigured
                            ? "credential-state configured"
                            : "credential-state"
                        }
                      >
                        {model.apiKeyConfigured
                          ? t("modelKeyConfigured")
                          : t("modelNoKey")}
                      </span>
                    </div>
                  </div>
                  <div className="model-profile-actions">
                    <IconButton
                      label={t("testModel")}
                      onClick={() => testMutation.mutate(model.id)}
                      disabled={testMutation.isPending}
                    >
                      <PlugZap size={14} />
                    </IconButton>
                    <IconButton
                      label={t("editModel")}
                      onClick={() => openEditor(model)}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    {model.defaultProfile ? null : (
                      <IconButton
                        label={t("deleteModel")}
                        onClick={() => removeModel(model)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}{" "}
                    {!model.defaultProfile ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onSetDefault(model.id)}
                      >
                        {t("setDefault")}
                      </button>
                    ) : null}
                    <ToggleButton
                      checked={model.enabled}
                      onChange={(enabled) =>
                        onToggle({ id: model.id, enabled })
                      }
                      label={model.enabled ? t("disable") : t("enable")}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {testResult ? (
            <div
              className={`model-test-result ${testResult.success ? "success" : "error"}`}
            >
              <div>
                <strong>
                  {testResult.success
                    ? t("modelTestSuccess")
                    : t("modelTestFailed")}
                </strong>
                <span>{testResult.message}</span>
              </div>
              {testResult.responsePreview ? (
                <p>{testResult.responsePreview}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="model-preset-list">
          {presetsQuery.isLoading ? (
            <div className="manager-placeholder">
              <LoaderCircle size={18} className="spin" />
              <span>{t("loading")}</span>
            </div>
          ) : presetsQuery.isError ? (
            <div className="manager-placeholder">
              <CircleAlert size={16} />
              <span>{t("loadFailed")}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void presetsQuery.refetch()}
              >
                {t("retryLoad")}
              </button>
            </div>
          ) : presetsQuery.data?.length ? (
            presetsQuery.data.map((preset) => (
              <div className="model-preset-row" key={preset.id}>
                <div className="model-preset-copy">
                  <strong>{preset.displayName}</strong>
                  <span>
                    {preset.providerName} · {preset.modelName}
                  </span>
                  <p>{preset.notes}</p>
                  <div className="model-profile-meta">
                    {preset.capabilities.map((capability) => (
                      <span className="capability-tag" key={capability}>
                        {capabilityLabel(capability)}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openEditor(undefined, preset)}
                >
                  <Plus size={14} />
                  {t("usePreset")}
                </button>
              </div>
            ))
          ) : (
            <div className="manager-placeholder compact">
              {t("modelPresetEmpty")}
            </div>
          )}
        </div>
      )}
      {editorOpen ? (
        <div className="model-editor">
          <div className="model-editor-header">
            <div>
              <h4>{editingId ? t("editModel") : t("addModel")}</h4>
              <p>{t("modelDetails")}</p>
            </div>
            <IconButton label={t("close")} onClick={() => setEditorOpen(false)}>
              <X size={16} />
            </IconButton>
          </div>
          <form
            className="model-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="model-form-grid">
              <label>
                {t("modelId")}
                <input {...form.register("id")} disabled={Boolean(editingId)} />
                {fieldError("id") ? (
                  <small className="form-error">{fieldError("id")}</small>
                ) : null}
              </label>
              <label>
                {t("providerType")}
                <select {...form.register("providerType")}>
                  <option value="OPENAI_COMPATIBLE">
                    {t("openaiCompatible")}
                  </option>
                  <option value="OLLAMA">{t("ollama")}</option>
                </select>
              </label>
              <label>
                {t("baseUrl")}
                <input
                  {...form.register("baseUrl")}
                  placeholder="https://api.openai.com/v1"
                />
                {fieldError("baseUrl") ? (
                  <small className="form-error">{fieldError("baseUrl")}</small>
                ) : null}
              </label>
              <label>
                {t("modelName")}
                <input {...form.register("modelName")} />
                {fieldError("modelName") ? (
                  <small className="form-error">
                    {fieldError("modelName")}
                  </small>
                ) : null}
              </label>
              <label>
                {t("credentialRef")}
                <input
                  {...form.register("credentialRef")}
                  placeholder="OPENAI_API_KEY"
                />
                {fieldError("credentialRef") ? (
                  <small className="form-error">
                    {fieldError("credentialRef")}
                  </small>
                ) : null}
              </label>
              <label>
                {t("apiKey")}
                <input
                  {...form.register("apiKey")}
                  type="password"
                  autoComplete="new-password"
                />
                <small className="form-note">{t("apiKeyHint")}</small>
              </label>
            </div>
            <fieldset className="model-capability-fieldset">
              <legend>{t("capabilities")}</legend>
              <div className="model-capability-options">
                {capabilityOptions.map((option) => (
                  <label key={option.value} className="capability-check">
                    <input
                      type="checkbox"
                      checked={capabilities.includes(option.value)}
                      onChange={(event) =>
                        form.setValue(
                          "capabilities",
                          event.target.checked
                            ? [...capabilities, option.value]
                            : capabilities.filter(
                                (value) => value !== option.value,
                              ),
                          { shouldValidate: true },
                        )
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="model-enabled-check">
              <input type="checkbox" {...form.register("enabled")} />
              {t("modelEnabled")}
            </label>
            <div className="inline-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditorOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                {saveMutation.isPending ? t("modelSaving") : t("modelSave")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeManager({
  bases,
  query,
  t,
}: {
  bases: KnowledgeBase[];
  query: ResourceQuery;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editingBase, setEditingBase] = useState(false);
  const [clearDocumentsConfirmation, setClearDocumentsConfirmation] =
    useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedBaseFromList = bases.find((base) => base.id === selectedId);
  const detailQuery = useQuery({
    queryKey: ["knowledge-base", selectedId],
    queryFn: () => studioApi.getKnowledgeBase(selectedId!),
    enabled: Boolean(selectedId),
  });
  const selectedBase = detailQuery.data?.summary ?? selectedBaseFromList;
  const refresh = async () => {
    await queryClient.refetchQueries({ queryKey: ["knowledge-bases"] });
    if (selectedId) {
      await queryClient.refetchQueries({
        queryKey: ["knowledge-base", selectedId],
      });
    }
  };
  const showSuccess = (duplicate = false) => {
    setNotice(duplicate ? t("knowledgeDuplicate") : t("knowledgeImported"));
    setError("");
    setTextOpen(false);
    setSourceName("");
    setContent("");
    refresh();
  };
  const ingestText = useMutation({
    mutationFn: () =>
      studioApi.ingestKnowledgeDocument(selectedId!, {
        sourceName: sourceName.trim(),
        content,
      }),
    onSuccess: (result) => showSuccess(result.duplicate),
    onError: (error) =>
      setError(error instanceof Error && error.message ? error.message : t("knowledgeImportFailed")),
  });
  const uploadFile = useMutation({
    mutationFn: (files: File[]) =>
      studioApi.uploadKnowledgeDocuments(selectedId!, files),
    onSuccess: (result) => {
      const imported = result.files.filter(
        (file) => file.succeeded && !file.duplicate,
      ).length;
      const duplicates = result.files.filter(
        (file) => file.succeeded && file.duplicate,
      ).length;
      const failed = result.files.filter((file) => !file.succeeded);
      setNotice(
        `${t("knowledgeImportResults")}: ${imported} ${t("knowledgeImportedCount")}, ${duplicates} ${t("knowledgeSkippedCount")}, ${failed.length} ${t("knowledgeFailedCount")}`,
      );
      setError(
        failed.length
          ? failed.map((file) => `${file.sourceName}: ${file.error}`).join("\n")
          : "",
      );
      setTextOpen(false);
      refresh();
    },
    onError: (error) =>
      setError(error instanceof Error && error.message ? error.message : t("knowledgeImportFailed")),
  });
  const deleteDocument = useMutation({
    mutationFn: (documentId: string) =>
      studioApi.deleteKnowledgeDocument(selectedId!, documentId),
    onSuccess: refresh,
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const deleteBase = useMutation({
    mutationFn: studioApi.deleteKnowledgeBase,
    onSuccess: refresh,
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const updateBase = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      studioApi.updateKnowledgeBase(id, { name, description: description || undefined }),
    onSuccess: () => {
      setEditingBase(false);
      setNotice(t("knowledgeSaved"));
      setError("");
      refresh();
    },
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const clearDocuments = useMutation({
    mutationFn: () => studioApi.clearKnowledgeDocuments(selectedId!),
    onSuccess: () => {
      setClearDocumentsConfirmation(false);
      setNotice(t("completed"));
      setError("");
      refresh();
    },
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const rebuildDocument = useMutation({
    mutationFn: (documentId: string) =>
      studioApi.rebuildKnowledgeDocument(selectedId!, documentId),
    onSuccess: refresh,
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const rebuildBase = useMutation({
    mutationFn: () => studioApi.rebuildKnowledgeBase(selectedId!),
    onSuccess: refresh,
    onError: () => setError(t("knowledgeActionFailed")),
  });
  const busy =
    ingestText.isPending ||
    uploadFile.isPending ||
    deleteDocument.isPending ||
    rebuildDocument.isPending ||
    rebuildBase.isPending ||
    updateBase.isPending ||
    clearDocuments.isPending;

  useEffect(() => {
    if (selectedId && !bases.some((base) => base.id === selectedId))
      setSelectedId(null);
  }, [bases, selectedId]);

  const openBase = (id: string) => {
    const base = bases.find((item) => item.id === id);
    setSelectedId(id);
    setNotice("");
    setError("");
    setTextOpen(false);
    setEditingBase(false);
    setClearDocumentsConfirmation(false);
    setNameDraft(base?.name ?? "");
    setDescriptionDraft(base?.description ?? "");
  };
  const closeBase = () => {
    setSelectedId(null);
    setNotice("");
    setError("");
    setTextOpen(false);
    setEditingBase(false);
    setClearDocumentsConfirmation(false);
  };
  const handleFiles = (files: File[]) => {
    if (files.length && selectedId) uploadFile.mutate(files);
  };
  const documents = detailQuery.data?.documents ?? [];

  if (selectedBase)
    return (
      <div className="knowledge-detail">
        <button
          type="button"
          className="text-button back-button"
          onClick={closeBase}
        >
          <ArrowLeft size={14} />
          {t("backToKnowledgeBases")}
        </button>
        <div className="knowledge-detail-heading">
          <div>
            <h4>{selectedBase.name}</h4>
            <p>{selectedBase.description || t("noDescription")}</p>
          </div>
          <div className="knowledge-detail-actions">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yml,.yaml,.log,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={(event) => {
                handleFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              {uploadFile.isPending ? t("importing") : t("importFile")}
            </button>
            <button
              type="button"
              className={
                textOpen ? "secondary-button is-active" : "secondary-button"
              }
              disabled={busy}
              onClick={() => {
                setTextOpen((current) => !current);
                setError("");
              }}
            >
              <FileText size={14} />
              {t("importText")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => rebuildBase.mutate()}
            >
              <RefreshCw size={14} />
              {t("rebuildIndex")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setEditingBase((current) => !current)}
            >
              <Pencil size={14} />
              {t("editKnowledge")}
            </button>
            <button
              type="button"
              className="secondary-button danger-text-button"
              disabled={busy || documents.length === 0}
              onClick={() => setClearDocumentsConfirmation(true)}
            >
              <Trash2 size={14} />
              {t("clearDocuments")}
            </button>
          </div>
        </div>
        {notice ? (
          <div className="manager-notice success">
            <CheckCircle2 size={14} />
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="manager-notice error">
            <CircleAlert size={14} />
            {error}
          </div>
        ) : null}
        {editingBase ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameDraft.trim()) {
                updateBase.mutate({
                  id: selectedBase.id,
                  name: nameDraft.trim(),
                  description: descriptionDraft.trim(),
                });
              }
            }}
          >
            <label>
              {t("knowledgeName")}
              <input
                value={nameDraft}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <label>
              {t("knowledgeDescription")}
              <textarea
                value={descriptionDraft}
                rows={2}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
            </label>
            <div className="inline-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditingBase(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!nameDraft.trim() || updateBase.isPending}
              >
                {updateBase.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                {t("saveKnowledge")}
              </button>
            </div>
          </form>
        ) : null}
        {clearDocumentsConfirmation ? (
          <InlineDangerConfirm
            title={`${t("clearDocuments")} · ${selectedBase.name}`}
            description={t("clearDocumentsHint")}
            confirmLabel={t("clearDocuments")}
            busy={clearDocuments.isPending}
            onCancel={() => setClearDocumentsConfirmation(false)}
            onConfirm={() => clearDocuments.mutate()}
          />
        ) : null}
        {textOpen ? (
          <form
            className="inline-form knowledge-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (sourceName.trim() && content.trim()) ingestText.mutate();
            }}
          >
            <label>
              {t("sourceName")}
              <input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder={t("sourceNamePlaceholder")}
                autoFocus
              />
            </label>
            <label>
              {t("documentContent")}
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={7}
                placeholder={t("documentContentPlaceholder")}
              />
            </label>
            <div className="inline-form-actions">
              <span className="form-note">
                {content.length.toLocaleString()} {t("characters")}
              </span>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  !sourceName.trim() || !content.trim() || ingestText.isPending
                }
              >
                <Upload size={14} />
                {ingestText.isPending ? t("importing") : t("startImport")}
              </button>
            </div>
          </form>
        ) : null}
        <div className="knowledge-documents-heading">
          <div>
            <strong>{t("documents")}</strong>
            <span>
              {detailQuery.isLoading
                ? t("loading")
                : `${documents.length} ${t("documentCount")}`}
            </span>
          </div>
        </div>
        {detailQuery.isError ? (
          <div className="manager-placeholder compact">
            <CircleAlert size={16} />
            <span>{t("loadFailed")}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void detailQuery.refetch()}
            >
              {t("retryLoad")}
            </button>
          </div>
        ) : detailQuery.isLoading ? (
          <div className="manager-placeholder compact">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        ) : documents.length ? (
          <div className="knowledge-document-list">
            {documents.map((document) => (
              <KnowledgeDocumentRow
                key={document.id}
                document={document}
                busy={busy}
                onDelete={() => deleteDocument.mutate(document.id)}
                onRebuild={() => rebuildDocument.mutate(document.id)}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="manager-placeholder compact">
            <FileText size={16} />
            <span>{t("noDocuments")}</span>
          </div>
        )}
      </div>
    );

  return (
    <QueryResourceState query={query} t={t}>
      {bases.map((base) => (
        <ResourceRow
          key={base.id}
          icon={<Database size={15} />}
          title={base.name}
          detail={base.description || t("noDescription")}
          status={`${base.documentCount} ${t("documentCount")} 路 ${base.chunkCount} ${t("chunkCount")}`}
          trailing={
            <span className="row-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => openBase(base.id)}
              >
                {t("openKnowledge")}
              </button>
              <ConfirmDeleteButton
                name={base.name}
                description={t("deleteKnowledgeHint")}
                busy={deleteBase.isPending}
                onConfirm={() => deleteBase.mutate(base.id)}
              />
            </span>
          }
        />
      ))}
    </QueryResourceState>
  );
}

function KnowledgeDocumentRow({
  document,
  busy,
  onDelete,
  onRebuild,
  t,
}: {
  document: KnowledgeDocument;
  busy: boolean;
  onDelete: () => void;
  onRebuild: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="knowledge-document-row">
      <div className="model-glyph">
        <FileText size={15} />
      </div>
      <div className="knowledge-document-copy">
        <strong>{document.sourceName}</strong>
        <span>
          {document.contentType || "text/plain"} ·{" "}
          {formatFileSize(document.contentLength)} · {document.chunkCount}{" "}
          {t("chunkCount")}
        </span>
        {document.summary ? <p>{document.summary}</p> : null}
      </div>
      <div className="row-actions">
        {document.rebuildable ? (
          <IconButton label={t("rebuildIndex")} onClick={onRebuild}>
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </IconButton>
        ) : null}
        <ConfirmDeleteButton
          name={document.sourceName}
          description={t("deleteDocumentHint")}
          busy={busy}
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ResourceQuery = {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

function ManagerSubTabs({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="manager-subtabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === "installed"}
        className={value === "installed" ? "is-active" : ""}
        onClick={() => onChange("installed")}
      >
        {t("installed")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "marketplace"}
        className={value === "marketplace" ? "is-active" : ""}
        onClick={() => onChange("marketplace")}
      >
        <Globe2 size={13} />
        {t("onlineRepositories")}
      </button>
    </div>
  );
}

function RepositorySearch({
  value,
  onChange,
  onSubmit,
  pending,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  t: (key: string) => string;
}) {
  return (
    <form
      className="repository-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Search size={15} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("repositorySearchPlaceholder")}
        aria-label={t("repositorySearchPlaceholder")}
      />
      <button type="submit" className="secondary-button" disabled={pending}>
        {pending ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Search size={14} />
        )}
        {t("search")}
      </button>
    </form>
  );
}

function RepositoryRow({
  repository,
  onInspect,
  actionLabel,
  t,
}: {
  repository: SkillRepository | McpRepository;
  onInspect?: () => void;
  actionLabel: string;
  t: (key: string) => string;
}) {
  return (
    <div className="repository-row">
      <div className="repository-main">
        <div className="repository-title">
          <strong>{repository.name}</strong>
          {repository.stars > 0 ? (
            <span className="repository-stars">
              ★ {repository.stars.toLocaleString()}
            </span>
          ) : null}
        </div>
        <p>{repository.description || t("noDescription")}</p>
        <span className="repository-source">
          {repository.sourceType === "CURATED"
            ? t("curatedSource")
            : t("githubSearch")}{" "}
          · {repository.defaultBranch}
        </span>
      </div>
      <div className="repository-actions">
        <a
          className="icon-button"
          href={repository.url}
          target="_blank"
          rel="noreferrer"
          aria-label={t("openRepository")}
          title={t("openRepository")}
        >
          <ExternalLink size={15} />
        </a>
        {onInspect ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onInspect}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkillsManager({
  installed,
  query,
  onToggle,
  t,
}: {
  installed: Skill[];
  query: ResourceQuery;
  onToggle: (item: { id: string; enabled: boolean }) => void;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState("installed");
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<SkillRepository | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [notice, setNotice] = useState("");
  const curatedQuery = useQuery({
    queryKey: ["skill-repositories"],
    queryFn: studioApi.listSkillRepositories,
    enabled: section === "marketplace",
  });
  const searchMutation = useMutation({
    mutationFn: studioApi.searchSkillRepositories,
  });
  const discoverMutation = useMutation({
    mutationFn: studioApi.discoverRepositorySkills,
  });
  const installMutation = useMutation({
    mutationFn: studioApi.installSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setNotice(t("completed"));
      discoverMutation.reset();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: studioApi.deleteSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setDeleteTarget(null);
      setNotice(t("completed"));
    },
  });
  const repositories = searchMutation.data ?? curatedQuery.data ?? [];
  const discover = (repository: SkillRepository) => {
    setSelectedRepo(repository);
    discoverMutation.mutate({
      repoUrl: repository.url,
      ref: repository.defaultBranch,
      limit: 50,
    });
  };

  return (
    <div className="manager-stack">
      {deleteTarget ? (
        <InlineDangerConfirm
          title={`${t("delete")} · ${deleteTarget.name}`}
          description={`${t("confirmDelete")}: ${deleteTarget.name}`}
          confirmLabel={t("delete")}
          busy={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}
      <ManagerSubTabs
        value={section}
        onChange={(next) => {
          setSection(next);
          setSelectedRepo(null);
          setNotice("");
        }}
        t={t}
      />
      {notice ? (
        <div className="manager-notice success">
          <CheckCircle2 size={14} />
          {notice}
        </div>
      ) : null}
      {section === "installed" ? (
        <QueryResourceState query={query} t={t}>
          {installed.map((skill) => (
            <ResourceRow
              key={skill.id}
              icon={<Sparkles size={15} />}
              title={skill.name}
              detail={skill.description}
              status={skill.enabled ? t("enabled") : t("disabled")}
              trailing={
                <span className="row-actions">
                  <ToggleButton
                    checked={skill.enabled}
                    onChange={(enabled) => onToggle({ id: skill.id, enabled })}
                    label={skill.enabled ? t("disable") : t("enable")}
                  />
                  <button
                    type="button"
                    className="text-button danger-text-button"
                    onClick={() => setDeleteTarget(skill)}
                  >
                    {t("delete")}
                  </button>
                </span>
              }
            />
          ))}
        </QueryResourceState>
      ) : (
        <div className="marketplace-stack">
          <RepositorySearch
            value={search}
            onChange={setSearch}
            pending={searchMutation.isPending}
            onSubmit={() => {
              setNotice("");
              searchMutation.mutate({
                query: search.trim() || undefined,
                limit: 12,
              });
            }}
            t={t}
          />
          {selectedRepo ? (
            <SkillDiscovery
              repository={selectedRepo}
              query={discoverMutation}
              installed={installed}
              installing={installMutation.isPending}
              onBack={() => {
                setSelectedRepo(null);
                discoverMutation.reset();
              }}
              onInstall={(skill) =>
                installMutation.mutate({
                  repoUrl: skill.repositoryUrl,
                  ref: skill.ref,
                  path: skill.path || undefined,
                  id: skill.installId,
                  enabled: true,
                  overwrite: false,
                })
              }
              t={t}
            />
          ) : (
            <RepositoryResults
              repositories={repositories}
              loading={curatedQuery.isLoading || searchMutation.isPending}
              error={curatedQuery.isError || searchMutation.isError}
              onRetry={() => void curatedQuery.refetch()}
              onInspect={discover}
              actionLabel={t("viewSkills")}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RepositoryResults({
  repositories,
  loading,
  error,
  onRetry,
  onInspect,
  actionLabel,
  t,
}: {
  repositories: Array<SkillRepository | McpRepository>;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onInspect?: (repository: any) => void;
  actionLabel: string;
  t: (key: string) => string;
}) {
  if (loading)
    return (
      <div className="manager-placeholder">
        <LoaderCircle size={18} className="spin" />
        <span>{t("loadingRepositories")}</span>
      </div>
    );
  if (error)
    return (
      <div className="manager-placeholder">
        <CircleAlert size={18} />
        <span>{t("repositoryLoadFailed")}</span>
        <button type="button" className="secondary-button" onClick={onRetry}>
          {t("retryLoad")}
        </button>
      </div>
    );
  return repositories.length ? (
    <div className="repository-list">
      {repositories.map((repository) => (
        <RepositoryRow
          key={repository.id}
          repository={repository}
          onInspect={
            onInspect && "defaultBranch" in repository
              ? () => onInspect(repository)
              : undefined
          }
          actionLabel={actionLabel}
          t={t}
        />
      ))}
    </div>
  ) : (
    <div className="manager-placeholder compact">{t("noRepositories")}</div>
  );
}

function SkillDiscovery({
  repository,
  query,
  installed,
  installing,
  onBack,
  onInstall,
  t,
}: {
  repository: SkillRepository;
  query: { data?: RepositorySkill[]; isPending: boolean; isError: boolean };
  installed: Skill[];
  installing: boolean;
  onBack: () => void;
  onInstall: (skill: RepositorySkill) => void;
  t: (key: string) => string;
}) {
  const installedIds = new Set(installed.map((skill) => skill.id));
  return (
    <div className="discovery-view">
      <button
        type="button"
        className="text-button back-button"
        onClick={onBack}
      >
        ← {t("backToRepositories")}
      </button>
      <div className="discovery-heading">
        <div>
          <strong>{repository.name}</strong>
          <span>{t("skillsFoundFromRepository")}</span>
        </div>
        <a
          href={repository.url}
          target="_blank"
          rel="noreferrer"
          className="source-link"
        >
          <ExternalLink size={13} />
          {t("openRepository")}
        </a>
      </div>
      {query.isPending ? (
        <div className="manager-placeholder">
          <LoaderCircle size={18} className="spin" />
          <span>{t("discoveringSkills")}</span>
        </div>
      ) : query.isError ? (
        <div className="manager-placeholder">
          <CircleAlert size={18} />
          <span>{t("discoverFailed")}</span>
        </div>
      ) : query.data?.length ? (
        <div className="skill-candidate-list">
          {query.data.map((skill) => {
            const isInstalled = installedIds.has(skill.installId);
            return (
              <div
                className="skill-candidate"
                key={`${skill.repositoryUrl}:${skill.path}`}
              >
                <div>
                  <strong>{skill.name}</strong>
                  <p>{skill.description}</p>
                  <span>{skill.path || "SKILL.md"}</span>
                </div>
                <button
                  type="button"
                  className={
                    isInstalled ? "secondary-button" : "primary-button"
                  }
                  disabled={isInstalled || installing}
                  onClick={() => onInstall(skill)}
                >
                  {isInstalled ? (
                    <>
                      <Check size={14} />
                      {t("installed")}
                    </>
                  ) : installing ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <>
                      <Package size={14} />
                      {t("install")}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="manager-placeholder compact">{t("noSkillsFound")}</div>
      )}
    </div>
  );
}

type McpConnectionForm = {
  name: string;
  description: string;
  transportType: "STDIO" | "STREAMABLE_HTTP" | "SSE";
  command: string;
  args: string;
  endpoint: string;
  env: string;
};

const mcpConnectionSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  transportType: z.enum(["STDIO", "STREAMABLE_HTTP", "SSE"]),
  command: z.string(),
  args: z.string(),
  endpoint: z.string(),
  env: z.string(),
});

const emptyMcpConnectionForm: McpConnectionForm = {
  name: "",
  description: "",
  transportType: "STDIO",
  command: "",
  args: "",
  endpoint: "",
  env: "",
};

function parseMcpEnvironment(value: string) {
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const divider = line.indexOf("=");
      return divider > 0
        ? [
            [
              line.slice(0, divider).trim(),
              line.slice(divider + 1).trim(),
            ] as const,
          ]
        : [];
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function McpManager({
  connections,
  query,
  onToggle,
  onRefresh,
  t,
}: {
  connections: McpConnection[];
  query: ResourceQuery;
  onToggle: (item: { id: string; enabled: boolean }) => void;
  onRefresh: (id: string) => void;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState("installed");
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<McpRepository | null>(null);
  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [editorFor, setEditorFor] = useState<McpConnection | null | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState<McpConnection | null>(null);
  const form = useForm<McpConnectionForm>({
    defaultValues: emptyMcpConnectionForm,
  });
  const curatedQuery = useQuery({
    queryKey: ["mcp-repositories"],
    queryFn: studioApi.listMcpRepositories,
    enabled: section === "marketplace",
  });
  const searchMutation = useMutation({
    mutationFn: studioApi.searchMcpRepositories,
  });
  const installMutation = useMutation({
    mutationFn: studioApi.installNpmMcp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setSelectedRepo(null);
      setPackageName("");
      setPackageDescription("");
      setNotice(t("completed"));
    },
  });
  const saveMutation = useMutation({
    mutationFn: ({
      target,
      values,
    }: {
      target: McpConnection | null;
      values: McpConnectionForm;
    }) => {
      const parsed = mcpConnectionSchema.parse(values);
      const payload = {
        name: parsed.name,
        description: parsed.description.trim() || undefined,
        transportType: parsed.transportType,
        ...(parsed.command.trim() ? { command: parsed.command.trim() } : {}),
        ...(parsed.args.trim() ? { args: parsed.args.split(/\s+/) } : {}),
        ...(parsed.endpoint.trim() ? { endpoint: parsed.endpoint.trim() } : {}),
        ...(parseMcpEnvironment(parsed.env)
          ? { env: parseMcpEnvironment(parsed.env) }
          : {}),
      };
      return target
        ? studioApi.updateMcpConnection(target.id, payload)
        : studioApi.createMcpConnection(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setEditorFor(undefined);
      setNotice(t("completed"));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: studioApi.deleteMcpConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setDeleteTarget(null);
      setNotice(t("completed"));
    },
  });
  const setToolEnabled = useMutation({
    mutationFn: ({
      connectionId,
      toolName,
      enabled,
    }: {
      connectionId: string;
      toolName: string;
      enabled: boolean;
    }) => studioApi.setMcpToolEnabled(connectionId, toolName, enabled),
    onSuccess: (tool, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setEditorFor((current) =>
        current && current.id === variables.connectionId
          ? {
              ...current,
              tools: (current.tools ?? []).map((candidate) =>
                candidate.name === tool.name ? tool : candidate,
              ),
            }
          : current,
      );
    },
  });
  const invocationQuery = useQuery({
    queryKey: ["mcp-tool-invocations", editorFor?.id],
    queryFn: studioApi.listMcpToolInvocations,
    enabled: Boolean(editorFor?.id),
  });
  const repositories = searchMutation.data ?? curatedQuery.data ?? [];
  const openEditor = (connection: McpConnection | null) => {
    form.reset(
      connection
        ? {
            name: connection.name,
            description: displayMcpDescription(connection.description, ""),
            transportType:
              connection.transportType === "SSE"
                ? "SSE"
                : connection.transportType === "STREAMABLE_HTTP"
                  ? "STREAMABLE_HTTP"
                  : "STDIO",
            command: connection.command ?? "",
            args: connection.args?.join(" ") ?? "",
            endpoint: connection.endpoint ?? "",
            env: connection.envKeys?.join("\n") ?? "",
          }
        : emptyMcpConnectionForm,
    );
    setEditorFor(connection);
  };
  const transportType = form.watch("transportType");

  if (editorFor !== undefined)
    return (
      <div className="mcp-detail">
        <button
          type="button"
          className="text-button back-button"
          onClick={() => setEditorFor(undefined)}
        >
          <ArrowLeft size={14} />
          {t("mcp")}
        </button>
        <div className="panel-heading">
          <div>
            <h3>{editorFor ? t("editMcp") : t("addMcp")}</h3>
            <p>{t("mcpEditorHint")}</p>
          </div>
        </div>
        <form
          className="mcp-editor"
          onSubmit={form.handleSubmit((values) =>
            saveMutation.mutate({ target: editorFor, values }),
          )}
        >
          <div className="model-form-grid">
            <label>
              {t("mcpName")}
              <input {...form.register("name")} autoFocus />
            </label>
            <label>
              {t("mcpTransport")}
              <select {...form.register("transportType")}>
                <option value="STDIO">STDIO</option>
                <option value="STREAMABLE_HTTP">Streamable HTTP</option>
                <option value="SSE">SSE</option>
              </select>
            </label>
            <label className="mcp-span-two">
              {t("description")}
              <input {...form.register("description")} />
            </label>
            {transportType === "STDIO" ? (
              <>
                <label>
                  {t("mcpCommand")}
                  <input {...form.register("command")} placeholder="npx" />
                </label>
                <label>
                  {t("mcpArguments")}
                  <input
                    {...form.register("args")}
                    placeholder="-y @modelcontextprotocol/server-filesystem"
                  />
                </label>
              </>
            ) : (
              <label className="mcp-span-two">
                {t("mcpEndpoint")}
                <input
                  {...form.register("endpoint")}
                  type="url"
                  placeholder="https://example.com/mcp"
                />
              </label>
            )}
            <label className="mcp-span-two">
              {t("mcpEnvironment")}
              <textarea
                {...form.register("env")}
                rows={3}
                placeholder="API_KEY=..."
              />
              <small className="form-note">
                {editorFor?.envKeys?.length
                  ? `${t("mcpEnvConfigured")}: ${editorFor.envKeys.join(", ")}`
                  : t("mcpEnvNote")}
              </small>
            </label>
          </div>
          {editorFor ? (
            <McpToolList
              connectionId={editorFor.id}
              tools={editorFor.tools ?? []}
              pendingToolName={
                setToolEnabled.isPending
                  ? setToolEnabled.variables?.toolName
                  : undefined
              }
              onToggle={(tool) =>
                setToolEnabled.mutate({
                  connectionId: editorFor.id,
                  toolName: tool.name,
                  enabled: !tool.enabled,
                })
              }
              invocations={(invocationQuery.data ?? []).filter(
                (invocation) => invocation.connectionId === editorFor.id,
              )}
              invocationsLoading={invocationQuery.isLoading}
              invocationsError={invocationQuery.isError}
              t={t}
            />
          ) : null}
          {saveMutation.isError ? (
            <p className="form-error">{t("loadFailed")}</p>
          ) : null}
          <div className="inline-form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setEditorFor(undefined)}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    );

  return (
    <div className="manager-stack">
      {deleteTarget ? (
        <InlineDangerConfirm
          title={t("deleteMcp")}
          description={`${t("deleteMcpHint")} ${deleteTarget.name}`}
          confirmLabel={t("deleteMcp")}
          busy={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}
      <ManagerSubTabs
        value={section}
        onChange={(next) => {
          setSection(next);
          setSelectedRepo(null);
          setNotice("");
        }}
        t={t}
      />
      {notice ? (
        <div className="manager-notice success">
          <CheckCircle2 size={14} />
          {notice}
        </div>
      ) : null}
      {section === "installed" ? (
        <>
          <div className="model-toolbar">
            <span>
              {connections.length
                ? `${connections.length} ${t("mcpConnections")}`
                : t("emptyList")}
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => openEditor(null)}
            >
              <Plus size={14} />
              {t("addMcp")}
            </button>
          </div>
          <QueryResourceState query={query} t={t}>
            {connections.map((connection) => (
              <ResourceRow
                key={connection.id}
                icon={<Globe2 size={15} />}
                title={connection.name}
                detail={
                  displayMcpDescription(
                    connection.description,
                    t("mcpDescriptionUnavailable"),
                  )
                }
                status={statusLabel(connection.status, t)}
                trailing={
                  <span className="row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openEditor(connection)}
                    >
                      {t("editMcp")}
                    </button>
                    <IconButton
                      label={t("refreshTools")}
                      onClick={() => onRefresh(connection.id)}
                    >
                      <RefreshCw size={14} />
                    </IconButton>
                    <ToggleButton
                      checked={connection.enabled}
                      onChange={(enabled) =>
                        onToggle({ id: connection.id, enabled })
                      }
                      label={connection.enabled ? t("disable") : t("enable")}
                    />
                    <button
                      type="button"
                      className="text-button danger-text-button"
                      onClick={() => setDeleteTarget(connection)}
                    >
                      {t("delete")}
                    </button>
                  </span>
                }
              />
            ))}
          </QueryResourceState>
        </>
      ) : (
        <div className="marketplace-stack">
          <RepositorySearch
            value={search}
            onChange={setSearch}
            pending={searchMutation.isPending}
            onSubmit={() => {
              setNotice("");
              searchMutation.mutate({
                query: search.trim() || undefined,
                limit: 12,
              });
            }}
            t={t}
          />
          {selectedRepo ? (
            <div className="mcp-install-panel">
              <button
                type="button"
                className="text-button back-button"
                onClick={() => setSelectedRepo(null)}
              >
                <ArrowLeft size={14} />
                {t("backToRepositories")}
              </button>
              <div className="discovery-heading">
                <div>
                  <strong>{selectedRepo.name}</strong>
                  <span>{t("mcpInstallHint")}</span>
                </div>
                <a
                  href={selectedRepo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="source-link"
                >
                  <ExternalLink size={13} />
                  {t("openRepository")}
                </a>
              </div>
              <label>
                {t("npmPackage")}
                <input
                  value={packageName}
                  onChange={(event) => setPackageName(event.target.value)}
                  placeholder="@modelcontextprotocol/server-filesystem"
                />
              </label>
              <label>
                {t("mcpDescription")}
                <input
                  value={packageDescription}
                  onChange={(event) =>
                    setPackageDescription(event.target.value)
                  }
                />
              </label>
              <p className="form-note">{t("mcpEnvNote")}</p>
              {installMutation.isError ? (
                <p className="form-error">{t("installFailed")}</p>
              ) : null}
              <button
                type="button"
                className="primary-button"
                disabled={!packageName.trim() || installMutation.isPending}
                onClick={() =>
                  installMutation.mutate({
                    name:
                      selectedRepo.name.split("/").pop() || selectedRepo.name,
                    description: packageDescription || selectedRepo.description,
                    npmPackage: packageName.trim(),
                    enabled: true,
                    refreshTools: true,
                  })
                }
              >
                {installMutation.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Package size={14} />
                )}
                {t("installMcp")}
              </button>
            </div>
          ) : (
            <RepositoryResults
              repositories={repositories}
              loading={curatedQuery.isLoading || searchMutation.isPending}
              error={curatedQuery.isError || searchMutation.isError}
              onRetry={() => void curatedQuery.refetch()}
              onInspect={(repository) => setSelectedRepo(repository)}
              actionLabel={t("installMcp")}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}

function McpToolList({
  connectionId,
  tools,
  pendingToolName,
  onToggle,
  invocations,
  invocationsLoading,
  invocationsError,
  t,
}: {
  connectionId: string;
  tools: McpTool[];
  pendingToolName?: string;
  onToggle: (tool: McpTool) => void;
  invocations: McpToolInvocation[];
  invocationsLoading: boolean;
  invocationsError: boolean;
  t: (key: string) => string;
}) {
  return (
    <section className="mcp-tool-section" aria-label={t("mcpTools")}>
      <div className="knowledge-documents-heading">
        <div>
          <h4>{t("mcpTools")}</h4>
          <p>{tools.length ? `${tools.length}` : t("noMcpTools")}</p>
        </div>
      </div>
      {tools.length ? (
        <div className="mcp-tool-list">
          {tools.map((tool) => (
            <div className="mcp-tool-row" key={`${connectionId}-${tool.name}`}>
              <div className="model-glyph">
                <Wrench size={14} />
              </div>
              <div>
                <div className="node-tool-title">
                  <strong>{tool.name}</strong>
                  {tool.riskLevel ? <span className="risk-mark">{tool.riskLevel}</span> : null}
                </div>
                <span>{tool.description || t("noDescription")}</span>
              </div>
              <ToggleButton
                checked={tool.enabled}
                disabled={pendingToolName === tool.name}
                onChange={() => onToggle(tool)}
                label={tool.enabled ? t("disable") : t("enable")}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="manager-placeholder compact">{t("noMcpTools")}</div>
      )}
      <section className="mcp-tool-section" aria-label={t("mcpInvocationAudit")}>
        <div className="knowledge-documents-heading">
          <div>
            <h4>{t("mcpInvocationAudit")}</h4>
            <p>{invocations.length ? `${invocations.length}` : t("noMcpInvocations")}</p>
          </div>
        </div>
        {invocationsLoading ? (
          <div className="manager-placeholder compact"><LoaderCircle size={14} className="spin" /> {t("loading")}</div>
        ) : invocationsError ? (
          <div className="manager-notice error"><CircleAlert size={14} /> {t("loadFailed")}</div>
        ) : invocations.length ? (
          <div className="mcp-invocation-list">
            {invocations.slice(0, 12).map((invocation) => (
              <div className="mcp-invocation-row" key={invocation.id}>
                <Wrench size={14} />
                <div>
                  <strong>{invocation.toolName}</strong>
                  <span>{formatTimestamp(invocation.finishedAt ?? invocation.createdAt)}</span>
                </div>
                <span className="list-status">{invocation.status}</span>
                {invocation.errorCategory ? <small>{invocation.errorCategory}</small> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="manager-placeholder compact">{t("noMcpInvocations")}</div>
        )}
      </section>
    </section>
  );
}

function InlineDangerConfirm({
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-danger-confirm">
      <CircleAlert size={16} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="inline-form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : null}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function QueryResourceState({
  query,
  children,
  t,
}: {
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  children: React.ReactNode;
  t: (key: string) => string;
}) {
  if (query.isLoading)
    return (
      <div className="manager-placeholder">
        <LoaderCircle size={18} className="spin" />
        <span>{t("loading")}</span>
      </div>
    );
  if (query.isError)
    return (
      <div className="manager-placeholder">
        <CircleAlert size={18} />
        <span>{t("loadFailed")}</span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void query.refetch()}
        >
          {t("retryLoad")}
        </button>
      </div>
    );
  return (
    <div className="manager-list">
      {Children.count(children) ? (
        children
      ) : (
        <div className="manager-placeholder compact">
          <span>{t("emptyList")}</span>
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  icon,
  title,
  detail,
  status,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  status: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="manager-list-item">
      <span className="model-glyph">{icon}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <span className="list-status">{status}</span>
      {trailing}
    </div>
  );
}

function ToggleButton({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle-button ${checked ? "is-on" : ""}`}
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function extractApprovalId(payload: string) {
  const match = /approvalId=([^\s,]+)/.exec(payload);
  if (match?.[1]) return match[1];
  try {
    const parsed = JSON.parse(payload) as { approvalId?: unknown };
    return typeof parsed.approvalId === "string" && parsed.approvalId
      ? parsed.approvalId
      : undefined;
  } catch {
    return undefined;
  }
}

function parseRunCitations(payload: string): Citation[] {
  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Partial<Citation>;
      if (
        typeof value.id !== "string" ||
        typeof value.source !== "string" ||
        typeof value.title !== "string" ||
        typeof value.quote !== "string"
      )
        return [];
      if (
        value.type !== "knowledge" &&
        value.type !== "web" &&
        value.type !== "mcp"
      )
        return [];
      return [
        {
          id: value.id || `source-${index}`,
          source: value.source,
          title: value.title,
          quote: value.quote,
          location:
            typeof value.location === "string" ? value.location : undefined,
          type: value.type,
        },
      ];
    });
  } catch {
    return [];
  }
}

function displayMcpDescription(value: string | undefined, fallback: string) {
  const text = value?.trim() ?? "";
  if (!text) return fallback;
  const suspiciousCount = (text.match(/[?？�]/g) ?? []).length;
  if (suspiciousCount >= 2 && suspiciousCount / text.length >= 0.12)
    return fallback;
  return text;
}

function elapsedSince(value?: string) {
  const start = value ? Date.parse(value) : Date.now();
  return Math.max(0, Date.now() - start);
}

function extractQueuePosition(payload: string) {
  const match = /(?:^|[,\s])position=(\d+)/i.exec(payload);
  return match ? Number(match[1]) : undefined;
}

function queuePositionLabel(t: (key: string) => string, position: number) {
  return t("queuePosition").replace("{{position}}", String(position));
}

function formatDuration(milliseconds: number) {
  const seconds = milliseconds / 1000;
  return seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
}

function statusLabel(status: string | undefined, t: (key: string) => string) {
  if (!status) return t("offline");
  const normalized = status.toLowerCase();
  if (
    normalized.includes("connected") ||
    normalized.includes("online") ||
    normalized.includes("ready") ||
    normalized.includes("configured")
  )
    return t("connectedStatus");
  if (normalized.includes("degraded") || normalized.includes("error"))
    return t("degradedStatus");
  return t("disconnectedStatus");
}

function idToQueryKey(id: string) {
  if (id === "skills") return ["skills"];
  if (id === "mcp") return ["mcp-connections"];
  if (id === "knowledge") return ["knowledge-bases"];
  if (id === "nodes") return ["nodes"];
  if (id === "models") return ["models"];
  return ["agents"];
}

export default App;
