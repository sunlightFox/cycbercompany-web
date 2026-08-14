import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Copy,
  Database,
  Download,
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
import {
  Children,
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { RunLaunchTimeoutError, studioApi, streamRunEvents } from "./lib/api";
import { createUuid } from "./lib/uuid";
import { useStudioStore } from "./store/useStudioStore";
import { AgentManager } from "./components/AgentManager";
import type {
  Agent,
  ApprovalMode,
  Artifact,
  Citation,
  ClawHubSkill,
  ExecutionMode,
  ConversationAttachment,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeSettings,
  KnowledgeSettingsUpdate,
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
  RepositorySkill,
  RunEvent,
  RunView,
  RunStep,
  Skill,
  SkillPreflight,
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
const APPROVAL_MODE_STORAGE_KEY = "studio-conversation-approval-modes";
const AssistantMarkdown = lazy(() => import("./components/AssistantMarkdown"));
const NodeManager = lazy(() => import("./components/NodeManager"));
const CitationDrawer = lazy(() => import("./components/CitationDrawer"));
const RunAuditDrawer = lazy(() => import("./components/RunAuditDrawer"));
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function isTextAttachment(file: Pick<File, "name" | "type">) {
  return (
    file.type.startsWith("text/") ||
    /\.(md|markdown|txt|csv|tsv|json|xml|yml|yaml|log)$/i.test(file.name)
  );
}

function isOfficeAttachment(file: Pick<File, "name">) {
  return /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(file.name);
}

function isModelReadableAttachment(file: Pick<File, "name" | "type">) {
  return isTextAttachment(file) || isOfficeAttachment(file) || /\.pdf$/i.test(file.name) || file.type === "application/pdf";
}

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
  return citationsUsedInAnswer(
    message.content,
    readCitationCache()[citationStorageKey(conversationId, message.runId)] ?? [],
  );
}

function readConversationApprovalMode(conversationId: string | null): ApprovalMode {
  if (!conversationId) return "on-request";
  try {
    const stored = JSON.parse(
      localStorage.getItem(APPROVAL_MODE_STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    const mode = stored[conversationId];
    return mode === "full-access" || mode === "auto-approve"
      ? mode
      : "on-request";
  } catch {
    return "on-request";
  }
}

function writeConversationApprovalMode(
  conversationId: string,
  mode: ApprovalMode,
) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(APPROVAL_MODE_STORAGE_KEY) ?? "{}",
    ) as Record<string, ApprovalMode>;
    stored[conversationId] = mode;
    localStorage.setItem(APPROVAL_MODE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    localStorage.setItem(
      APPROVAL_MODE_STORAGE_KEY,
      JSON.stringify({ [conversationId]: mode }),
    );
  }
}

function isNetworkFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|network request failed/i.test(error.message);
}

function citationsUsedInAnswer(content: string, citations: Citation[]) {
  const citationOrdinals = new Map<Citation["type"], number>();
  return citations.filter((citation) => {
    const ordinal = (citationOrdinals.get(citation.type) ?? 0) + 1;
    citationOrdinals.set(citation.type, ordinal);
    const prefix = citation.type === "knowledge" ? "K" : citation.type === "web" ? "W" : "M";
    return new RegExp(`\\[${prefix}${ordinal}(?::[^\\]]+)?\\]`).test(content);
  });
}

const TERMINAL_RUN_STATUSES = new Set([
  "SUCCEEDED",
  "NEEDS_VERIFICATION",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "INTERRUPTED",
]);

function messageFromRun(message: StudioMessage, run: RunView, translate: (key: string) => string): StudioMessage {
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  const delivery: StudioMessage["delivery"] = run.deliveryGate?.status === "VERIFIED"
    ? "verified"
    : run.status === "SUCCEEDED"
      ? "unavailable"
      : run.deliveryGate?.status === "UNAVAILABLE"
        ? "unavailable"
        : "needsVerification";
  const base = {
    ...message,
    runId: run.id,
    queuePosition: run.queuePosition ?? message.queuePosition,
    delivery,
    deliveryGate: run.deliveryGate ?? (run.status === "SUCCEEDED" ? null : { status: "UNAVAILABLE" }),
    sync: terminal ? "recovered" as const : "reconnecting" as const,
    lifecycle: terminal ? "terminal" as const : run.status === "WAITING_APPROVAL" ? "waitingApproval" as const : ["QUEUED", "CREATED"].includes(run.status) ? "queued" as const : "running" as const,
  };
  if (run.status === "SUCCEEDED") return { ...base, content: run.finalAnswer || message.content, isStreaming: false, runState: "completed", outcome: "succeeded", error: undefined };
  if (run.status === "NEEDS_VERIFICATION") return { ...base, content: run.finalAnswer || message.content, isStreaming: false, runState: "needsVerification", outcome: "succeeded", error: run.errorMessage || translate("needsVerification") };
  if (run.status === "FAILED") return { ...base, isStreaming: false, runState: "failed", outcome: "failed", error: run.errorMessage || translate("runFailed") };
  if (run.status === "TIMED_OUT") return { ...base, isStreaming: false, runState: "timedOut", outcome: "failed", error: run.errorMessage || translate("runFailed") };
  if (run.status === "INTERRUPTED") return { ...base, isStreaming: false, runState: "interrupted", outcome: "failed", error: run.errorMessage || translate("runFailed") };
  if (run.status === "CANCELLED") return { ...base, isStreaming: false, runState: "cancelled", outcome: "cancelled", error: translate("runCancelled") };
  if (run.status === "WAITING_APPROVAL") return { ...base, isStreaming: true, runState: "waitingApproval", outcome: "unknown" };
  if (["QUEUED", "CREATED"].includes(run.status)) return { ...base, isStreaming: true, runState: "queued", outcome: "unknown" };
  return { ...base, isStreaming: true, runState: "running", outcome: "unknown" };
}

function withPendingApproval(
  message: StudioMessage,
  pendingApprovalByRun: Map<string, string>,
): StudioMessage {
  const approvalId = message.runId ? pendingApprovalByRun.get(message.runId) : undefined;
  return approvalId
    ? { ...message, approvalId, approvalDecision: "pending" }
    : message;
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  tooltip = true,
  disabled = false,
  buttonRef,
  ariaExpanded,
  ariaControls,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  tooltip?: boolean;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  const button = (
    <button
      className={`icon-button ${active ? "is-active" : ""}`}
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      type="button"
      onClick={onClick}
      disabled={disabled}
      ref={buttonRef}
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

function ConversationAttachmentShelf({
  attachments,
  deleting,
  onDownload,
  onDelete,
  t,
}: {
  attachments: ConversationAttachment[];
  deleting: boolean;
  onDownload: (attachment: ConversationAttachment) => void;
  onDelete: (attachment: ConversationAttachment) => void;
  t: (key: string) => string;
}) {
  if (!attachments.length) return null;
  return (
    <section className="conversation-attachment-shelf" aria-label={t("conversationAttachments")}>
      <span className="conversation-attachment-title">{t("conversationAttachments")}</span>
      <div className="conversation-attachment-list">
        {attachments.map((attachment) => (
          <div className="conversation-attachment-item" key={attachment.id}>
            <FileText size={13} />
            <span title={attachment.fileName}>{attachment.fileName}</span>
            <small>{formatFileSize(attachment.byteSize)}</small>
            <IconButton label={`${t("downloadAttachment")} ${attachment.fileName}`} onClick={() => onDownload(attachment)}>
              <Download size={14} />
            </IconButton>
            <ConfirmDeleteButton
              name={attachment.fileName}
              description={t("deleteAttachmentHint")}
              busy={deleting}
              onConfirm={() => onDelete(attachment)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const theme = useStudioStore((state) => state.theme);
  const sidebarOpen = useStudioStore((state) => state.sidebarOpen);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const sourceCitationId = useStudioStore((state) => state.sourceCitationId);
  const selectedAgentId = useStudioStore((state) => state.selectedAgentId);
  const conversationId = useStudioStore((state) => state.conversationId);
  const messages = useStudioStore((state) => state.messages);
  const setTheme = useStudioStore((state) => state.setTheme);
  const setSidebarOpen = useStudioStore((state) => state.setSidebarOpen);
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
  const [, setManagedRunIds] = useState<string[]>([]);
  const [stoppingRunIds, setStoppingRunIds] = useState<string[]>([]);
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
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() =>
    readConversationApprovalMode(conversationId),
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [skillPreflight, setSkillPreflight] = useState<SkillPreflight | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [historyEntries, setHistoryEntries] =
    useState<HistoryEntry[]>(readHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(
    null,
  );
  const [recoveryRunIds, setRecoveryRunIds] = useState<string[]>([]);
  const [auditRunId, setAuditRunId] = useState<string | null>(null);
  const [isNearConversationBottom, setIsNearConversationBottom] = useState(true);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const stopRequestedRunIdsRef = useRef(new Set<string>());
  const runInputRef = useRef(new Map<string, string>());
  const conversationInputRef = useRef(new Map<string, string>());
  const ensureConversationRef = useRef<Promise<string> | null>(null);
  const restoredConversationRef = useRef<string | null>(null);
  const conversationLoadRef = useRef(0);
  const initialConversationRef = useRef(conversationId);
  const runSessionRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const configurationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const stageRef = useRef<HTMLElement>(null);

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return [];
    });
  }, []);

  const removeAttachment = useCallback(
    (id: string) => {
      const attachment = attachments.find((item) => item.id === id);
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      const remaining = attachments.filter((item) => item.id !== id);
      setAttachments(remaining);
      setComposerNotice(
        remaining.some((item) => !isTextAttachment(item.file))
          ? t("attachmentModelLimited")
          : null,
      );
    },
    [attachments, t],
  );

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
      setMessages((messages) =>
        messages.map((message) =>
            message.role === "ASSISTANT" && message.runId === runId
              ? updater(message)
              : message,
        ),
      );
    },
    [setMessages],
  );
  const trackRun = useCallback((runId: string) => {
    setManagedRunIds((current) =>
      current.includes(runId) ? current : [...current, runId],
    );
  }, []);
  const replaceTrackedRun = useCallback((previousRunId: string, runId: string) => {
    const input = runInputRef.current.get(previousRunId);
    if (input !== undefined) {
      runInputRef.current.delete(previousRunId);
      runInputRef.current.set(runId, input);
    }
    setManagedRunIds((current) =>
      current.map((item) => (item === previousRunId ? runId : item)),
    );
  }, []);
  const finishRun = useCallback((runId: string) => {
    abortControllersRef.current.delete(runId);
    stopRequestedRunIdsRef.current.delete(runId);
    setManagedRunIds((current) => current.filter((item) => item !== runId));
    setStoppingRunIds((current) => current.filter((item) => item !== runId));
    setRecoveryRunIds((current) => current.filter((item) => item !== runId));
    setComposerNotice((current) =>
      current === t("stoppingRun") ? null : current,
    );
  }, [t]);
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: studioApi.listAgents,
    retry: 1,
    refetchInterval: 30_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: studioApi.listModels,
    retry: 1,
    refetchInterval: 30_000,
  });
  const executionSettingsQuery = useQuery({
    queryKey: ["execution-settings"],
    queryFn: studioApi.getExecutionSettings,
    retry: 1,
    refetchInterval: 30_000,
  });
  const executionMode = executionSettingsQuery.data?.mode ?? "PERSONAL_LOCAL";
  const exposesNodes = executionMode !== "PERSONAL_LOCAL";
  const reconnecting = agentsQuery.isFetching || modelsQuery.isFetching;
  const handleReconnect = useCallback(async () => {
    setComposerNotice(t("reconnecting"));
    const [agentsResult, modelsResult] = await Promise.all([
      agentsQuery.refetch(),
      modelsQuery.refetch(),
    ]);
    if (agentsResult.isError || modelsResult.isError)
      setComposerNotice(t("backendOffline"));
    else setComposerNotice(null);
  }, [agentsQuery, modelsQuery, t]);

  useEffect(() => {
    if (!recoveryRunIds.length) return;
    let disposed = false;
    const refreshRun = async (runId: string) => {
      try {
        const run = await studioApi.getRun(runId);
        const pendingApprovalByRun = new Map<string, string>();
        if (run.status === "WAITING_APPROVAL") {
          const [nodeApprovals, toolApprovals] = await Promise.all([
            studioApi.listNodeToolApprovals().catch(() => []),
            studioApi.listToolApprovals().catch(() => []),
          ]);
          [...nodeApprovals, ...toolApprovals]
            .filter((approval) => approval.runId === run.id && (approval.status === "PENDING" || approval.status === "REQUESTED"))
            .sort((left, right) => String(right.requestedAt ?? right.createdAt ?? "").localeCompare(String(left.requestedAt ?? left.createdAt ?? "")))
            .forEach((approval) => {
              if (approval.runId && !pendingApprovalByRun.has(approval.runId)) {
                pendingApprovalByRun.set(approval.runId, approval.id);
              }
            });
        }
        if (disposed) return;
        updateAssistant(run.id, (message) => {
          const next = messageFromRun(message, run, t);
          const restored = withPendingApproval(next, pendingApprovalByRun);
          return TERMINAL_RUN_STATUSES.has(run.status)
            ? { ...next, steps: (message.steps ?? []).map((step) => step.status === "failed" ? step : { ...step, status: run.status === "FAILED" || run.status === "TIMED_OUT" || run.status === "INTERRUPTED" ? "failed" as const : "complete" as const, duration: step.duration ?? t(run.status === "FAILED" || run.status === "TIMED_OUT" || run.status === "INTERRUPTED" ? "stepFailed" : "stepDone") }), durationMs: elapsedSince(message.createdAt) }
            : restored;
        });
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          finishRun(run.id);
          setComposerNotice(null);
        }
      } catch {
        if (!disposed) setComposerNotice(t("streamDisconnected"));
      }
    };
    const refreshAllRuns = () => recoveryRunIds.forEach((runId) => void refreshRun(runId));
    refreshAllRuns();
    const timer = window.setInterval(refreshAllRuns, 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [finishRun, recoveryRunIds, t, updateAssistant]);
  const availableAgents = agentsQuery.data ?? [];
  const availableModels = modelsQuery.data ?? [];
  const defaultModelProfileId = modelsQuery.data?.find(
    (model) => model.defaultProfile,
  )?.id;
  const currentAgent =
    availableAgents.find((agent) => agent.id === selectedAgentId) ??
    availableAgents[0];
  const backendAvailable =
    agentsQuery.isSuccess &&
    modelsQuery.isSuccess &&
    !agentsQuery.isError &&
    !modelsQuery.isError;
  const backendConnecting =
    !backendAvailable && (agentsQuery.isPending || modelsQuery.isPending);
  const conversationQueueQuery = useQuery({
    queryKey: ["conversation-queue", conversationId],
    queryFn: () => studioApi.getConversationQueue(conversationId ?? ""),
    enabled: Boolean(conversationId) && backendAvailable,
    refetchInterval: conversationId && backendAvailable ? 1_500 : false,
  });
  const queuedActiveRunId = conversationQueueQuery.data?.activeRunId ?? null;
  const activeConversationRunId = queuedActiveRunId && messages.some(
    (message) => message.runId === queuedActiveRunId && message.lifecycle !== "terminal" && message.isStreaming,
  ) ? queuedActiveRunId : null;

  // A cancel request can race with the SSE stream: the terminal RUN_CANCELLED
  // event may arrive before the HTTP cancel response or before the stream
  // reader finishes. Once the message is terminal, clear the local stop
  // bookkeeping so the composer cannot remain stuck on "stopping".
  useEffect(() => {
    const finishedStopIds = stoppingRunIds.filter((runId) =>
      messages.some((message) => message.runId === runId && message.lifecycle === "terminal"),
    );
    finishedStopIds.forEach((runId) => finishRun(runId));
  }, [finishRun, messages, stoppingRunIds]);

  useEffect(() => {
    if (!stoppingRunIds.length || activeConversationRunId) return;
    const hasCancelledMessage = messages.some(
      (message) => message.lifecycle === "terminal" && message.outcome === "cancelled",
    );
    if (!hasCancelledMessage) return;
    stoppingRunIds.forEach((runId) => {
      abortControllersRef.current.delete(runId);
      stopRequestedRunIdsRef.current.delete(runId);
      setRecoveryRunIds((current) => current.filter((item) => item !== runId));
    });
    setManagedRunIds((current) =>
      current.filter((runId) => !stoppingRunIds.includes(runId)),
    );
    setStoppingRunIds([]);
    setComposerNotice((current) => (current === t("stoppingRun") ? null : current));
  }, [activeConversationRunId, messages, stoppingRunIds, t]);

  const conversationAttachmentsQuery = useQuery({
    queryKey: ["conversation-attachments", conversationId],
    queryFn: () => studioApi.listConversationAttachments(conversationId ?? ""),
    enabled: Boolean(conversationId) && backendAvailable,
  });
  const deleteConversationAttachment = useMutation({
    mutationFn: (attachmentId: string) =>
      studioApi.deleteConversationAttachment(conversationId ?? "", attachmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["conversation-attachments", conversationId],
      });
    },
    onError: (error) =>
      setComposerNotice(error instanceof Error ? error.message : t("attachmentReadFailed")),
  });

  useEffect(() => {
    const queue = conversationQueueQuery.data;
    if (!queue) return;
    let disposed = false;
    const entries = [
      ...(queue.activeRunId ? [{ runId: queue.activeRunId, position: 1 }] : []),
      ...queue.pending,
    ];
    void (async () => {
      const [nodeApprovals, toolApprovals] = await Promise.all([
        studioApi.listNodeToolApprovals().catch(() => []),
        studioApi.listToolApprovals().catch(() => []),
      ]);
      if (disposed) return;
      const pendingApprovalByRun = new Map<string, string>();
      [...nodeApprovals, ...toolApprovals]
        .filter((approval) => approval.runId && (approval.status === "PENDING" || approval.status === "REQUESTED"))
        .forEach((approval) => {
          if (approval.runId && !pendingApprovalByRun.has(approval.runId))
            pendingApprovalByRun.set(approval.runId, approval.id);
        });
      const missingRunIds = entries
        .filter((entry) => !useStudioStore.getState().messages.some((message) => message.runId === entry.runId))
        .map((entry) => entry.runId);
      const persistedUsersByRun = new Map<string, StudioMessage>();
      if (missingRunIds.length && conversationId) {
        const conversation = await studioApi.getConversation(conversationId).catch(() => null);
        if (disposed || !conversation) return;
        const missing = new Set(missingRunIds);
        conversation.messages
          .filter((message) => message.role === "USER" && message.runId && missing.has(message.runId))
          .forEach((message) => persistedUsersByRun.set(message.runId!, message as StudioMessage));
      }
      for (const entry of entries) {
        trackRun(entry.runId);
        setRecoveryRunIds((current) => current.includes(entry.runId) ? current : [...current, entry.runId]);
        setMessages((currentMessages) => {
          if (currentMessages.some((message) => message.runId === entry.runId))
            return currentMessages;
          // The launch response has not yet associated this optimistic assistant with
          // the server run. Keep that pair intact instead of creating a duplicate
          // recovered pair that can hide the user's original message.
          if (
            currentMessages.some(
              (message) =>
                message.role === "ASSISTANT" &&
                message.runId?.startsWith("pending-"),
            )
          )
            return currentMessages;
          const persistedUser = persistedUsersByRun.get(entry.runId);
          return [
            ...currentMessages,
            ...(persistedUser ? [persistedUser] : []),
            withPendingApproval({ id: `assistant-recovered-${entry.runId}`, role: "ASSISTANT", content: "", runId: entry.runId, retryInput: runInputRef.current.get(entry.runId) ?? persistedUser?.content, steps: [], isStreaming: true, runState: pendingApprovalByRun.has(entry.runId) ? "waitingApproval" : "queued", lifecycle: "running", outcome: "unknown", delivery: "unavailable", sync: "recovered", createdAt: new Date().toISOString() }, pendingApprovalByRun),
          ];
        });
        updateAssistant(entry.runId, (message) => message.lifecycle === "terminal" ? message : withPendingApproval({ ...message, retryInput: message.retryInput ?? runInputRef.current.get(entry.runId), isStreaming: true, queuePosition: entry.position ?? message.queuePosition, runState: pendingApprovalByRun.has(entry.runId) ? "waitingApproval" : entry.runId === queue.activeRunId ? "running" : "queued", lifecycle: "running", sync: "recovered" }, pendingApprovalByRun));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [conversationId, conversationQueueQuery.data, setMessages, trackRun, updateAssistant]);
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
  const localExecutorNodeId = executionMode === "PERSONAL_LOCAL"
    ? nodesQuery.data?.find(
      (node) =>
        node.kind === "MANAGED_LOCAL" &&
        node.enabled &&
        node.status?.toUpperCase() === "ONLINE",
    )?.id
    : undefined;
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
  const auditQuery = useQuery({
    queryKey: ["run-audit", auditRunId],
    queryFn: () => studioApi.getRunAudit(auditRunId ?? ""),
    enabled: Boolean(auditRunId) && backendAvailable,
    retry: 1,
  });
  const auditWorkflowQuery = useQuery({
    queryKey: ["run-workflow", auditRunId],
    queryFn: () => studioApi.getRunWorkflow(auditRunId ?? ""),
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
    const selectedNode = nodesQuery.data?.find(
      (node) => node.id === capabilityState.nodeId,
    );
    if (
      capabilityState.nodeId &&
      (!exposesNodes ||
        (nodesQuery.isSuccess &&
          (!selectedNode ||
            selectedNode.kind === "MANAGED_LOCAL" ||
            !selectedNode.enabled ||
            selectedNode.status?.toUpperCase() !== "ONLINE")))
    )
      setCapabilityState((current) => ({ ...current, nodeId: undefined }));
  }, [capabilityState.nodeId, exposesNodes, nodesQuery.data, nodesQuery.isSuccess]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isNearConversationBottom) return;
    const frame = requestAnimationFrame(() => {
      stage.scrollTop = stage.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [isNearConversationBottom, messages.length, lastMessage?.content, lastMessage?.isStreaming]);

  const handleConversationScroll = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const distanceFromBottom =
      stage.scrollHeight - stage.scrollTop - stage.clientHeight;
    setIsNearConversationBottom(distanceFromBottom <= 48);
  }, []);

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
    conversationLoadRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setPrompt("");
    setApprovalMode("on-request");
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
  }, [
    clearAttachments,
    setConversationId,
    setMessages,
    setSourceCitationId,
  ]);

  const handleRunEvent = useCallback(
    (runId: string, conversationId: string, event: RunEvent) => {
      updateAssistant(runId, (message) => {
        const steps = [...(message.steps ?? [])];
        const completePrevious = (
          status: "complete" | "failed" | "cancelled" = "complete",
        ) =>
          steps.map((step) =>
            step.status === "running" || step.status === "waiting"
              ? {
                  ...step,
                  status,
                  duration:
                    step.duration ??
                    (status === "failed"
                      ? t("stepFailed")
                      : status === "cancelled"
                        ? t("runCancelled")
                        : t("stepDone")),
                }
              : step,
          );
        if (event.type === "SKILLS_RESOLVED")
          steps.push({
            id: `${runId}-skills-${event.sequence}`,
            kind: "capabilities", label: t("resolveCapabilities"),
            status: "complete",
            duration: t("stepDone"),
          });
        if (event.type === "RUN_QUEUED") {
          const queuePosition = extractQueuePosition(event.payload);
          steps.push({
            id: `${runId}-queue-${event.sequence}`,
            kind: "queue", label: t("queued"),
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
            kind: "coordinator", label: t("startCoordinator"),
            status: "complete",
            duration: t("stepReady"),
          });
        }
        if (event.type === "STEP_STARTED")
          steps.push({
            id: `${runId}-step-${event.sequence}`,
            kind: "execution", label: t("executeEmployee"),
            detail: event.payload,
            status: "running",
          });
        if (event.type === "RETRIEVAL_COMPLETED") {
          const next = completePrevious();
          next.push({
            id: `${runId}-retrieval-${event.sequence}`,
            kind: "retrieval", label: t("retrieveContext"),
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
            kind: "tool-request", label: t("requestTool"),
            detail: event.payload,
            status: "running",
          });
        if (event.type === "TOOL_CALL_STARTED") {
          const active = [...steps]
            .reverse()
            .find(
              (step) =>
                step.status === "running" && step.kind === "tool-request",
            );
          if (active) active.label = t("runTool");
          else
            steps.push({
              id: `${runId}-tool-${event.sequence}`,
              kind: "tool", label: t("runTool"),
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
                (step.kind === "tool-request" || step.kind === "tool"),
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
              kind: "tool", label: t("runTool"),
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
            kind: "warning", label: t("modelRateLimited"),
            detail: event.payload,
            status: "warning",
          });
        if (event.type === "TOOL_BUDGET_WARNING")
          steps.push({
            id: `${runId}-tool-budget-${event.sequence}`,
            kind: "warning", label: t("toolBudgetWarning"),
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
              kind: "approval", label: t("awaitingApproval"),
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
            id: `${runId}-resumed-${event.sequence}`, kind: "resume",
            label: t("runResumed"),
            detail: event.payload,
            status: "running",
          });
          return { ...message, steps, isStreaming: true, runState: "running" };
        }
        if (event.type === "RUN_NEEDS_VERIFICATION") {
          steps.push({
            id: `${runId}-verification-${event.sequence}`, kind: "verification",
            label: t("needsVerification"),
            detail: event.payload,
            status: "warning",
          });
          return {
            ...message,
            steps,
            isStreaming: true,
            runState: "needsVerification",
            error: event.payload || t("needsVerification"),
          };
        }
        if (event.type === "TOKEN_DELTA") {
          const needsVerification = message.runState === "needsVerification";
          const next = steps.length
            ? steps
            : [
                {
                  id: `${runId}-answer`, kind: "answer",
                  label: t("organizeAnswer"),
                  status: "running" as const,
                },
              ];
          if (
            !next.some(
              (step) =>
                step.kind === "answer" && step.status === "running",
            )
          )
            next.push({
              id: `${runId}-answer`, kind: "answer",
              label: t("organizeAnswer"),
              status: "running",
            });
          return {
            ...message,
            content: `${message.content}${event.payload}`,
            steps: next,
            isStreaming: !needsVerification,
            runState: needsVerification ? "needsVerification" : "running",
          };
        }
        if (event.type === "STEP_COMPLETED")
          steps.splice(0, steps.length, ...completePrevious());
        if (event.type === "FINAL_ANSWER") {
          const content = event.payload || message.content;
          const citations = message.citations ?? [];
          const needsVerification = message.runState === "needsVerification";
          persistCitations(conversationId, runId, citations);
          return {
            ...message,
            content,
            citations,
            steps: completePrevious(),
            isStreaming: false,
            runState: needsVerification ? "needsVerification" : "completed",
            lifecycle: "terminal",
            outcome: "succeeded",
            delivery: message.delivery ?? "unavailable",
            sync: "live",
            error: needsVerification ? message.error || t("needsVerification") : undefined,
            durationMs: elapsedSince(message.createdAt),
          };
        }
        if (event.type === "RUN_FAILED")
          return {
            ...message,
            steps: completePrevious("failed"),
            isStreaming: false,
            runState: "failed",
            lifecycle: "terminal",
            outcome: "failed",
            sync: "live",
            error: event.payload || t("runFailed"),
            durationMs: elapsedSince(message.createdAt),
          };
        if (event.type === "RUN_CANCELLED")
          return {
            ...message,
            steps: completePrevious("cancelled"),
            isStreaming: false,
            runState: "cancelled",
            lifecycle: "terminal",
            outcome: "cancelled",
            sync: "live",
            error: t("runCancelled"),
            durationMs: elapsedSince(message.createdAt),
          };
        if (event.type === "RUN_INTERRUPTED")
          return {
            ...message,
            steps: completePrevious("failed"),
            isStreaming: false,
            runState: "interrupted",
            lifecycle: "terminal",
            outcome: "failed",
            sync: "live",
            error: event.payload || t("runFailed"),
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
      if (ensureConversationRef.current) return ensureConversationRef.current;
      // Do not allow an older history restore to replace these optimistic messages.
      conversationLoadRef.current += 1;
      ensureConversationRef.current = studioApi.createConversation(title || t("newTask")).then((result) => {
        // The composer already inserted the optimistic user and assistant messages.
        // Suppress the automatic empty-history restoration for this brand-new conversation.
        restoredConversationRef.current = result.id;
        setConversationId(result.id);
        writeConversationApprovalMode(result.id, approvalMode);
        rememberConversation(result.id, title);
        return result.id;
      }).finally(() => {
        ensureConversationRef.current = null;
      });
      return ensureConversationRef.current;
    },
    [approvalMode, rememberConversation, setConversationId, t],
  );

  const openConversation = useCallback(
    async (id: string, preserveLiveMessages = false) => {
      if (openingConversationId) return;
      const loadId = conversationLoadRef.current + 1;
      conversationLoadRef.current = loadId;
      setOpeningConversationId(id);
      try {
        const conversation = await studioApi.getConversation(id);
        setConversationId(conversation.id);
        setApprovalMode(readConversationApprovalMode(conversation.id));
        let runs: RunView[] = [];
        try {
          runs = await studioApi.listConversationRuns(conversation.id);
        } catch {
          runs = (await Promise.all(conversation.messages.filter((message) => message.runId).map((message) => studioApi.getRun(message.runId!).catch(() => null)))).filter((run): run is RunView => Boolean(run));
        }
        const runById = new Map(runs.map((run) => [run.id, run]));
        const [nodeApprovals, toolApprovals] = await Promise.all([
          studioApi.listNodeToolApprovals().catch(() => []),
          studioApi.listToolApprovals().catch(() => []),
        ]);
        const pendingApprovalByRun = new Map<string, string>();
        [...nodeApprovals, ...toolApprovals]
          .filter((approval) => approval.runId && (approval.status === "PENDING" || approval.status === "REQUESTED"))
          .sort((left, right) => String(right.requestedAt ?? right.createdAt ?? "").localeCompare(String(left.requestedAt ?? left.createdAt ?? "")))
          .forEach((approval) => {
            if (approval.runId && !pendingApprovalByRun.has(approval.runId)) {
              pendingApprovalByRun.set(approval.runId, approval.id);
            }
          });
        const persistedAssistantRunIds = new Set(
          conversation.messages
            .filter((message) => message.role === "ASSISTANT" && message.runId)
            .map((message) => message.runId as string),
        );
        const restoredAssistantRunIds = new Set(persistedAssistantRunIds);
        const restoredMessages: StudioMessage[] = [];
        conversation.messages.forEach((message) => {
          const restored = message.runId ? runById.get(message.runId) : undefined;
          const mapped = { ...message, citations: cachedCitations(conversation.id, message) } as StudioMessage;
          if (message.role === "ASSISTANT") {
            if (message.runId) restoredAssistantRunIds.add(message.runId);
            const restoredMessage = restored
              ? messageFromRun(mapped, restored, t)
              : message.runId
                ? {
                    ...mapped,
                    runState: "unknown" as const,
                    outcome: "unknown" as const,
                    delivery: "unavailable" as const,
                    sync: "lost" as const,
                    error: t("streamDisconnected"),
                  }
                : mapped;
            restoredMessages.push(withPendingApproval(restoredMessage, pendingApprovalByRun));
            return;
          }

          restoredMessages.push(mapped);
          if (!message.runId || persistedAssistantRunIds.has(message.runId)) return;
          const run = runById.get(message.runId);
          if (!run) return;
          const syntheticAssistant: StudioMessage = {
            id: `assistant-${run.id}`,
            role: "ASSISTANT",
            content: "",
            runId: run.id,
            retryInput: message.content,
            steps: [],
            isStreaming: true,
            runState: "running",
            lifecycle: "running",
            outcome: "unknown",
            delivery: "unavailable",
            sync: "reconnecting",
            createdAt: run.createdAt ?? message.createdAt,
          };
          restoredMessages.push(
            withPendingApproval(
              messageFromRun(syntheticAssistant, run, t),
              pendingApprovalByRun,
            ),
          );
          restoredAssistantRunIds.add(run.id);
        });
        // A retry reuses the original conversation input and intentionally does not append
        // another user message. Restore its assistant placeholder from the run record so a
        // refresh cannot leave the active retry invisible while the queue is still running.
        runs.forEach((run) => {
          if (restoredAssistantRunIds.has(run.id)) return;
          const sourceUser = conversation.messages.find(
            (message) => message.role === "USER" && message.runId === run.id,
          );
          const syntheticAssistant: StudioMessage = {
            id: `assistant-${run.id}`,
            role: "ASSISTANT",
            content: "",
            runId: run.id,
            retryInput: sourceUser?.content,
            steps: [],
            isStreaming: !TERMINAL_RUN_STATUSES.has(run.status),
            runState: "running",
            lifecycle: "running",
            outcome: "unknown",
            delivery: "unavailable",
            sync: "recovered",
            createdAt: run.createdAt ?? new Date().toISOString(),
          };
          restoredMessages.push(
            withPendingApproval(
              messageFromRun(syntheticAssistant, run, t),
              pendingApprovalByRun,
            ),
          );
          restoredAssistantRunIds.add(run.id);
        });
        if (conversationLoadRef.current !== loadId) return;
        const hasLiveMessages = useStudioStore
          .getState()
          .messages.some((message) => message.isStreaming && message.lifecycle !== "terminal");
        if (preserveLiveMessages && hasLiveMessages) return;
        setMessages(restoredMessages);
        const activeRuns = runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status));
        activeRuns.forEach((run) => trackRun(run.id));
        setRecoveryRunIds((current) => [
          ...new Set([...current, ...activeRuns.map((run) => run.id)]),
        ]);
        setHistoryOpen(false);
        setSearchOpen(false);
        setComposerNotice(null);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } catch (error) {
        setComposerNotice(
          error instanceof Error ? error.message : t("loadFailed"),
        );
      } finally {
        setOpeningConversationId(null);
      }
    },
    [openingConversationId, setConversationId, setMessages, t, trackRun],
  );

  useEffect(() => {
    const initialConversationId = initialConversationRef.current;
    if (
      !initialConversationId ||
      !backendAvailable ||
      conversationId !== initialConversationId ||
      restoredConversationRef.current === initialConversationId
    ) return;
    initialConversationRef.current = null;
    restoredConversationRef.current = initialConversationId;
    void openConversation(initialConversationId, true);
  }, [backendAvailable, conversationId, openConversation]);

  const reconcileRunLaunch = useCallback(async (clientRequestId: string) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const run = await studioApi.findRunByClientRequestId(clientRequestId);
        if (run) return run;
      } catch {
        // Older servers may not expose this lookup yet. The message remains unknown and non-retryable.
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 750 * (attempt + 1)));
    }
    return null;
  }, []);

  const handleSend = useCallback(
    async (overrideText?: string, retryAttachmentIds?: string[]) => {
      if (isPreflighting) return;
      if (!backendAvailable) {
        setComposerNotice(t("backendOffline"));
        return;
      }
      const rawText = overrideText ?? prompt;
      const text = rawText.trim();
      const localAttachments = retryAttachmentIds ? [] : attachments;
      if ((!text && !localAttachments.length && !retryAttachmentIds?.length))
        return;
      const runInput = text || t("attachmentOnlyPrompt");
      const displayInput =
        text || t("attachmentOnlyPrompt");
      let runNodeId = capabilityState.nodeId ?? localExecutorNodeId;
      if (!runNodeId && executionMode === "PERSONAL_LOCAL") {
        const latestNodes = await nodesQuery.refetch();
        runNodeId = latestNodes.data?.find(
          (node) =>
            node.kind === "MANAGED_LOCAL" &&
            node.enabled &&
            node.status?.toUpperCase() === "ONLINE",
        )?.id;
      }
      const hasSelectedCapabilities = Boolean(
        capabilityState.knowledgeBaseIds.length ||
        capabilityState.skillIds.length ||
        capabilityState.mcpServerIds.length ||
        capabilityState.toolNames.length ||
        runNodeId,
      );
      const hasDefaultSkills = Boolean(currentAgent?.defaultSkillIds?.length);
      if (hasSelectedCapabilities || hasDefaultSkills) {
        setComposerNotice(null);
        setIsPreflighting(true);
        try {
          const preflight = await studioApi.preflightSkill({
            agentId: currentAgent?.id,
            skillIds: capabilityState.skillIds,
            toolNames: capabilityState.toolNames,
            knowledgeBaseIds: capabilityState.knowledgeBaseIds,
            mcpServerIds: capabilityState.mcpServerIds,
            nodeId: runNodeId,
          });
          setSkillPreflight(preflight);
          if (!preflight.ready) {
            setComposerNotice(
              preflight.compatibility.issues[0]?.message ?? t("skillPreflightFailed"),
            );
            return;
          }
        } catch (error) {
          setSkillPreflight(null);
          setComposerNotice(
            isNetworkFailure(error)
              ? t("backendOffline")
              : error instanceof Error
                ? error.message
                : t("skillPreflightFailed"),
          );
          return;
        } finally {
          setIsPreflighting(false);
        }
      } else {
        setSkillPreflight(null);
      }
      setPrompt("");
      setComposerNotice(null);
      const sessionId = runSessionRef.current;
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
      runInputRef.current.set(runId, displayInput);
      const clientRequestId = createUuid();
      const assistantMessage: StudioMessage = {
        id: `assistant-${Date.now()}`,
        role: "ASSISTANT",
        content: "",
        runId,
        retryInput: text,
        steps: [],
        isStreaming: true,
        runState: "queued",
        lifecycle: "queued",
        outcome: "unknown",
        delivery: "unavailable",
        sync: "live",
        createdAt: new Date().toISOString(),
      };
      setMessages((messages) => [...messages, userMessage, assistantMessage]);
      trackRun(runId);
      let serverRunId: string | null = null;
      let shouldRecoverRun = false;
      let failureStage: "prepare" | "upload" | "launch" | "stream" = "prepare";
      try {
        const conversation = await ensureConversation(
          (text || localAttachments[0]?.name || t("newTask")).slice(0, 64),
        );
        conversationInputRef.current.set(conversation, displayInput);
        failureStage = "upload";
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
        if (attachmentIds.length)
          void queryClient.invalidateQueries({
            queryKey: ["conversation-attachments", conversation],
          });
        failureStage = "launch";
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
          ...(runNodeId ? { nodeId: runNodeId } : {}),
          approvalMode,
        };
        const run = await studioApi.createRun({
          conversationId: conversation,
          text: runInput,
          agentId: currentAgent?.id,
          modelProfileId:
            currentAgent?.defaultModelProfileId ?? defaultModelProfileId,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          clientRequestId,
          ...selectedCapabilities,
        }, { idempotencyKey: clientRequestId });
        serverRunId = run.runId;
        if (!retryAttachmentIds?.length)
          clearSentAttachments(localAttachments.map((attachment) => attachment.id));
        if (sessionId !== runSessionRef.current) {
          await studioApi.cancelRun(run.runId).catch(() => undefined);
          finishRun(runId);
          return;
        }
        replaceTrackedRun(runId, run.runId);
        setMessages((currentMessages) => {
          const hasServerUser = currentMessages.some(
            (message) => message.role === "USER" && message.runId === run.runId,
          );
          if (hasServerUser) return currentMessages;
          const hasOptimisticUser = currentMessages.some(
            (message) => message.id === userMessage.id,
          );
          return hasOptimisticUser
            ? currentMessages.map((message) =>
                message.id === userMessage.id ? { ...message, runId: run.runId } : message,
              )
            : [...currentMessages, { ...userMessage, runId: run.runId }];
        });
        updateAssistant(run.runId, (message) => ({
          ...message,
          retryInput: message.retryInput ?? runInputRef.current.get(run.runId),
        }));
        updateAssistant(runId, (message) => ({
          ...message,
          runId: run.runId,
          attachmentIds,
          queuePosition: run.queuePosition,
          runState: "queued",
          lifecycle: "queued",
          sync: "live",
        }));
        const controller = new AbortController();
        abortControllersRef.current.set(run.runId, controller);
        failureStage = "stream";
        await streamRunEvents(
          run.runId,
          (event) => handleRunEvent(run.runId, conversation, event),
          controller.signal,
          { onStatus: (sync) => updateAssistant(run.runId, (message) => ({ ...message, sync })) },
        );
        const persistedRun = await studioApi.getRun(run.runId).catch(() => null);
        if (persistedRun && TERMINAL_RUN_STATUSES.has(persistedRun.status))
          updateAssistant(run.runId, (message) => messageFromRun(message, persistedRun, t));
      } catch (error) {
        if (sessionId !== runSessionRef.current) return;
        if (!overrideText && rawText)
          setPrompt((current) => current || rawText);
        if (!serverRunId && error instanceof RunLaunchTimeoutError) {
          const reconciled = await reconcileRunLaunch(error.clientRequestId);
          if (reconciled) {
            serverRunId = reconciled.id;
            replaceTrackedRun(runId, reconciled.id);
            updateAssistant(runId, (assistant) => messageFromRun({ ...assistant, runId: reconciled.id }, reconciled, t));
            shouldRecoverRun = !TERMINAL_RUN_STATUSES.has(reconciled.status);
            if (shouldRecoverRun)
              setRecoveryRunIds((current) => current.includes(reconciled.id) ? current : [...current, reconciled.id]);
            else finishRun(reconciled.id);
            return;
          }
          updateAssistant(runId, (assistant) => ({ ...assistant, isStreaming: false, runState: "unknown", lifecycle: "terminal", outcome: "unknown", delivery: "unavailable", sync: "lost", error: t("streamDisconnected"), durationMs: elapsedSince(assistant.createdAt) }));
          finishRun(runId);
          return;
        }
        const messageRunId = serverRunId ?? runId;
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (aborted && serverRunId && stopRequestedRunIdsRef.current.has(serverRunId))
          updateAssistant(messageRunId, (assistant) => ({
            ...assistant,
            isStreaming: false,
            runState: "cancelled",
            lifecycle: "terminal",
            outcome: "cancelled",
            error: t("runCancelled"),
            durationMs: elapsedSince(assistant.createdAt),
          }));
        else if (serverRunId) {
          const recoverableRunId = serverRunId;
          shouldRecoverRun = true;
          setRecoveryRunIds((current) =>
            current.includes(recoverableRunId) ? current : [...current, recoverableRunId],
          );
          setComposerNotice(t("streamDisconnected"));
          updateAssistant(messageRunId, (assistant) => ({
            ...assistant,
            isStreaming: true,
            sync: "reconnecting",
            error: undefined,
          }));
        } else {
          updateAssistant(messageRunId, (assistant) => ({
            ...assistant,
            isStreaming: false,
            error: backendAvailable
              ? isNetworkFailure(error)
                ? t("backendOffline")
                : failureStage === "upload"
                  ? t("attachmentUploadFailed")
                  : failureStage === "stream"
                    ? t("streamDisconnected")
                    : t("runStartFailed")
              : t("backendOffline"),
            durationMs: elapsedSince(assistant.createdAt),
          }));
          finishRun(runId);
        }
      } finally {
        if (sessionId === runSessionRef.current) {
          if (serverRunId && !shouldRecoverRun) finishRun(serverRunId);
        }
      }
    },
    [
      attachments,
      approvalMode,
      backendAvailable,
      capabilityState,
      clearSentAttachments,
      currentAgent?.defaultModelProfileId,
      currentAgent?.defaultSkillIds,
      currentAgent?.id,
      defaultModelProfileId,
      ensureConversation,
      executionMode,
      finishRun,
      handleRunEvent,
      isPreflighting,
      localExecutorNodeId,
      nodesQuery,
      prompt,
      queryClient,
      reconcileRunLaunch,
      replaceTrackedRun,
      setMessages,
      t,
      trackRun,
      updateAssistant,
    ],
  );

  const handleCapabilityChange = useCallback((next: CapabilityState) => {
    setCapabilityState(next);
    setSkillPreflight(null);
  }, []);

  const handleApprovalModeChange = useCallback(
    (next: ApprovalMode) => {
      setApprovalMode(next);
      if (conversationId) writeConversationApprovalMode(conversationId, next);
    },
    [conversationId],
  );

  const handleCancelRun = useCallback(async (runId: string) => {
    if (!runId || runId.startsWith("pending-") || stoppingRunIds.includes(runId)) return;
    stopRequestedRunIdsRef.current.add(runId);
    setStoppingRunIds((current) => (current.includes(runId) ? current : [...current, runId]));
    setComposerNotice(t("stoppingRun"));
    try {
      await studioApi.cancelRun(runId);
      abortControllersRef.current.get(runId)?.abort();
    } catch (error) {
      stopRequestedRunIdsRef.current.delete(runId);
      setStoppingRunIds((current) => current.filter((item) => item !== runId));
      setComposerNotice(
        error instanceof Error ? error.message : t("runFailed"),
      );
    }
  }, [stoppingRunIds, t]);

  const handleStop = useCallback(() => {
    if (activeConversationRunId) void handleCancelRun(activeConversationRunId);
  }, [activeConversationRunId, handleCancelRun]);

  const handleDownloadAttachment = useCallback(
    async (attachment: ConversationAttachment) => {
      if (!conversationId) return;
      try {
        const blob = await studioApi.downloadConversationAttachment(conversationId, attachment.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = attachment.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        setComposerNotice(error instanceof Error ? error.message : t("attachmentReadFailed"));
      }
    },
    [conversationId, t],
  );

  const handleDownloadArtifact = useCallback(
    async (artifact: Artifact) => {
      try {
        const blob = await studioApi.downloadArtifact(artifact.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        setComposerNotice(error instanceof Error ? error.message : t("artifactReadFailed"));
      }
    },
    [t],
  );

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
      if (!message.runId || message.runId.startsWith("pending-")) return;
      const sourceRunId = message.runId;
      const provisionalRunId = `pending-retry-${Date.now()}`;
      const sessionId = runSessionRef.current;
      const retryMessage: StudioMessage = {
        id: `assistant-retry-${Date.now()}`,
        role: "ASSISTANT",
        content: "",
        runId: provisionalRunId,
        steps: [],
        isStreaming: true,
        runState: "queued",
        lifecycle: "queued",
        outcome: "unknown",
        delivery: "unavailable",
        sync: "live",
        createdAt: new Date().toISOString(),
      };
      setComposerNotice(message.attachmentIds?.length ? t("retryAttachmentsNotReused") : null);
      setMessages((messages) => [...messages, retryMessage]);
      trackRun(provisionalRunId);
      let serverRunId: string | null = null;
      let shouldRecoverRun = false;
      void (async () => {
        try {
          const run = await studioApi.retryRun(sourceRunId);
          serverRunId = run.runId;
          if (sessionId !== runSessionRef.current) {
            await studioApi.cancelRun(run.runId).catch(() => undefined);
            finishRun(provisionalRunId);
            return;
          }
          replaceTrackedRun(provisionalRunId, run.runId);
          updateAssistant(provisionalRunId, (current) => ({
            ...current,
            runId: run.runId,
            queuePosition: run.queuePosition,
            runState: "queued",
          }));
          const controller = new AbortController();
          abortControllersRef.current.set(run.runId, controller);
          await streamRunEvents(
            run.runId,
            (event) => handleRunEvent(run.runId, conversationId ?? "", event),
            controller.signal,
          );
        } catch (error) {
          if (sessionId !== runSessionRef.current) return;
          const aborted = error instanceof DOMException && error.name === "AbortError";
          if (aborted && serverRunId && stopRequestedRunIdsRef.current.has(serverRunId)) {
            updateAssistant(serverRunId, (current) => ({
              ...current,
              isStreaming: false,
            runState: "cancelled",
            lifecycle: "terminal",
            outcome: "cancelled",
            sync: "live",
              error: t("runCancelled"),
              durationMs: elapsedSince(current.createdAt),
            }));
          } else if (serverRunId) {
            shouldRecoverRun = true;
            setRecoveryRunIds((current) =>
              current.includes(serverRunId!) ? current : [...current, serverRunId!],
            );
            setComposerNotice(t("streamDisconnected"));
          } else {
            updateAssistant(provisionalRunId, (current) => ({
              ...current,
              isStreaming: false,
            runState: "interrupted",
            lifecycle: "terminal",
            outcome: "failed",
            sync: "live",
              error: error instanceof Error ? error.message : t("runStartFailed"),
              durationMs: elapsedSince(current.createdAt),
            }));
            finishRun(provisionalRunId);
          }
        } finally {
          if (sessionId === runSessionRef.current && serverRunId && !shouldRecoverRun)
            finishRun(serverRunId);
        }
      })();
    },
    [conversationId, finishRun, handleRunEvent, replaceTrackedRun, setMessages, t, trackRun, updateAssistant],
  );

  const handleApproval = useCallback(
    async (message: StudioMessage, approved: boolean) => {
      if (!message.runId || !message.approvalId || approvingApprovalId) return;
      setApprovingApprovalId(message.approvalId);
      try {
        const decideApproval = message.approvalId.startsWith("toolapproval_")
          ? studioApi.decideToolApproval
          : studioApi.decideNodeToolApproval;
        await decideApproval(message.approvalId, approved);
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

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        hasOversizedFile = true;
        continue;
      }
      const isImage = file.type.startsWith("image/");
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${createUuid()}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        kind: isImage ? "image" : "file",
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }

    const existing = new Set(
      attachments.map(
        (file) => `${file.name}-${file.size}-${file.type}-${file.kind}`,
      ),
    );
    const additions = accepted.filter((file) => {
      const key = `${file.name}-${file.size}-${file.type}-${file.kind}`;
      if (!existing.has(key)) return true;
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return false;
    });
    const nextAttachments = [...attachments, ...additions];
    if (additions.length) setAttachments(nextAttachments);

    setComposerNotice(
      hasOversizedFile
        ? t("attachTooLarge")
        : nextAttachments.some((attachment) => !isModelReadableAttachment(attachment.file))
          ? t("attachmentModelLimited")
          : null,
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const openConfiguration = (
    tab: string,
    trigger?: HTMLButtonElement,
  ) => {
    if (trigger) configurationTriggerRef.current = trigger;
    setManagerTab(tab);
    setSettingsOpen(true);
  };

  const closeConfiguration = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => configurationTriggerRef.current?.focus());
  };
  const openMobileSidebar = () => setSidebarOpen(true);
  const closeMobileSidebar = (restoreFocus = true) => {
    setSidebarOpen(false);
    if (restoreFocus)
      requestAnimationFrame(() => sidebarTriggerRef.current?.focus());
  };

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="studio-shell">
        <Sidebar
          expanded={sidebarExpanded}
          mobileOpen={sidebarOpen}
          configurationOpen={settingsOpen}
          onExpandedChange={setSidebarExpanded}
          historyEntries={historyEntries}
          currentConversationId={conversationId}
          onNewTask={resetTask}
          onSearch={() => {
            setSearchOpen(true);
          }}
          onHistory={() => {
            setHistoryOpen(true);
          }}
          onOpenConversation={openConversation}
          onManage={(trigger) => {
            openConfiguration("agents", trigger);
          }}
          onSettings={(trigger) => {
            openConfiguration("models", trigger);
          }}
          onCloseMobile={closeMobileSidebar}
          t={t}
        />
        {sidebarOpen ? (
          <button
            className="sidebar-scrim"
            type="button"
            aria-label={t("close")}
            tabIndex={-1}
            onClick={() => closeMobileSidebar()}
          />
        ) : null}
        <main className="studio-main">
          <div
            className="workspace-view"
            aria-hidden={settingsOpen || sidebarOpen}
            inert={settingsOpen || sidebarOpen || undefined}
          >
          <header className="topbar">
            <div className="topbar-leading">
              <IconButton
                label={t("workspace")}
                onClick={openMobileSidebar}
                buttonRef={sidebarTriggerRef}
                ariaExpanded={sidebarOpen}
                ariaControls="workspace-navigation-panel"
              >
                <Menu size={18} />
              </IconButton>
              <div className="conversation-title">
                <span>
                  {conversationId
                    ? (currentHistory?.title ?? t("newTask"))
                    : t("newTask")}
                </span>
              </div>
            </div>
            <div className="topbar-actions">
              <AgentSelect
                agents={availableAgents}
                currentAgent={currentAgent}
                loading={agentsQuery.isPending}
                onChange={setSelectedAgentId}
                t={t}
              />
              <button
                className="manage-button"
                type="button"
                aria-label={t("manage")}
                onClick={(event) =>
                  openConfiguration("agents", event.currentTarget)
                }
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
            onScroll={handleConversationScroll}
          >
            <div className="message-feed">
              {messages.map((message) => {
                return (
                  <Fragment key={message.id}>
                    <MessageBlock
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
                      onCancelRun={handleCancelRun}
                      onApproval={handleApproval}
                      approving={approvingApprovalId === message.approvalId}
                      cancelling={Boolean(message.runId && stoppingRunIds.includes(message.runId))}
                      copied={copiedId === message.id}
                      t={t}
                    />
                  </Fragment>
                );
              })}
              <ConversationAttachmentShelf
                attachments={conversationAttachmentsQuery.data ?? []}
                deleting={deleteConversationAttachment.isPending}
                onDownload={(attachment) => void handleDownloadAttachment(attachment)}
                onDelete={(attachment) => deleteConversationAttachment.mutate(attachment.id)}
                t={t}
              />
            </div>
          </section>
          <span className="visually-hidden" role="status" aria-live="polite">
            {composerNotice ?? (backendConnecting ? t("connecting") : activeConversationRunId ? t("running") : "")}
          </span>
          <Composer
            value={prompt}
            onChange={setPrompt}
            onKeyDown={handleKeyDown}
            onSend={() => void handleSend()}
            onStop={() => void handleStop()}
            running={Boolean(activeConversationRunId)}
            stopping={Boolean(activeConversationRunId && stoppingRunIds.includes(activeConversationRunId))}
            backendAvailable={backendAvailable}
            connecting={backendConnecting}
            reconnecting={reconnecting}
            onReconnect={() => void handleReconnect()}
            textareaRef={textareaRef}
            t={t}
            onAttach={(files) => void handleAttach(files)}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            composerNotice={composerNotice}
            preflighting={isPreflighting}
            skillPreflight={skillPreflight}
            agentToolAllowList={currentAgent?.toolAllowList}
            toolsQuery={toolsQuery}
            knowledgeBasesQuery={knowledgeBasesQuery}
            skillsQuery={skillsQuery}
            mcpQuery={mcpQuery}
            nodesQuery={nodesQuery}
            executionMode={executionMode}
            capabilityState={capabilityState}
            onCapabilityChange={handleCapabilityChange}
            approvalMode={approvalMode}
            onApprovalModeChange={handleApprovalModeChange}
          />
          </div>
          {settingsOpen ? (
            <ConfigurationWorkspace
              tab={managerTab}
              setTab={setManagerTab}
              agents={availableAgents}
              agentsQuery={agentsQuery}
              models={availableModels}
              tools={toolsQuery.data ?? []}
              executionMode={executionMode}
              onClose={closeConfiguration}
              t={t}
            />
          ) : null}
        </main>
        {selectedCitation ? (
          <Suspense fallback={null}>
            <CitationDrawer
              citation={selectedCitation}
              onClose={() => setSourceCitationId(null)}
              t={t}
            />
          </Suspense>
        ) : null}
        {auditRunId ? (
          <Suspense fallback={null}>
            <RunAuditDrawer
              evidence={auditEvidenceQuery.data}
              quality={auditQualityQuery.data}
              audit={auditQuery.data}
              workflow={auditWorkflowQuery.data}
              artifacts={auditQuery.data?.artifacts}
              loading={auditEvidenceQuery.isLoading || auditQualityQuery.isLoading || auditQuery.isLoading || auditWorkflowQuery.isLoading}
              error={auditEvidenceQuery.isError || auditQualityQuery.isError || auditQuery.isError || auditWorkflowQuery.isError}
              onDownload={(artifact) => void handleDownloadArtifact(artifact)}
              onClose={() => setAuditRunId(null)}
              t={t}
            />
          </Suspense>
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
          openingId={openingConversationId}
          onOpenConversation={openConversation}
          language={i18n.language}
          t={t}
        />
      </div>
    </Tooltip.Provider>
  );
}

function Sidebar({
  expanded,
  mobileOpen,
  configurationOpen,
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
  configurationOpen: boolean;
  onExpandedChange: (open: boolean) => void;
  historyEntries: HistoryEntry[];
  currentConversationId: string | null;
  onNewTask: () => void;
  onSearch: () => void;
  onHistory: () => void;
  onOpenConversation: (id: string) => void;
  onManage: (trigger: HTMLButtonElement) => void;
  onSettings: (trigger: HTMLButtonElement) => void;
  onCloseMobile: (restoreFocus?: boolean) => void;
  t: (key: string) => string;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = (restoreFocus = false) => {
    if (mobileOpen) onCloseMobile(restoreFocus);
    else onExpandedChange(false);
  };
  const openTask = () => {
    onNewTask();
    closeNavigation();
  };
  const openSearch = () => {
    closeNavigation();
    onSearch();
  };
  const openHistory = () => {
    closeNavigation();
    onHistory();
  };
  const openManager = (event: React.MouseEvent<HTMLButtonElement>) => {
    closeNavigation();
    onManage(event.currentTarget);
  };
  const openSettings = (event: React.MouseEvent<HTMLButtonElement>) => {
    closeNavigation();
    onSettings(event.currentTarget);
  };
  const recentEntries = historyEntries.slice(0, 5);
  const panelOpen = expanded || mobileOpen;

  useEffect(() => {
    if (!mobileOpen) return;
    mobileCloseRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current
        ?.querySelector(".sidebar-panel")
        ?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!drawerRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  return (
    <aside
      ref={drawerRef}
      className={`sidebar ${expanded ? "is-expanded" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen || undefined}
      aria-label={mobileOpen ? t("workspace") : undefined}
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
          ref={mobileCloseRef}
          className="mobile-close"
          onClick={() => onCloseMobile()}
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
        <RailButton
          label={t("manage")}
          onClick={openManager}
          active={configurationOpen}
        >
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
            <IconButton label={t("close")} onClick={() => closeNavigation(true)}>
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
                        closeNavigation();
                        onOpenConversation(entry.id);
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
  active,
  children,
}: {
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  variant?: "command";
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`rail-button ${variant === "command" ? "is-command" : ""} ${active ? "is-active" : ""}`}
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
  openingId,
  onOpenConversation,
  language,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: HistoryEntry[];
  currentId: string | null;
  openingId: string | null;
  onOpenConversation: (id: string) => void;
  language: string;
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
                    onClick={() => void onOpenConversation(entry.id)}
                    disabled={Boolean(openingId)}
                    aria-busy={openingId === entry.id || undefined}
                  >
                    <span className="history-item-icon">
                      <History size={15} />
                    </span>
                    <span className="history-item-copy">
                      <strong>{entry.title}</strong>
                      <small>
                        {formatHistoryTimestamp(entry.updatedAt, language)}
                      </small>
                    </span>
                    {openingId === entry.id ? (
                      <LoaderCircle size={15} className="spin" aria-label={t("openingConversation")} />
                    ) : entry.id === currentId ? (
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
  loading,
  onChange,
  t,
}: {
  agents: Agent[];
  currentAgent?: Agent;
  loading: boolean;
  onChange: (id: string) => void;
  t: (key: string) => string;
}) {
  const enabledAgents = agents.filter((agent) => agent.enabled);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="agent-trigger"
          type="button"
          aria-label={`${t("digitalEmployee")} ${currentAgent?.name ?? ""}`}
          aria-busy={loading}
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
          {loading ? (
            <DropdownMenu.Item className="menu-item agent-empty" disabled>
              <LoaderCircle size={14} className="spin" />
              {t("loading")}
            </DropdownMenu.Item>
          ) : enabledAgents.length ? (
            enabledAgents.map((agent) => (
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
            ))
          ) : (
            <DropdownMenu.Item className="menu-item agent-empty" disabled>
              {t("noAgents")}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  onCancelRun,
  onApproval,
  approving,
  cancelling,
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
  onCancelRun: (runId: string) => void;
  onApproval: (message: StudioMessage, approved: boolean) => void;
  approving: boolean;
  cancelling: boolean;
  copied: boolean;
  t: (key: string) => string;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
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
  const unknown = message.runState === "unknown";
  const needsVerification = message.runState === "needsVerification";
  const cancelled = message.runState === "cancelled";
  const canCancel = Boolean(
    message.runId &&
      !message.runId.startsWith("pending-") &&
      (message.runState === "queued" || message.runState === "running" || waitingApproval),
  );
  const failed = message.runState === "failed" || message.runState === "timedOut" || message.runState === "interrupted";
  const canRetry = Boolean(
    message.runId &&
      !message.runId.startsWith("pending-") &&
      (failed || cancelled || needsVerification) && !unknown,
  );
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
    !unknown &&
    !failed;
  const executionLabel = queued
    ? message.queuePosition && message.queuePosition > 1
      ? queuePositionLabel(t, message.queuePosition)
      : t("queued")
    : waitingApproval
    ? t("waitingApproval")
    : unknown
      ? t("runStatusUnknown")
    : needsVerification
      ? t("needsVerification")
      : hasRunning
        ? t("running")
        : cancelled
          ? t("runCancelled")
          : failed
          ? t("runFailed")
          : t("completed");
  const executionIconClass = queued
    ? "is-waiting"
    : waitingApproval
    ? "is-waiting"
    : unknown
      ? "is-warning"
    : needsVerification
      ? "is-warning"
      : hasRunning
        ? "is-running"
        : cancelled
          ? "is-warning"
          : failed
          ? "is-failed"
          : "is-complete";
  return (
    <article
      id={`message-${message.id}`}
      className={`message-row assistant-row ${failed ? "has-error" : ""} ${actionsOpen ? "is-actions-open" : ""}`}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch") return;
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input, textarea, select, [role='menuitem']"))
          return;
        setActionsOpen((current) => !current);
      }}
    >
      {steps.length ? (
        <div className={`execution-block ${hasRunning ? "is-active" : ""}`}>
          <button
            className="execution-summary"
            type="button"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
            aria-controls={`${message.id}-execution-steps`}
            aria-live={hasRunning || queued || waitingApproval || needsVerification ? "polite" : "off"}
          >
            <span className={`execution-icon ${executionIconClass}`}>
              {hasRunning ? (
                <LoaderCircle size={15} className="spin" />
              ) : cancelled ? (
                <CircleStop size={15} />
              ) : queued || waitingApproval || needsVerification || unknown || failed ? (
                <CircleAlert size={15} />
              ) : (
                <Check size={15} />
              )}
            </span>
            <span className="execution-summary-copy">
              <strong>{executionLabel}</strong>
              <span>{steps.length} {t("stepCount")}</span>
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
            <div className="step-list" id={`${message.id}-execution-steps`}>
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
        <Suspense fallback={<div className="assistant-content">{message.content}</div>}>
          <AssistantMarkdown content={message.content} />
        </Suspense>
      ) : message.isStreaming && !waitingApproval ? (
        <div className="typing-line">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {needsVerification && message.deliveryGate ? (
        <div className="delivery-gate" role="alert">
          <strong>{t("needsVerification")}</strong>
          {message.deliveryGate.missingEvidence?.length ? (
            <ul>{message.deliveryGate.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : message.deliveryGate.reasons?.length ? (
            <ul>{message.deliveryGate.reasons.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      {message.error ? (
        <div
          className={`run-error ${cancelled ? "is-cancelled" : ""}`}
          role={cancelled ? "status" : "alert"}
        >
          {cancelled ? <CircleStop size={15} /> : <CircleAlert size={15} />} {message.error}
        </div>
      ) : null}
      {message.citations?.length && !message.isStreaming ? (
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
      {message.content || canRetry || canCancel ? (
        <div className="message-actions">
          {message.content ? (
            <IconButton label={copied ? t("copied") : t("copy")} onClick={onCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          ) : null}
          {canRetry ? (
            <IconButton label={t("retry")} onClick={onRetry}>
              <RotateCcw size={14} />
            </IconButton>
          ) : null}
          {message.runId && !message.runId.startsWith("pending-") ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="icon-button" type="button" aria-label={t("more")} title={t("more")}>
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" align="start" sideOffset={6}>
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={onViewAudit}
                  >
                    <ShieldCheck size={14} /> {t("runAudit")}
                  </DropdownMenu.Item>
                  {canCancel && message.runId ? (
                    <DropdownMenu.Item
                      className="menu-item danger"
                      disabled={cancelling}
                      onSelect={() => onCancelRun(message.runId!)}
                    >
                      {cancelling ? <LoaderCircle size={14} className="spin" /> : <CircleStop size={14} />}
                      {t("stop")}
                    </DropdownMenu.Item>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StepRow({ step, t }: { step: RunStep; t: (key: string) => string }) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <span className={`step-status ${step.status}`}>
        {step.status === "running" ? (
          <LoaderCircle size={13} className="spin" />
        ) : step.status === "failed" ? (
          <X size={13} />
        ) : step.status === "cancelled" ? (
          <CircleStop size={13} />
        ) : step.status === "waiting" || step.status === "warning" ? (
          <CircleAlert size={13} />
        ) : (
          <Check size={13} />
        )}
      </span>
      <span className="step-label">{step.label}</span>
      {step.detail ? <span className="step-detail">{step.detail}</span> : null}
      <span className="step-duration">
        {step.duration ?? (step.status === "running" ? "…" : "")}
      </span>
      {step.detail ? (
        <ChevronRight
          size={12}
          className={`step-chevron ${open ? "is-open" : ""}`}
        />
      ) : null}
    </>
  );
  return (
    <div className={`step-row-wrap ${step.status}`}>
      {step.detail ? (
        <button
          className="step-row"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={`${step.id}-detail`}
        >
          {content}
        </button>
      ) : (
        <div className="step-row">{content}</div>
      )}
      {open && step.detail ? (
        <div className="step-detail-expanded" id={`${step.id}-detail`}>
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
  connecting,
  reconnecting,
  onReconnect,
  textareaRef,
  t,
  onAttach,
  attachments,
  onRemoveAttachment,
  composerNotice,
  preflighting,
  skillPreflight,
  agentToolAllowList,
  toolsQuery,
  knowledgeBasesQuery,
  skillsQuery,
  mcpQuery,
  nodesQuery,
  executionMode,
  capabilityState,
  onCapabilityChange,
  approvalMode,
  onApprovalModeChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  stopping: boolean;
  backendAvailable: boolean;
  connecting: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  t: (key: string) => string;
  onAttach: (files: File[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  composerNotice: string | null;
  preflighting: boolean;
  skillPreflight: SkillPreflight | null;
  agentToolAllowList?: string[];
  toolsQuery: { data?: Tool[] };
  knowledgeBasesQuery: { data?: KnowledgeBase[] };
  skillsQuery: { data?: Skill[] };
  mcpQuery: { data?: McpConnection[] };
  nodesQuery: { data?: NodeConnection[] };
  executionMode: ExecutionMode;
  capabilityState: CapabilityState;
  onCapabilityChange: (state: CapabilityState) => void;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [textareaRef, value]);

  const totalCapabilities =
    capabilityState.knowledgeBaseIds.length +
    capabilityState.skillIds.length +
    capabilityState.mcpServerIds.length +
    capabilityState.toolNames.length +
    (executionMode !== "PERSONAL_LOCAL" && capabilityState.nodeId ? 1 : 0);
  const builtInTools = (toolsQuery.data ?? []).filter(
    (tool) => !isExternalToolName(tool.name),
  );
  const selectedCapabilityChips = [
    ...(knowledgeBasesQuery.data ?? [])
      .filter((base) => capabilityState.knowledgeBaseIds.includes(base.id))
      .map((base) => ({ id: base.id, label: base.name, kind: t("knowledge"), key: "knowledgeBaseIds" as const })),
    ...builtInTools
      .filter((tool) => capabilityState.toolNames.includes(tool.name))
      .map((tool) => ({ id: tool.name, label: tool.name, kind: t("builtInTools"), key: "toolNames" as const })),
    ...(skillsQuery.data ?? [])
      .filter((skill) => capabilityState.skillIds.includes(skill.id))
      .map((skill) => ({ id: skill.id, label: skill.name, kind: t("skills"), key: "skillIds" as const })),
    ...(mcpQuery.data ?? [])
      .filter((connection) => capabilityState.mcpServerIds.includes(connection.id))
      .map((connection) => ({ id: connection.id, label: connection.name, kind: t("mcp"), key: "mcpServerIds" as const })),
    ...(executionMode !== "PERSONAL_LOCAL"
      ? (nodesQuery.data ?? [])
          .filter((node) => node.id === capabilityState.nodeId)
          .map((node) => ({ id: node.id, label: node.name, kind: t("nodes"), key: "nodeId" as const }))
      : []),
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
        <input
          ref={fileRef}
          type="file"
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yml,.yaml,.log,text/*,image/*,application/pdf,application/msword,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={(event) => {
            onAttach(Array.from(event.target.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        {selectedCapabilityChips.length ? (
          <div className="selected-capability-row" aria-label={t("capabilityTitle")}>
            {selectedCapabilityChips.map((chip) => (
              <span className="selected-capability-chip" key={`${chip.key}-${chip.id}`}>
                <Zap size={12} />
                <span className="selected-capability-kind">{chip.kind}</span>
                <span>{chip.label}</span>
                {chip.key !== "nodeId" || executionMode !== "NODES_ONLY" ? (
                  <button
                    type="button"
                    aria-label={`${t("removeCapability")} ${chip.label}`}
                    title={t("removeCapability")}
                    onClick={() => removeCapability(chip)}
                  >
                    <X size={12} />
                  </button>
                ) : null}
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
        {approvalMode === "full-access" ? (
          <div className="selected-capability-row" aria-label={t("approvalMode")}>
            <span className="selected-capability-chip">
              <ShieldCheck size={12} />
              <span className="selected-capability-kind">{t("approvalMode")}</span>
              <span>{t("fullAccess")}</span>
              <button
                type="button"
                aria-label={t("restoreApproval")}
                title={t("restoreApproval")}
                onClick={() => onApprovalModeChange("on-request")}
              >
                <X size={12} />
              </button>
            </span>
          </div>
        ) : null}
        <div className="composer-input-row">
          <IconButton
            label={t("attach")}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={17} />
          </IconButton>
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
          <CapabilityMenu
            tools={builtInTools.filter((tool) =>
              agentToolAllowList ? agentToolAllowList.includes(tool.name) : true,
            )}
            knowledgeBases={knowledgeBasesQuery.data ?? []}
            skills={skillsQuery.data ?? []}
            mcpConnections={mcpQuery.data ?? []}
            nodes={
              executionMode !== "PERSONAL_LOCAL"
                ? (nodesQuery.data ?? []).filter(
                    (node) =>
                      node.kind !== "MANAGED_LOCAL" &&
                      node.enabled &&
                      node.status?.toUpperCase() === "ONLINE",
                  )
                : []
            }
            executionMode={executionMode}
            state={capabilityState}
            onChange={onCapabilityChange}
            t={t}
            count={totalCapabilities}
            skillPreflight={skillPreflight}
            approvalMode={approvalMode}
            onApprovalModeChange={onApprovalModeChange}
          />
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
                preflighting || !backendAvailable || (!value.trim() && !attachments.length)
              }
              aria-label={preflighting ? t("preflightingSkills") : t("send")}
            >
              {preflighting ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} />}
            </button>
          )}
        </div>
        {!backendAvailable || connecting ? (
          <div className="composer-status">
            {connecting ? <LoaderCircle size={12} className="spin" /> : <span className="context-dot" data-online={backendAvailable} />}
            <span>{connecting ? t("connecting") : t("offline")}</span>
            {!backendAvailable && !connecting ? (
              <button
                type="button"
                className="connection-retry"
                onClick={onReconnect}
                disabled={reconnecting}
              >
                {reconnecting ? <LoaderCircle size={12} className="spin" /> : null}
                {reconnecting ? t("reconnecting") : t("reconnect")}
              </button>
            ) : null}
          </div>
        ) : null}
        {composerNotice ? (
          <div className="composer-notice" role="status" aria-live="polite">
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
  executionMode,
  state,
  onChange,
  t,
  count,
  skillPreflight,
  approvalMode,
  onApprovalModeChange,
}: {
  tools: Tool[];
  knowledgeBases: KnowledgeBase[];
  skills: Skill[];
  mcpConnections: McpConnection[];
  nodes: NodeConnection[];
  executionMode: ExecutionMode;
  state: CapabilityState;
  onChange: (state: CapabilityState) => void;
  t: (key: string) => string;
  count: number;
  skillPreflight: SkillPreflight | null;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false);
  const toggle = (key: CapabilityArrayKey, id: string, checked: boolean) =>
    onChange({
      ...state,
      [key]: checked
        ? [...state[key], id]
        : state[key].filter((item) => item !== id),
    });
  const clearSelection = () =>
    onChange({
      knowledgeBaseIds: [],
      skillIds: [],
      mcpServerIds: [],
      toolNames: [],
      nodeId: executionMode === "NODES_ONLY" ? state.nodeId : undefined,
    });
  const matches = (label: string, detail: string) =>
    !query.trim() ||
    `${label} ${detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const availableCapabilityCount =
    knowledgeBases.length +
    tools.length +
    skills.filter((skill) => skill.enabled).length +
    mcpConnections.filter((connection) => connection.enabled).length +
    nodes.length;
  return (
    <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="capability-button"
          aria-label={t("chooseCapability")}
        >
          <Zap size={14} />
          <span className="capability-button-label">{t("chooseCapability")}</span>
          {count ? <span className="capability-count">{count}</span> : null}
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu capability-menu"
          align="start"
          sideOffset={8}
        >
          <div className="capability-menu-header">
            <DropdownMenu.Label className="menu-label">
              {t("capabilityTitle")}
            </DropdownMenu.Label>
            {count ? (
              <button type="button" className="capability-clear" onClick={clearSelection}>
                {t("clearSelection")}
              </button>
            ) : null}
          </div>
          <p className="capability-hint">{t("capabilityHint")}</p>
          <div className="capability-group">
            <div className="capability-group-title">{t("approvalMode")}</div>
            <DropdownMenu.RadioGroup
              value={approvalMode}
              onValueChange={(value) => {
                if (value === "full-access" && approvalMode !== "full-access") {
                  setConfirmingFullAccess(true);
                  return;
                }
                onApprovalModeChange(value as ApprovalMode);
              }}
            >
              <DropdownMenu.RadioItem value="on-request" className="capability-item">
                <DropdownMenu.ItemIndicator className="item-indicator">
                  <Check size={13} />
                </DropdownMenu.ItemIndicator>
                <span>
                  <strong>{t("approvalOnRequest")}</strong>
                  <small>{t("approvalOnRequestHint")}</small>
                </span>
              </DropdownMenu.RadioItem>
              <DropdownMenu.RadioItem value="full-access" className="capability-item">
                <DropdownMenu.ItemIndicator className="item-indicator">
                  <Check size={13} />
                </DropdownMenu.ItemIndicator>
                <span>
                  <strong>{t("fullAccess")}</strong>
                  <small>{t("fullAccessHint")}</small>
                </span>
              </DropdownMenu.RadioItem>
            </DropdownMenu.RadioGroup>
          </div>
          {skillPreflight && !skillPreflight.ready ? (
            <div className="capability-preflight" role="status">
              <CircleAlert size={13} />
              <div>
                <strong>{t("skillPreflightIssues")}</strong>
                {skillPreflight.compatibility.issues.map((issue) => (
                  <span key={`${issue.skillId}-${issue.code}`}>{issue.message}</span>
                ))}
              </div>
            </div>
          ) : null}
          {availableCapabilityCount > 6 ? (
            <label className="capability-search">
              <Search size={14} />
              <span className="visually-hidden">{t("searchCapabilities")}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder={t("searchCapabilities")}
              />
            </label>
          ) : null}
          {knowledgeBases.filter((base) => matches(base.name, base.description ?? "")).length ? (
            <CapabilityGroup
              title={t("knowledge")}
              items={knowledgeBases.filter((base) => matches(base.name, base.description ?? "")).map((base) => ({
                id: base.id,
                label: base.name,
                detail: base.description ?? "",
                key: "knowledgeBaseIds" as const,
                checked: state.knowledgeBaseIds.includes(base.id),
              }))}
              onToggle={toggle}
            />
          ) : null}
          {tools.filter((tool) => matches(tool.name, tool.description)).length ? (
            <CapabilityGroup
              title={t("builtInTools")}
              items={tools.filter((tool) => matches(tool.name, tool.description)).map((tool) => ({
                id: tool.name,
                label: tool.name,
                detail: tool.description,
                key: "toolNames" as const,
                checked: state.toolNames.includes(tool.name),
              }))}
              onToggle={toggle}
            />
          ) : null}
          {skills.filter((skill) => skill.enabled && matches(skill.name, skill.description)).length ? (
            <CapabilityGroup
              title={t("installedSkills")}
              items={skills
                .filter((skill) => skill.enabled && matches(skill.name, skill.description))
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
          {mcpConnections.filter((connection) => connection.enabled && matches(connection.name, connection.description ?? connection.status ?? "")).length ? (
            <CapabilityGroup
              title={t("mcpConnections")}
              items={mcpConnections
                .filter((connection) => connection.enabled && matches(connection.name, connection.description ?? connection.status ?? ""))
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
          {executionMode !== "PERSONAL_LOCAL" ? (
            <div className="capability-group">
              <div className="capability-group-title">
                {t("executionTarget")}
              </div>
              <DropdownMenu.RadioGroup
                value={state.nodeId ?? ""}
                onValueChange={(value) =>
                  onChange({ ...state, nodeId: value || undefined })
                }
              >
                {executionMode === "LOCAL_AND_NODES" ? (
                  <DropdownMenu.RadioItem value="" className="capability-item">
                    <DropdownMenu.ItemIndicator className="item-indicator">
                      <Check size={13} />
                    </DropdownMenu.ItemIndicator>
                    <span>
                      <strong>{t("thisComputer")}</strong>
                      <small>{t("thisComputerHint")}</small>
                    </span>
                  </DropdownMenu.RadioItem>
                ) : null}
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
              {!nodes.length ? (
                <p className="capability-hint">{t("noConnectedNodes")}</p>
              ) : null}
            </div>
          ) : null}
          {!tools.length &&
          !knowledgeBases.length &&
          !skills.length &&
          !mcpConnections.length &&
          executionMode === "PERSONAL_LOCAL" &&
          !nodes.length ? (
            <div className="capability-empty">
              <Wrench size={15} />
              {t("noCapabilities")}
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <Dialog.Root open={confirmingFullAccess} onOpenChange={setConfirmingFullAccess}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="utility-dialog approval-mode-dialog">
          <div className="dialog-header">
            <div>
              <Dialog.Title>{t("confirmFullAccess")}</Dialog.Title>
              <Dialog.Description>{t("confirmFullAccessHint")}</Dialog.Description>
            </div>
          </div>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="secondary-button">
                {t("cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                onApprovalModeChange("full-access");
                setConfirmingFullAccess(false);
              }}
            >
              <ShieldCheck size={14} />
              {t("enableFullAccess")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
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

function ConfigurationWorkspace({
  tab,
  setTab,
  agents,
  agentsQuery,
  models,
  tools,
  executionMode,
  onClose,
  t,
}: {
  tab: string;
  setTab: (tab: string) => void;
  agents: Agent[];
  agentsQuery: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  models: ModelProfile[];
  tools: Tool[];
  executionMode: ExecutionMode;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [compactNavigation, setCompactNavigation] = useState(
    () => window.matchMedia("(max-width: 1199px)").matches,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: studioApi.listSkills,
    enabled: tab === "skills" || tab === "agents",
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: studioApi.listMcpConnections,
    enabled: tab === "mcp",
  });
  const knowledgeQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: studioApi.listKnowledgeBases,
    enabled: tab === "knowledge",
  });
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: studioApi.listNodes,
    enabled: tab === "nodes",
    refetchInterval: tab === "nodes" ? 5_000 : false,
  });
  const approvalsQuery = useQuery({
    queryKey: ["node-tool-approvals"],
    queryFn: studioApi.listNodeToolApprovals,
    enabled: tab === "nodes",
    refetchInterval: tab === "nodes" ? 5_000 : false,
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
    onError: () =>
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
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <section className="configuration-workspace" aria-labelledby="configuration-title">
          <header className="configuration-header">
            <button
              className="configuration-back"
              type="button"
              aria-label={t("workspace")}
              title={t("workspace")}
              onClick={onClose}
            >
              <ArrowLeft size={17} />
              {t("workspace")}
            </button>
            <div className="configuration-heading">
              <h1 id="configuration-title" ref={headingRef} tabIndex={-1}>
                {t("configuration")}
              </h1>
              <p>{t("manageHint")}</p>
            </div>
            <IconButton label={t("close")} onClick={onClose}>
              <X size={18} />
            </IconButton>
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
                    tools={tools}
                    executionMode={executionMode}
                    skills={skillsQuery.data}
                    mcpConnections={mcpQuery.data}
                    knowledgeBases={knowledgeQuery.data}
                    nodes={nodesQuery.data}
                    queries={{
                      agents: agentsQuery,
                      skills: skillsQuery,
                      mcp: mcpQuery,
                      knowledge: knowledgeQuery,
                      nodes: nodesQuery,
                      approvals: approvalsQuery,
                    }}
                    onSkillToggle={(item) => toggleSkill.mutate(item)}
                    onMcpToggle={(item) => toggleMcp.mutate(item)}
                    onMcpRefresh={(id) => refreshMcp.mutate(id)}
                    mcpRefreshing={refreshMcp.isPending}
                    mcpRefreshingId={refreshMcp.variables}
                    mcpRefreshError={refreshMcp.error}
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
    </section>
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
  tools,
  executionMode,
  skills,
  mcpConnections,
  knowledgeBases,
  nodes,
  queries,
  onSkillToggle,
  onMcpToggle,
  onMcpRefresh,
  mcpRefreshing,
  mcpRefreshingId,
  mcpRefreshError,
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
  tools: Tool[];
  executionMode: ExecutionMode;
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
  mcpRefreshing: boolean;
  mcpRefreshingId?: string;
  mcpRefreshError: unknown;
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
  if (id === "agents")
    return (
      <AgentManager agents={agents} models={models} skills={skills ?? []} tools={tools} query={queries.agents} t={t} />
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
        refreshing={mcpRefreshing}
        refreshingId={mcpRefreshingId}
        refreshError={mcpRefreshError}
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
    <Suspense
      fallback={
        <div className="manager-placeholder">
          <LoaderCircle size={18} className="spin" />
          <span>{t("loading")}</span>
        </div>
      }
    >
      <NodeManager
        nodes={nodes ?? []}
        nodesQuery={queries.nodes}
        approvalsQuery={queries.approvals}
        managedLocalExecutorAvailable={executionMode !== "NODES_ONLY"}
        t={t}
      />
    </Suspense>
  );
}

function isExternalToolName(name: string) {
  return name.startsWith("mcp:") || name.startsWith("mcp_") || name.startsWith("node:") || name.startsWith("node_");
}

type ModelFormValues = {
  id: string;
  providerType: "OPENAI_COMPATIBLE" | "OLLAMA";
  baseUrl: string;
  modelName: string;
  credentialRef: string;
  apiKey: string;
  capabilities: ModelCapability[];
  enabled: boolean;
};

const modelFormSchema = z.object({
  id: z.string().trim().min(1),
  providerType: z.enum(["OPENAI_COMPATIBLE", "OLLAMA"]),
  baseUrl: z.string().trim().url(),
  modelName: z.string().trim().min(1),
  credentialRef: z.string().trim().optional(),
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
  const [savedModelId, setSavedModelId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelProfile | null>(null);
  const presetsQuery = useQuery({
    queryKey: ["model-presets"],
    queryFn: studioApi.listModelPresets,
    enabled: section === "presets",
  });
  const form = useForm<ModelFormValues>({ defaultValues: emptyModelForm });
  const saveMutation = useMutation({
    mutationFn: studioApi.saveModel,
    onSuccess: (model) => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditorOpen(false);
      setNotice(t("modelSaved"));
      setSavedModelId(model.id);
      setTestResult(null);
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
    onError: (failure) =>
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t("modelTestFailed"),
      ),
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
    setSavedModelId(null);
    setTestResult(null);
    setError("");
  };
  const submit = form.handleSubmit((values) => {
    const parsed = modelFormSchema.safeParse(values);
    if (!parsed.success) {
      setError(t("loadFailed"));
      return;
    }
    const { apiKey, ...model } = parsed.data;
    saveMutation.mutate({
      ...model,
      ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
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
          {savedModelId ? (
            <button
              type="button"
              className="text-button model-save-notice-action"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate(savedModelId)}
            >
              {testMutation.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <PlugZap size={14} />
              )}
              {t("testModel")}
            </button>
          ) : null}
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
                {t("apiKey")}
                <input
                  {...form.register("apiKey")}
                  type="password"
                  autoComplete="new-password"
                  placeholder="sk-..."
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

const knowledgeSettingsSchema = z
  .object({
    embeddingEnabled: z.boolean(),
    embeddingModel: z.string().trim(),
    embeddingBaseUrl: z.string().trim(),
    embeddingCredentialEnv: z.string().trim(),
    apiKey: z.string(),
    vectorStore: z.string().trim(),
    chunkSize: z.coerce.number().int().min(1).max(16_384),
    chunkOverlap: z.coerce.number().int().min(0).max(8_192),
  })
  .superRefine((values, context) => {
    if (!values.embeddingEnabled) return;
    if (!values.embeddingModel) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["embeddingModel"] });
    }
    if (!/^https?:\/\//i.test(values.embeddingBaseUrl)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["embeddingBaseUrl"] });
    }
    if (!values.vectorStore) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["vectorStore"] });
    }
    if (values.chunkOverlap >= values.chunkSize) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["chunkOverlap"] });
    }
  });

type KnowledgeSettingsForm = z.infer<typeof knowledgeSettingsSchema>;

const defaultKnowledgeSettingsForm: KnowledgeSettingsForm = {
  embeddingEnabled: true,
  embeddingModel: "",
  embeddingBaseUrl: "",
  embeddingCredentialEnv: "",
  apiKey: "",
  vectorStore: "local",
  chunkSize: 800,
  chunkOverlap: 120,
};

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [expandedDocumentId, setExpandedDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsForm = useForm<KnowledgeSettingsForm>({
    defaultValues: defaultKnowledgeSettingsForm,
  });
  const settingsQuery = useQuery({
    queryKey: ["knowledge-settings"],
    queryFn: studioApi.getKnowledgeSettings,
    staleTime: 60_000,
  });
  const updateSettings = useMutation({
    mutationFn: (values: KnowledgeSettingsForm) => {
      const payload: KnowledgeSettingsUpdate = {
        embeddingEnabled: values.embeddingEnabled,
        embeddingModel: values.embeddingModel.trim(),
        embeddingBaseUrl: values.embeddingBaseUrl.trim(),
        embeddingCredentialEnv: values.embeddingCredentialEnv.trim() || undefined,
        apiKey: values.apiKey.trim() || undefined,
        vectorStore: values.vectorStore.trim(),
        chunkSize: values.chunkSize,
        chunkOverlap: values.chunkOverlap,
      };
      return studioApi.updateKnowledgeSettings(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-settings"] });
      setSettingsEditing(false);
      setNotice(t("completed"));
      setError("");
    },
    onError: (failure) => {
      setError(failure instanceof Error && failure.message ? failure.message : t("knowledgeActionFailed"));
    },
  });
  const selectedBaseFromList = bases.find((base) => base.id === selectedId);
  const detailQuery = useQuery({
    queryKey: ["knowledge-base", selectedId],
    queryFn: () => studioApi.getKnowledgeBase(selectedId!),
    enabled: Boolean(selectedId),
  });
  const selectedBase = detailQuery.data?.summary ?? selectedBaseFromList;
  const statsQuery = useQuery({
    queryKey: ["knowledge-stats", selectedId],
    queryFn: () => studioApi.getKnowledgeStats(selectedId!),
    enabled: Boolean(selectedId),
  });
  const chunksQuery = useQuery({
    queryKey: ["knowledge-chunks", selectedId, expandedDocumentId],
    queryFn: () => studioApi.listKnowledgeChunks(selectedId!, expandedDocumentId!),
    enabled: Boolean(selectedId && expandedDocumentId),
  });
  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      studioApi.searchKnowledge({
        knowledgeBaseIds: [selectedId!],
        query,
        limit: 8,
      }),
    onSuccess: () => setError(""),
    onError: (failure) =>
      setError(failure instanceof Error && failure.message ? failure.message : t("knowledgeSearchFailed")),
  });
  const refresh = async () => {
    await queryClient.refetchQueries({ queryKey: ["knowledge-bases"] });
    if (selectedId) {
      await queryClient.refetchQueries({
        queryKey: ["knowledge-base", selectedId],
      });
      await queryClient.refetchQueries({ queryKey: ["knowledge-stats", selectedId] });
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
    setSearchOpen(false);
    setSearchText("");
    setExpandedDocumentId(null);
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
    setSearchOpen(false);
    setSearchText("");
    setExpandedDocumentId(null);
  };
  const handleFiles = (files: File[]) => {
    if (files.length && selectedId) uploadFile.mutate(files);
  };
  const documents = detailQuery.data?.documents ?? [];
  const selectedStats = statsQuery.data ?? {
    knowledgeBaseId: selectedBase?.id ?? "",
    documentCount: selectedBase?.documentCount ?? 0,
    chunkCount: selectedBase?.chunkCount ?? 0,
  };
  const openSettingsEditor = () => {
    const settings = settingsQuery.data;
    settingsForm.reset({
      embeddingEnabled: settings?.embeddingEnabled ?? true,
      embeddingModel: settings?.embeddingModel ?? "",
      embeddingBaseUrl: settings?.embeddingBaseUrl ?? "",
      embeddingCredentialEnv: settings?.embeddingCredentialEnv ?? "",
      apiKey: "",
      vectorStore: settings?.vectorStore ?? defaultKnowledgeSettingsForm.vectorStore,
      chunkSize: settings?.chunkSize ?? defaultKnowledgeSettingsForm.chunkSize,
      chunkOverlap: settings?.chunkOverlap ?? defaultKnowledgeSettingsForm.chunkOverlap,
    });
    setSettingsEditing(true);
    setError("");
  };
  const settingsSubmit = settingsForm.handleSubmit((values) => {
    const parsed = knowledgeSettingsSchema.safeParse(values);
    if (!parsed.success) {
      setError(t("knowledgeActionFailed"));
      return;
    }
    updateSettings.mutate(parsed.data);
  });

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
              className={
                searchOpen ? "secondary-button is-active" : "secondary-button"
              }
              disabled={busy}
              onClick={() => {
                setSearchOpen((current) => !current);
                setError("");
              }}
            >
              <Search size={14} />
              {t("testRetrieval")}
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
        <KnowledgeRuntimeSummary
          settings={settingsQuery.data}
          settingsLoading={settingsQuery.isLoading}
          settingsError={settingsQuery.isError}
          stats={selectedStats}
          statsLoading={statsQuery.isLoading}
          onConfigure={openSettingsEditor}
          t={t}
        />
        {settingsEditing ? (
          <KnowledgeSettingsEditor
            form={settingsForm}
            saving={updateSettings.isPending}
            onCancel={() => setSettingsEditing(false)}
            onSubmit={settingsSubmit}
            t={t}
          />
        ) : null}
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
        {searchOpen ? (
          <form
            className="inline-form knowledge-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (searchText.trim()) searchMutation.mutate(searchText.trim());
            }}
          >
            <label>
              {t("retrievalQuery")}
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t("retrievalQueryPlaceholder")}
                autoFocus
              />
            </label>
            <div className="inline-form-actions">
              <span className="form-note">{t("retrievalQueryHint")}</span>
              <button
                type="submit"
                className="primary-button"
                disabled={!searchText.trim() || searchMutation.isPending}
              >
                {searchMutation.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Search size={14} />
                )}
                {t("search")}
              </button>
            </div>
            {searchMutation.data?.length ? (
              <div className="knowledge-search-results">
                {searchMutation.data.map((result) => (
                  <KnowledgeSearchResultRow
                    key={`${result.documentId}-${result.chunkIndex}`}
                    result={result}
                    t={t}
                  />
                ))}
              </div>
            ) : searchMutation.isSuccess ? (
              <div className="manager-placeholder compact">{t("noKnowledgeSearchResults")}</div>
            ) : null}
          </form>
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
                : `${selectedStats.documentCount} ${t("documentCount")} · ${selectedStats.chunkCount} ${t("chunkCount")}`}
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
                chunksOpen={expandedDocumentId === document.id}
                chunks={expandedDocumentId === document.id ? chunksQuery.data ?? [] : []}
                chunksLoading={expandedDocumentId === document.id && chunksQuery.isLoading}
                chunksError={expandedDocumentId === document.id && chunksQuery.isError}
                onToggleChunks={() =>
                  setExpandedDocumentId((current) =>
                    current === document.id ? null : document.id,
                  )
                }
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
    <div className="knowledge-list-view">
      <KnowledgeRuntimeSummary
        settings={settingsQuery.data}
        settingsLoading={settingsQuery.isLoading}
        settingsError={settingsQuery.isError}
        onConfigure={openSettingsEditor}
        t={t}
      />
      {settingsEditing ? (
        <KnowledgeSettingsEditor
          form={settingsForm}
          saving={updateSettings.isPending}
          onCancel={() => setSettingsEditing(false)}
          onSubmit={settingsSubmit}
          t={t}
        />
      ) : null}
      <QueryResourceState query={query} t={t}>
      {bases.map((base) => (
        <ResourceRow
          key={base.id}
          icon={<Database size={15} />}
          title={base.name}
          detail={base.description || t("noDescription")}
          status={`${base.documentCount} ${t("documentCount")} · ${base.chunkCount} ${t("chunkCount")}`}
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
    </div>
  );
}

function KnowledgeRuntimeSummary({
  settings,
  settingsLoading,
  settingsError,
  stats,
  statsLoading,
  onConfigure,
  t,
}: {
  settings?: KnowledgeSettings;
  settingsLoading: boolean;
  settingsError: boolean;
  stats?: { documentCount: number; chunkCount: number };
  statsLoading?: boolean;
  onConfigure?: () => void;
  t: (key: string) => string;
}) {
  const embeddingReady = settings?.embeddingEnabled === true && settings.embeddingCredentialConfigured === true;
  return (
    <section className="knowledge-runtime-summary" aria-label={t("knowledgeRuntime") }>
      <div className="knowledge-runtime-heading">
        <div>
          <strong>{t("knowledgeRuntime")}</strong>
          <span>{t("knowledgeRuntimeHint")}</span>
        </div>
        <div className="knowledge-runtime-actions">
          <span className={`knowledge-runtime-status ${embeddingReady ? "ready" : "warning"}`}>
            {settingsLoading ? t("loading") : settingsError ? t("loadFailed") : embeddingReady ? t("embeddingReady") : t("embeddingNotConfigured")}
          </span>
          {onConfigure ? (
            <button type="button" className="text-button" onClick={onConfigure} disabled={settingsLoading}>
              <Pencil size={14} />
              {t("configureEmbedding")}
            </button>
          ) : null}
        </div>
      </div>
      {settings ? (
        <div className="knowledge-runtime-grid">
          <div><span>{t("embeddingModel")}</span><strong>{settings.embeddingModel || "-"}</strong></div>
          <div><span>{t("vectorStore")}</span><strong>{settings.vectorStore || "-"}</strong></div>
          <div><span>{t("chunking")}</span><strong>{settings.chunkSize} / {settings.chunkOverlap}</strong></div>
          <div><span>{t("embeddingEndpoint")}</span><strong>{settings.embeddingBaseUrl || "-"}</strong></div>
          <div><span>{t("credentialVariable")}</span><strong>{settings.embeddingCredentialEnv || "-"}</strong></div>
          {stats ? <div><span>{t("knowledgeStats")}</span><strong>{statsLoading ? t("loading") : `${stats.documentCount} ${t("documentCount")} · ${stats.chunkCount} ${t("chunkCount")}`}</strong></div> : null}
        </div>
      ) : settingsLoading ? (
        <div className="manager-placeholder compact"><LoaderCircle size={15} className="spin" />{t("loading")}</div>
      ) : null}
    </section>
  );
}

function KnowledgeSettingsEditor({
  form,
  saving,
  onCancel,
  onSubmit,
  t,
}: {
  form: ReturnType<typeof useForm<KnowledgeSettingsForm>>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  t: (key: string) => string;
}) {
  const embeddingEnabled = form.watch("embeddingEnabled");
  const fieldError = (field: keyof KnowledgeSettingsForm) =>
    form.formState.errors[field] ? t("loadFailed") : null;
  return (
    <form
      className="inline-form knowledge-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="knowledge-settings-heading">
        <div>
          <strong>{t("configureEmbedding")}</strong>
          <span>{t("knowledgeRuntimeHint")}</span>
        </div>
        <label className="model-enabled-check">
          <input type="checkbox" {...form.register("embeddingEnabled")} />
          {embeddingEnabled ? t("enabled") : t("disabled")}
        </label>
      </div>
      <div className="model-form-grid">
        <label>
          {t("embeddingModel")}
          <input {...form.register("embeddingModel")} disabled={!embeddingEnabled} placeholder="text-embedding-3-small" />
          {fieldError("embeddingModel") ? <small className="form-error">{fieldError("embeddingModel")}</small> : null}
        </label>
        <label>
          {t("embeddingEndpoint")}
          <input {...form.register("embeddingBaseUrl")} disabled={!embeddingEnabled} placeholder="https://api.openai.com/v1" />
          {fieldError("embeddingBaseUrl") ? <small className="form-error">{fieldError("embeddingBaseUrl")}</small> : null}
        </label>
        <label>
          {t("apiKey")}
          <input {...form.register("apiKey")} type="password" autoComplete="new-password" disabled={!embeddingEnabled} placeholder="sk-..." />
          <small className="form-note">{t("embeddingApiKeyHint")}</small>
        </label>
        <label>
          {t("credentialVariable")}
          <input {...form.register("embeddingCredentialEnv")} disabled={!embeddingEnabled} placeholder="OPENAI_API_KEY" />
        </label>
        <label>
          {t("vectorStore")}
          <input {...form.register("vectorStore")} disabled={!embeddingEnabled} placeholder="local" />
          {fieldError("vectorStore") ? <small className="form-error">{fieldError("vectorStore")}</small> : null}
        </label>
        <label>
          {t("chunking")}
          <span className="knowledge-chunk-inputs">
            <span><small>{t("chunkSize")}</small><input type="number" min="1" {...form.register("chunkSize", { valueAsNumber: true })} disabled={!embeddingEnabled} aria-label={t("chunkSize")} /></span>
            <span><small>{t("chunkOverlap")}</small><input type="number" min="0" {...form.register("chunkOverlap", { valueAsNumber: true })} disabled={!embeddingEnabled} aria-label={t("chunkOverlap")} /></span>
          </span>
          {fieldError("chunkSize") || fieldError("chunkOverlap") ? <small className="form-error">{t("loadFailed")}</small> : null}
        </label>
      </div>
      <div className="inline-form-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>{t("cancel")}</button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
          {t("save")}
        </button>
      </div>
    </form>
  );
}

function KnowledgeSearchResultRow({
  result,
  t,
}: {
  result: KnowledgeSearchResult;
  t: (key: string) => string;
}) {
  return (
    <div className="knowledge-search-result">
      <div>
        <strong>{result.sourceName} · {t("chunkCount")} {result.chunkIndex + 1}</strong>
        <span>{t("retrievalScore")}: {Number.isFinite(result.score) ? result.score.toFixed(3) : "-"}</span>
      </div>
      <p>{result.content}</p>
    </div>
  );
}

function KnowledgeDocumentRow({
  document,
  busy,
  onDelete,
  onRebuild,
  chunksOpen,
  chunks,
  chunksLoading,
  chunksError,
  onToggleChunks,
  t,
}: {
  document: KnowledgeDocument;
  busy: boolean;
  onDelete: () => void;
  onRebuild: () => void;
  chunksOpen: boolean;
  chunks: KnowledgeChunk[];
  chunksLoading: boolean;
  chunksError: boolean;
  onToggleChunks: () => void;
  t: (key: string) => string;
}) {
  const indexStatus = document.indexStatus ?? "READY";
  const indexLabel =
    indexStatus === "FAILED"
      ? t("indexFailed")
      : indexStatus === "INDEXING"
        ? t("indexing")
        : t("indexReady");
  return (
    <div className="knowledge-document-shell">
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
        <span className="knowledge-document-index">
          <span className={`document-index-status ${indexStatus.toLowerCase()}`}>
            {indexLabel}
          </span>
          {document.indexDurationMs !== null && document.indexDurationMs !== undefined ? (
            <span>
              {t("indexDuration")} {formatDuration(document.indexDurationMs)}
            </span>
          ) : null}
        </span>
        {document.summary ? <p>{document.summary}</p> : null}
        {indexStatus === "FAILED" && document.indexError ? (
          <p className="knowledge-document-error">{document.indexError}</p>
        ) : null}
      </div>
      <div className="row-actions">
        <IconButton label={chunksOpen ? t("hideChunks") : t("viewChunks")} onClick={onToggleChunks}>
          {chunksOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
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
      {chunksOpen ? (
        <div className="knowledge-chunk-list">
        {chunksLoading ? (
          <div className="manager-placeholder compact">
            <LoaderCircle size={15} className="spin" />
            <span>{t("loading")}</span>
          </div>
        ) : chunksError ? (
          <div className="manager-placeholder compact">
            <CircleAlert size={15} />
            <span>{t("chunksLoadFailed")}</span>
          </div>
        ) : chunks.length ? (
          chunks.map((chunk) => (
            <div className="knowledge-chunk" key={chunk.id}>
              <span>#{chunk.chunkIndex + 1}</span>
              <p>{chunk.content}</p>
            </div>
          ))
        ) : (
          <div className="manager-placeholder compact">{t("noChunks")}</div>
        )}
        </div>
      ) : null}
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
  source,
  onSourceChange,
  includeClawHub = false,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  source: string;
  onSourceChange: (source: string) => void;
  includeClawHub?: boolean;
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
      <select
        className="source-select"
        value={source}
        onChange={(event) => onSourceChange(event.target.value)}
        aria-label={t("searchSource")}
      >
        <option value="all">{t("searchAllSources")}</option>
        <option value="curated">{t("searchCurated")}</option>
        <option value="github">{t("searchGithub")}</option>
        {includeClawHub ? <option value="clawhub">{t("searchClawHub")}</option> : null}
      </select>
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
  actionLabel: string | ((repository: SkillRepository | McpRepository) => string);
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
          {repository.sourceType === "MCP_REGISTRY"
            ? t("mcpRegistry")
            : repository.sourceType === "CURATED"
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
            {typeof actionLabel === "function" ? actionLabel(repository) : actionLabel}
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
  const [searchSource, setSearchSource] = useState("all");
  const [visibleCount, setVisibleCount] = useState(30);
  const [selectedRepo, setSelectedRepo] = useState<SkillRepository | null>(
    null,
  );
  const [editorFor, setEditorFor] = useState<Skill | null | undefined>(undefined);
  const [editorId, setEditorId] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorEnabled, setEditorEnabled] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [notice, setNotice] = useState("");
  const detailQuery = useQuery({
    queryKey: ["skill-detail", editorFor?.id],
    queryFn: () => studioApi.getSkill(editorFor?.id ?? ""),
    enabled: editorFor?.id !== undefined,
  });
  const curatedQuery = useQuery({
    queryKey: ["skill-repositories"],
    queryFn: studioApi.listSkillRepositories,
    enabled: section === "marketplace",
  });
  const searchMutation = useMutation({
    mutationFn: studioApi.searchSkillRepositories,
  });
  const clawHubQuery = useQuery({
    queryKey: ["clawhub-skills", search],
    queryFn: () => studioApi.searchClawHubSkills({ query: search.trim() || undefined, limit: 30 }),
    enabled: section === "marketplace" && searchSource === "clawhub",
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
  const installClawHubMutation = useMutation({
    mutationFn: studioApi.installClawHubSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setNotice(t("completed"));
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
  const createMutation = useMutation({
    mutationFn: studioApi.createSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setEditorFor(undefined);
      setNotice(t("skillSaved"));
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, skillMarkdown, enabled }: { id: string; skillMarkdown: string; enabled: boolean }) =>
      studioApi.updateSkillContent(id, { skillMarkdown, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skill-detail"] });
      setEditorFor(undefined);
      setNotice(t("skillSaved"));
    },
  });
  useEffect(() => {
    if (editorFor && detailQuery.data?.summary.id === editorFor.id) {
      setEditorId(editorFor.id);
      setEditorMarkdown(detailQuery.data.skillMarkdown);
      setEditorEnabled(detailQuery.data.summary.enabled);
    }
  }, [detailQuery.data, editorFor]);
  const repositories = (searchMutation.data ?? curatedQuery.data ?? []).filter((repo) => {
    if (searchSource === "curated") return repo.sourceType === "CURATED";
    if (searchSource === "github") return repo.sourceType !== "CURATED";
    return true;
  });
  const visibleRepositories = repositories.slice(0, visibleCount);
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
          <div className="manager-toolbar">
            <div>
              <strong>{t("installedSkills")}</strong>
              <small>{t("skillsHint")}</small>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setEditorFor(null);
                setEditorId("");
                setEditorMarkdown("---\nname: \ndescription: \n---\n# New Skill\n\n");
                setEditorEnabled(true);
                setNotice("");
              }}
            >
              <Plus size={14} />
              {t("newSkill")}
            </button>
          </div>
          {editorFor !== undefined ? (
            <form
              className="skill-editor"
              onSubmit={(event) => {
                event.preventDefault();
                if (!editorId.trim() || !editorMarkdown.trim()) return;
                if (editorFor) {
                  updateMutation.mutate({
                    id: editorFor.id,
                    skillMarkdown: editorMarkdown,
                    enabled: editorEnabled,
                  });
                } else {
                  createMutation.mutate({
                    id: editorId.trim(),
                    skillMarkdown: editorMarkdown,
                    enabled: editorEnabled,
                    overwrite: false,
                  });
                }
              }}
            >
              <div className="skill-editor-heading">
                <div>
                  <strong>{editorFor ? t("editSkill") : t("newSkill")}</strong>
                  {editorFor && detailQuery.isLoading ? <small>{t("loading")}</small> : null}
                </div>
                <button type="button" className="icon-button" onClick={() => setEditorFor(undefined)} aria-label={t("close")} title={t("close")}>
                  <X size={15} />
                </button>
              </div>
              <label>
                {t("skillId")}
                <input value={editorId} onChange={(event) => setEditorId(event.target.value)} readOnly={Boolean(editorFor)} required />
              </label>
              <label>
                {t("skillMarkdown")}
                <textarea value={editorMarkdown} onChange={(event) => setEditorMarkdown(event.target.value)} rows={14} required />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={editorEnabled} onChange={(event) => setEditorEnabled(event.target.checked)} />
                {t("enabled")}
              </label>
              {(createMutation.error || updateMutation.error) ? (
                <div className="manager-notice error"><CircleAlert size={14} />{(createMutation.error || updateMutation.error) instanceof Error ? (createMutation.error || updateMutation.error)?.message : t("skillSaveFailed")}</div>
              ) : null}
              <div className="inline-form-actions">
                <button type="button" className="secondary-button" onClick={() => setEditorFor(undefined)}>{t("cancel")}</button>
                <button type="submit" className="primary-button" disabled={createMutation.isPending || updateMutation.isPending || (Boolean(editorFor) && detailQuery.isLoading)}>
                  {(createMutation.isPending || updateMutation.isPending) ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                  {t("save")}
                </button>
              </div>
            </form>
          ) : null}
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
                  <button type="button" className="text-button" onClick={() => {
                    setEditorFor(skill);
                    setEditorId(skill.id);
                    setEditorMarkdown("");
                    setEditorEnabled(skill.enabled);
                    setNotice("");
                  }}>
                    <Pencil size={14} /> {t("editSkill")}
                  </button>
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
            source={searchSource}
            includeClawHub
            onSourceChange={(src) => {
              setSearchSource(src);
              setVisibleCount(30);
            }}
            onSubmit={() => {
              setNotice("");
              if (searchSource === "clawhub") {
                void clawHubQuery.refetch();
              } else {
                searchMutation.mutate({
                  query: search.trim() || undefined,
                  limit: 30,
                });
              }
            }}
            t={t}
          />
          {searchSource === "clawhub" ? (
            <ClawHubSkillResults
              skills={clawHubQuery.data ?? []}
              loading={clawHubQuery.isLoading || clawHubQuery.isFetching}
              error={clawHubQuery.error}
              installed={installed}
              installing={installClawHubMutation.isPending}
              installError={installClawHubMutation.error}
              onRetry={() => void clawHubQuery.refetch()}
              onInstall={(skill) => installClawHubMutation.mutate({ reference: skill.reference, enabled: true, overwrite: false })}
              t={t}
            />
          ) : selectedRepo ? (
            <SkillDiscovery
              repository={selectedRepo}
              query={discoverMutation}
              installed={installed}
              installing={installMutation.isPending}
              installError={installMutation.error}
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
            <>
              <RepositoryResults
                repositories={visibleRepositories}
                loading={curatedQuery.isLoading || searchMutation.isPending}
                error={curatedQuery.isError || searchMutation.isError}
                onRetry={() => void curatedQuery.refetch()}
                onInspect={discover}
                actionLabel={t("viewSkills")}
                t={t}
              />
              {repositories.length > visibleCount ? (
                <button
                  type="button"
                  className="secondary-button load-more-button"
                  onClick={() => setVisibleCount((c) => c + 30)}
                >
                  <ChevronDown size={14} />
                  {t("loadMore")}
                </button>
              ) : null}
            </>
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
  actionLabel: string | ((repository: SkillRepository | McpRepository) => string);
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
            onInspect &&
            "defaultBranch" in repository &&
            (!("installType" in repository) || repository.installType !== "REPOSITORY")
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

function ClawHubSkillResults({
  skills,
  loading,
  error,
  installed,
  installing,
  installError,
  onRetry,
  onInstall,
  t,
}: {
  skills: ClawHubSkill[];
  loading: boolean;
  error: unknown;
  installed: Skill[];
  installing: boolean;
  installError: unknown;
  onRetry: () => void;
  onInstall: (skill: ClawHubSkill) => void;
  t: (key: string) => string;
}) {
  if (loading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loadingRepositories")}</span></div>;
  if (error) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{error instanceof Error ? error.message : t("repositoryLoadFailed")}</span><button type="button" className="secondary-button" onClick={onRetry}>{t("retryLoad")}</button></div>;
  const installedSources = new Set(installed.map((skill) => skill.sourceRepository));
  return skills.length ? (
    <div className="repository-list">
      {installError ? <div className="manager-notice error"><CircleAlert size={14} />{installError instanceof Error ? installError.message : t("installFailed")}</div> : null}
      {skills.map((skill) => {
        const isInstalled = installedSources.has(`clawhub/${skill.reference}`);
        return <div className="repository-row" key={skill.id}>
          <div className="repository-main">
            <div className="repository-title"><strong>{skill.name}</strong>{skill.official ? <span className="repository-stars">{t("official")}</span> : null}</div>
            <p>{skill.description || t("noDescription")}</p>
            <span className="repository-source">ClawHub · {skill.reference} · {skill.downloads.toLocaleString()} {t("downloads")}</span>
          </div>
          <div className="repository-actions">
            <a className="icon-button" href={skill.url} target="_blank" rel="noreferrer" aria-label={t("openRepository")} title={t("openRepository")}><ExternalLink size={15} /></a>
            <button type="button" className={isInstalled ? "secondary-button" : "primary-button"} disabled={isInstalled || installing || skill.suspicious} onClick={() => onInstall(skill)}>
              {installing ? <LoaderCircle size={14} className="spin" /> : <Package size={14} />}{isInstalled ? t("installed") : skill.suspicious ? t("reviewRequired") : t("install")}
            </button>
          </div>
        </div>;
      })}
    </div>
  ) : <div className="manager-placeholder compact">{t("noRepositories")}</div>;
}

function SkillDiscovery({
  repository,
  query,
  installed,
  installing,
  installError,
  onBack,
  onInstall,
  t,
}: {
  repository: SkillRepository;
  query: { data?: RepositorySkill[]; isPending: boolean; isError: boolean };
  installed: Skill[];
  installing: boolean;
  installError: unknown;
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
      {installError ? (
        <div className="manager-notice error" role="alert">
          <CircleAlert size={14} />
          {installError instanceof Error && installError.message
            ? installError.message
            : t("installFailed")}
        </div>
      ) : null}
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
  refreshing,
  refreshingId,
  refreshError,
  t,
}: {
  connections: McpConnection[];
  query: ResourceQuery;
  onToggle: (item: { id: string; enabled: boolean }) => void;
  onRefresh: (id: string) => void;
  refreshing: boolean;
  refreshingId?: string;
  refreshError: unknown;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState("installed");
  const [search, setSearch] = useState("");
  const [searchSource, setSearchSource] = useState("all");
  const [visibleRepositoryCount, setVisibleRepositoryCount] = useState(24);
  const [selectedRepo, setSelectedRepo] = useState<McpRepository | null>(null);
  const [notice, setNotice] = useState("");
  const [verificationTargetId, setVerificationTargetId] = useState<string | null>(
    null,
  );
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
    mutationFn: (repository: McpRepository) =>
      repository.installType === "REMOTE"
        ? studioApi.createMcpConnection({
            name: repository.name,
            description: repository.description,
            transportType: repository.transportType ?? "STREAMABLE_HTTP",
            endpoint: repository.endpoint ?? undefined,
            enabled: true,
          })
        : studioApi.installNpmMcp({
            name: repository.name,
            description: repository.description,
            npmPackage: repository.npmPackage ?? "",
            enabled: true,
            refreshTools: true,
          }),
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setSelectedRepo(null);
      const toolsDiscovered = Boolean(connection.tools?.length);
      setNotice(toolsDiscovered ? t("completed") : t("mcpAddedNeedsRefresh"));
      setVerificationTargetId(toolsDiscovered ? null : connection.id);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
    },
  });
  const verifyInstallationMutation = useMutation({
    mutationFn: studioApi.refreshMcpTools,
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      const toolsDiscovered = Boolean(connection.tools?.length);
      setNotice(toolsDiscovered ? t("completed") : t("mcpAddedNeedsRefresh"));
      setVerificationTargetId(toolsDiscovered ? null : connection.id);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
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
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setEditorFor(undefined);
      const toolsDiscovered = Boolean(connection.tools?.length);
      setNotice(toolsDiscovered ? t("completed") : t("mcpAddedNeedsRefresh"));
      setVerificationTargetId(toolsDiscovered ? null : connection.id);
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
  const repositories = (searchMutation.data ?? curatedQuery.data ?? []).filter((repo) => {
    if (searchSource === "curated") return repo.sourceType === "MCP_REGISTRY";
    if (searchSource === "github") return repo.sourceType !== "MCP_REGISTRY";
    return true;
  });
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
          setVerificationTargetId(null);
        }}
        t={t}
      />
      {notice ? (
        <div className="manager-notice success">
          <CheckCircle2 size={14} />
          {notice}
          {verificationTargetId ? (
            <button
              type="button"
              className="text-button model-save-notice-action"
              disabled={verifyInstallationMutation.isPending || refreshing}
              onClick={() =>
                verifyInstallationMutation.mutate(verificationTargetId)
              }
            >
              {verifyInstallationMutation.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("refreshTools")}
            </button>
          ) : null}
        </div>
      ) : null}
      {verifyInstallationMutation.isError ? (
        <div className="manager-notice error" role="alert">
          <CircleAlert size={14} />
          {verifyInstallationMutation.error instanceof Error &&
          verifyInstallationMutation.error.message
            ? verifyInstallationMutation.error.message
            : t("loadFailed")}
        </div>
      ) : null}
      {refreshError ? (
        <div className="manager-notice error" role="alert">
          <CircleAlert size={14} />
          {refreshError instanceof Error && refreshError.message
            ? refreshError.message
            : t("loadFailed")}
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
                  [
                    displayMcpDescription(
                      connection.description,
                      t("mcpDescriptionUnavailable"),
                    ),
                    connection.lastError,
                  ]
                    .filter(Boolean)
                    .join(" - ")
                }
                status={
                  connection.enabled
                    ? `${t("enabled")} 路 ${statusLabel(connection.status, t)}`
                    : t("disabled")
                }
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
                      disabled={refreshing}
                      onClick={() => onRefresh(connection.id)}
                    >
                      {refreshing && refreshingId === connection.id ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
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
            source={searchSource}
            onSourceChange={(src) => {
              setSearchSource(src);
              setVisibleRepositoryCount(24);
            }}
            onSubmit={() => {
              setNotice("");
              searchMutation.mutate({
                query: search.trim() || undefined,
                limit: 30,
                source:
                  searchSource === "curated"
                    ? "registry"
                    : searchSource === "github"
                      ? "github"
                      : undefined,
              });
              setVisibleRepositoryCount(24);
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
                  <span>
                    {selectedRepo.installType === "REMOTE"
                      ? t("mcpRemoteInstallHint")
                      : t("mcpNpmInstallHint")}
                  </span>
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
              <div className="mcp-install-summary">
                <span>{selectedRepo.installType === "REMOTE" ? t("mcpEndpoint") : t("npmPackage")}</span>
                <code>{selectedRepo.installType === "REMOTE" ? selectedRepo.endpoint : selectedRepo.npmPackage}</code>
              </div>
              {installMutation.isError ? (
                <p className="form-error">
                  {installMutation.error instanceof Error
                    ? installMutation.error.message
                    : t("installFailed")}
                </p>
              ) : null}
              <button
                type="button"
                className="primary-button"
                disabled={installMutation.isPending}
                onClick={() => installMutation.mutate(selectedRepo)}
              >
                {installMutation.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Package size={14} />
                )}
                {selectedRepo.installType === "REMOTE" ? t("addMcp") : t("installMcp")}
              </button>
            </div>
          ) : (
            <>
              <RepositoryResults
                repositories={repositories.slice(0, visibleRepositoryCount)}
                loading={curatedQuery.isLoading || searchMutation.isPending}
                error={curatedQuery.isError || searchMutation.isError}
                onRetry={() => void curatedQuery.refetch()}
                onInspect={(repository) => setSelectedRepo(repository)}
                actionLabel={(repository) =>
                  "installType" in repository && repository.installType === "REMOTE"
                    ? t("addMcp")
                    : t("installMcp")
                }
                t={t}
              />
              {repositories.length > visibleRepositoryCount ? (
                <button
                  type="button"
                  className="secondary-button load-more-button"
                  onClick={() => setVisibleRepositoryCount((count) => count + 24)}
                >
                  <ChevronDown size={14} />
                  {t("loadMore")}
                </button>
              ) : null}
            </>
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
  status?: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="manager-list-item">
      <span className="model-glyph">{icon}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {status ? <span className="list-status">{status}</span> : null}
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

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function formatHistoryTimestamp(value: string, language: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
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
  if (id === "runtime") return ["execution-settings"];
  if (id === "nodes") return ["nodes"];
  if (id === "models") return ["models"];
  return ["agents"];
}

export default App;
