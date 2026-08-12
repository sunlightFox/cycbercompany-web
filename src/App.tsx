import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  ArrowUp,
  Archive,
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Copy,
  Cpu,
  Database,
  Download,
  FileText,
  FolderKanban,
  Globe2,
  HardDrive,
  History,
  LoaderCircle,
  Menu,
  MemoryStick,
  MoreHorizontal,
  Monitor,
  Moon,
  PanelLeftClose,
  Paperclip,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Server,
  Sun,
  TerminalSquare,
  Target,
  Trash2,
  Wrench,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import {
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
import { RunLaunchTimeoutError, StudioApiError, studioApi, streamRunEvents } from "./lib/api";
import { createUuid } from "./lib/uuid";
import { useStudioStore } from "./store/useStudioStore";
import type {
  Agent,
  ApprovalMode,
  Artifact,
  Citation,
  ExecutionMode,
  ConversationAttachment,
  KnowledgeBase,
  McpConnection,
  Message,
  ModelProfile,
  NodeConnection,
  RunEvent,
  RunView,
  RunStep,
  Skill,
  SkillPreflight,
  StudioMessage,
  Tool,
  UserPersona,
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
type HistoryEntry = {
  id: string;
  title: string;
  updatedAt: string;
  archived?: boolean;
  archivedAt?: string | null;
};

const HISTORY_STORAGE_KEY = "studio-conversation-history";
const CITATION_STORAGE_KEY = "studio-conversation-citations";
const APPROVAL_MODE_STORAGE_KEY = "studio-conversation-approval-modes";
const AssistantMarkdown = lazy(() => import("./components/AssistantMarkdown"));
const AgentManager = lazy(() =>
  import("./components/AgentManager").then(({ AgentManager }) => ({
    default: AgentManager,
  })),
);
const McpManager = lazy(() => import("./components/McpManager"));
const SkillsManager = lazy(() => import("./components/SkillsManager"));
const KnowledgeManager = lazy(() => import("./components/KnowledgeManager"));
const ModelManager = lazy(() => import("./components/ModelManager"));
const NodeManager = lazy(() => import("./components/NodeManager"));
const MemoryManager = lazy(() => import("./components/MemoryManager"));
const PersonaManager = lazy(() => import("./components/PersonaManager"));
const CitationDrawer = lazy(() => import("./components/CitationDrawer"));
const RunAuditDrawer = lazy(() => import("./components/RunAuditDrawer"));
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function isTextAttachment(file: Pick<File, "name" | "type">) {
  return (
    file.type.startsWith("text/") ||
    /\.(md|txt|csv|json|xml|log)$/i.test(file.name)
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? sortHistoryEntries(
          parsed
          .filter((item): item is HistoryEntry =>
            Boolean(item?.id && item?.title && item?.updatedAt),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            updatedAt: item.updatedAt,
            archived: Boolean(item.archived),
            archivedAt: typeof item.archivedAt === "string" ? item.archivedAt : null,
          })),
        ).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function sortHistoryEntries(entries: HistoryEntry[]) {
  return [...entries].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function writeHistory(entries: HistoryEntry[]) {
  localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(sortHistoryEntries(entries).slice(0, 30)),
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

function isLocalExecutorNotReady(error: unknown) {
  return error instanceof StudioApiError
    && error.status === 400
    && (error.code === "LOCAL_COMPUTER_CONTROL_NOT_READY"
      || /local computer control is not ready/i.test(error.message));
}

function localExecutorStartFailureHint(error: unknown, t: (key: string) => string) {
  if (error instanceof Error && /still starting|timed out/i.test(error.message)) {
    return t("localExecutorConnectTimeout");
  }
  return t("localExecutorAutoStartFailed");
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
  disabled = false,
  onConfirm,
}: {
  name: string;
  description: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (disabled)
    return (
      <IconButton
        label={`${t("delete")} ${name}`}
        disabled
        onClick={() => undefined}
      >
        <Trash2 size={14} />
      </IconButton>
    );
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
  readOnly,
  t,
}: {
  attachments: ConversationAttachment[];
  deleting: boolean;
  onDownload: (attachment: ConversationAttachment) => void;
  onDelete: (attachment: ConversationAttachment) => void;
  readOnly: boolean;
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
              disabled={readOnly}
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
  const [selectedModelProfileId, setSelectedModelProfileId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
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
  const [capabilityDataRequested, setCapabilityDataRequested] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() =>
    readConversationApprovalMode(conversationId),
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [localExecutorRecoveryRequired, setLocalExecutorRecoveryRequired] = useState(false);
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
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [auditRunId, setAuditRunId] = useState<string | null>(null);
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
  const isNearConversationBottomRef = useRef(true);

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
  const systemStatusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: studioApi.getSystemStatus,
    retry: 0,
    refetchInterval: (query) => query.state.status === "error" ? 5_000 : 15_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: studioApi.listAgents,
    retry: 0,
    refetchInterval: (query) => query.state.status === "error" ? 5_000 : 30_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: studioApi.listModels,
    retry: 0,
    refetchInterval: (query) => query.state.status === "error" ? 5_000 : 30_000,
  });
  const executionSettingsQuery = useQuery({
    queryKey: ["execution-settings"],
    queryFn: studioApi.getExecutionSettings,
    retry: 0,
    refetchInterval: (query) => query.state.status === "error" ? 5_000 : 30_000,
  });
  const executionMode = executionSettingsQuery.data?.mode ?? "PERSONAL_LOCAL";
  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true);
    setComposerNotice(t("reconnecting"));
    try {
      await Promise.all([
        systemStatusQuery.refetch(),
        agentsQuery.refetch(),
        modelsQuery.refetch(),
      ]);
      // The persistent composer status already explains the resolved outcome.
      // Do not stack a second, less specific notice beneath it.
      setComposerNotice(null);
    } finally {
      setIsReconnecting(false);
    }
  }, [agentsQuery, modelsQuery, systemStatusQuery, t]);

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
  const activeModelProfileId =
    selectedModelProfileId ?? currentAgent?.defaultModelProfileId ?? defaultModelProfileId;
  useEffect(() => {
    const modelList = modelsQuery.data ?? [];
    if (selectedModelProfileId && modelList.some((model) => model.id === selectedModelProfileId)) return;
    setSelectedModelProfileId(defaultModelProfileId ?? currentAgent?.defaultModelProfileId ?? null);
  }, [currentAgent?.defaultModelProfileId, defaultModelProfileId, modelsQuery.data, selectedModelProfileId]);
  const modelReady = availableModels.some(
    (model) =>
      model.id === activeModelProfileId &&
      model.enabled &&
      model.apiKeyConfigured &&
      model.capabilities.includes("TEXT"),
  );
  const globalModelReady = availableModels.some(
    (model) =>
      model.id === defaultModelProfileId &&
      model.enabled &&
      model.apiKeyConfigured &&
      model.capabilities.includes("TEXT"),
  );
  const agentModelOverrideUnavailable = Boolean(
    !modelReady &&
    globalModelReady &&
    currentAgent?.defaultModelProfileId &&
    currentAgent.defaultModelProfileId !== defaultModelProfileId,
  );
  const backendAvailable =
    agentsQuery.isSuccess &&
    modelsQuery.isSuccess &&
    !agentsQuery.isError &&
    !modelsQuery.isError;
  const personasQuery = useQuery({
    queryKey: ["personas"],
    queryFn: studioApi.listPersonas,
    enabled: backendAvailable,
    retry: 1,
  });
  const backendConnecting =
    !backendAvailable &&
    !systemStatusQuery.isError &&
    (agentsQuery.isPending || modelsQuery.isPending);
  const backendUnhealthy = [systemStatusQuery.error, agentsQuery.error, modelsQuery.error].some(
    (error) => error instanceof StudioApiError && error.status >= 500,
  );
  const persistenceUnavailable = systemStatusQuery.error instanceof StudioApiError
    && systemStatusQuery.error.code === "PERSISTENCE_UNAVAILABLE";
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
  const archiveConversationMutation = useMutation({
    mutationFn: (id: string) => studioApi.archiveConversation(id),
    onSuccess: (conversation) => {
      rememberConversation(conversation.id, conversation.title, {
        archived: conversation.archived,
        archivedAt: conversation.archivedAt ?? null,
        preserveUpdatedAt: true,
      });
      clearAttachments();
      setComposerNotice(null);
    },
    onError: (error) =>
      setComposerNotice(error instanceof Error ? error.message : t("archiveConversationFailed")),
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
    enabled: backendAvailable && (settingsOpen || capabilityDataRequested),
  });
  const knowledgeBasesQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: studioApi.listKnowledgeBases,
    retry: 1,
    enabled: backendAvailable && (settingsOpen || capabilityDataRequested),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: studioApi.listSkills,
    retry: 1,
    enabled: backendAvailable && (settingsOpen || capabilityDataRequested),
  });
  const mcpQuery = useQuery({
    queryKey: ["mcp-connections"],
    queryFn: studioApi.listMcpConnections,
    retry: 1,
    enabled: backendAvailable && (settingsOpen || capabilityDataRequested),
  });
  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: studioApi.listNodes,
    retry: 1,
    enabled: backendAvailable && (settingsOpen || capabilityDataRequested),
    // A local executor can connect, disconnect, or finish bootstrapping without
    // another UI action. Keep this status fresh so users never have to close and
    // reopen the management workspace to see the real machine state.
    refetchInterval: settingsOpen || capabilityDataRequested
      ? executionMode === "PERSONAL_LOCAL" ? 5_000 : 15_000
      : false,
  });
  const selectedNode = (nodesQuery.data ?? []).find(
    (node) => node.id === capabilityState.nodeId,
  );
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
  const currentConversationArchived = Boolean(currentHistory?.archived);
  const currentPersona = (personasQuery.data ?? []).find(
    (persona) => persona.id === selectedPersonaId,
  );
  const selectPersonaMutation = useMutation({
    mutationFn: async ({ personaId }: { personaId: string | null; previousPersonaId: string | null }) => {
      if (!conversationId) return null;
      return studioApi.selectConversationPersona(conversationId, personaId);
    },
    onSuccess: (conversation) => {
      if (conversation) setSelectedPersonaId(conversation.personaId ?? null);
    },
    onError: (_error, variables) => {
      setSelectedPersonaId(variables.previousPersonaId);
      setComposerNotice(t("personaSaveFailed"));
    },
  });
  const handlePersonaSelect = useCallback((personaId: string | null) => {
    if (personaId === selectedPersonaId) return;
    if (currentConversationArchived) {
      setComposerNotice(t("personaArchivedDisabled"));
      return;
    }
    const previousPersonaId = selectedPersonaId;
    setSelectedPersonaId(personaId);
    if (conversationId) {
      selectPersonaMutation.mutate({ personaId, previousPersonaId });
    }
  }, [conversationId, currentConversationArchived, selectPersonaMutation, selectedPersonaId, t]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = i18n.language === "en" ? "en" : "zh-CN";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        theme === "dark" ? "#101111" : theme === "white" ? "#ffffff" : "#f7f7f5",
      );
  }, [i18n.language, theme]);

  useEffect(() => {
    const handleGlobalSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", handleGlobalSearch);
    return () => window.removeEventListener("keydown", handleGlobalSearch);
  }, []);

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
      (nodesQuery.isSuccess &&
        (!selectedNode ||
          selectedNode.kind === "MANAGED_LOCAL" ||
          !selectedNode.enabled ||
          selectedNode.status?.toUpperCase() !== "ONLINE"))
    )
      setCapabilityState((current) => ({ ...current, nodeId: undefined }));
  }, [capabilityState.nodeId, nodesQuery.data, nodesQuery.isSuccess]);

  useLayoutEffect(() => {
    // Opening a task should start at its newest state, even after the user had
    // intentionally scrolled upward in a previous task.
    isNearConversationBottomRef.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isNearConversationBottomRef.current) return;
    stage.scrollTop = stage.scrollHeight;
  }, [messages, lastMessage?.content, lastMessage?.isStreaming]);

  const handleConversationScroll = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    isNearConversationBottomRef.current =
      stage.scrollHeight - stage.scrollTop - stage.clientHeight <= 48;
  }, []);

  const rememberConversation = useCallback(
    (
      id: string,
      title: string,
      meta?: {
        archived?: boolean;
        archivedAt?: string | null;
        preserveUpdatedAt?: boolean;
      },
    ) => {
      setHistoryEntries((current) => {
        const existing = current.find((entry) => entry.id === id);
        const updatedAt = meta?.preserveUpdatedAt && existing
          ? existing.updatedAt
          : new Date().toISOString();
        const next = sortHistoryEntries([
          {
            id,
            title: (existing?.title ?? title) || t("newTask"),
            updatedAt,
            archived: meta?.archived ?? existing?.archived ?? false,
            archivedAt:
              meta?.archivedAt ??
              (meta?.archived === false ? null : existing?.archivedAt ?? null),
          },
          ...current.filter((entry) => entry.id !== id),
        ]);
        writeHistory(next);
        return next;
      });
    },
    [t],
  );

  const resetTask = useCallback(() => {
    conversationLoadRef.current += 1;
    setConversationId(null);
    setSelectedPersonaId(null);
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
    setSearchOpen(false);
    setHistoryOpen(false);
    setAuditRunId(null);
    setSettingsOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [
    clearAttachments,
    setConversationId,
    setMessages,
    setSettingsOpen,
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
      ensureConversationRef.current = studioApi.createConversation(title || t("newTask"), selectedPersonaId).then((result) => {
        // The composer already inserted the optimistic user and assistant messages.
        // Suppress the automatic empty-history restoration for this brand-new conversation.
        restoredConversationRef.current = result.id;
        setConversationId(result.id);
        setSelectedPersonaId(result.personaId ?? null);
        writeConversationApprovalMode(result.id, approvalMode);
        rememberConversation(result.id, title);
        return result.id;
      }).finally(() => {
        ensureConversationRef.current = null;
      });
      return ensureConversationRef.current;
    },
    [approvalMode, rememberConversation, selectedPersonaId, setConversationId, t],
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
        setSelectedPersonaId(conversation.personaId ?? null);
        setApprovalMode(readConversationApprovalMode(conversation.id));
        rememberConversation(conversation.id, conversation.title, {
          archived: conversation.archived,
          archivedAt: conversation.archivedAt ?? null,
          preserveUpdatedAt: true,
        });
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
        if (
          error instanceof StudioApiError &&
          (error.status === 404 ||
            error.code === "BAD_REQUEST" && /conversation not found/i.test(error.message))
        ) {
          // A browser can retain a conversation id after the backend data directory
          // was reset or switched. Recover to a clean task instead of trapping the
          // user on an unrecoverable "conversation not found" state.
          setHistoryEntries((current) => {
            const next = current.filter((entry) => entry.id !== id);
            writeHistory(next);
            return next;
          });
          resetTask();
          setComposerNotice(t("conversationExpired"));
        } else {
          setComposerNotice(
            error instanceof Error ? error.message : t("loadFailed"),
          );
        }
      } finally {
        setOpeningConversationId(null);
      }
    },
    [openingConversationId, rememberConversation, resetTask, setApprovalMode, setConversationId, setMessages, t, trackRun],
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
      setLocalExecutorRecoveryRequired(false);
      if (currentConversationArchived) {
        setComposerNotice(t("conversationArchivedHint"));
        return;
      }
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
      // Keep ordinary conversations independent of the local executor. The server
      // resolves a managed local target only for a task that actually needs system
      // tools, while an explicitly selected node remains an explicit target.
      let runNodeId = capabilityState.nodeId;
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
      let localExecutorAutoStartFailed = false;
      let localExecutorAutoStartFailureHint: string | null = null;
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
        const createRun = () => studioApi.createRun({
          conversationId: conversation,
          text: runInput,
          agentId: currentAgent?.id,
          modelProfileId: activeModelProfileId,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          clientRequestId,
          ...selectedCapabilities,
        }, { idempotencyKey: clientRequestId });
        let run;
        try {
          run = await createRun();
        } catch (error) {
          // The backend has classified this as an explicit desktop/system task
          // and refused it because the managed local companion is offline.
          // Wake the loopback launcher once, then retry the same idempotent run.
          if (executionMode !== "PERSONAL_LOCAL" || !isLocalExecutorNotReady(error)) {
            throw error;
          }
          updateAssistant(runId, (message) => ({
            ...message,
            steps: [
              ...(message.steps ?? []),
              {
                id: "local-executor-start",
                kind: "execution",
                label: t("localExecutorAutoStarting"),
                status: "running",
              },
            ],
          }));
          setComposerNotice(t("localExecutorAutoStarting"));
          try {
            await studioApi.startLocalExecutor();
            const nextNodes = await studioApi.waitForManagedLocalExecutorOnline();
            queryClient.setQueryData(["nodes"], nextNodes);
          } catch (startError) {
            localExecutorAutoStartFailed = true;
            const failureHint = localExecutorStartFailureHint(startError, t);
            localExecutorAutoStartFailureHint = failureHint;
            setLocalExecutorRecoveryRequired(
              failureHint === t("localExecutorAutoStartFailed"),
            );
            updateAssistant(runId, (message) => ({
              ...message,
              steps: (message.steps ?? []).map((step) =>
                step.id === "local-executor-start"
                  ? {
                      ...step,
                      status: "failed",
                      detail: failureHint,
                      duration: t("stepFailed"),
                    }
                  : step,
              ),
            }));
            setComposerNotice(failureHint);
            throw startError;
          }
          updateAssistant(runId, (message) => ({
            ...message,
            steps: (message.steps ?? []).map((step) =>
              step.id === "local-executor-start"
                ? { ...step, status: "complete", duration: t("stepDone") }
                : step,
            ),
          }));
          setComposerNotice(null);
          run = await createRun();
        }
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
                : localExecutorAutoStartFailed
                  ? localExecutorAutoStartFailureHint ?? t("localExecutorAutoStartFailed")
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
      currentConversationArchived,
      clearSentAttachments,
      currentAgent?.defaultSkillIds,
      currentAgent?.id,
      activeModelProfileId,
      ensureConversation,
      executionMode,
      finishRun,
      handleRunEvent,
      isPreflighting,
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
      if (currentConversationArchived) {
        setComposerNotice(t("conversationArchivedHint"));
        return;
      }
      setApprovalMode(next);
      if (conversationId) writeConversationApprovalMode(conversationId, next);
    },
    [conversationId, currentConversationArchived, t],
  );

  const handleArchiveConversation = useCallback(() => {
    if (!conversationId || currentConversationArchived || archiveConversationMutation.isPending) return;
    void archiveConversationMutation.mutateAsync(conversationId);
  }, [archiveConversationMutation, conversationId, currentConversationArchived]);

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
      if (currentConversationArchived) {
        setComposerNotice(t("conversationArchivedHint"));
        return;
      }
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
    [conversationId, currentConversationArchived, finishRun, handleRunEvent, replaceTrackedRun, setMessages, t, trackRun, updateAssistant],
  );

  const handleApproval = useCallback(
    async (message: StudioMessage, approved: boolean) => {
      if (currentConversationArchived) {
        setComposerNotice(t("conversationArchivedHint"));
        return;
      }
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
    [approvingApprovalId, currentConversationArchived, t, updateAssistant],
  );

  const handleAttach = (files: File[]) => {
    if (currentConversationArchived) {
      setComposerNotice(t("conversationArchivedHint"));
      return;
    }
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
        : nextAttachments.some((attachment) => !isTextAttachment(attachment.file))
          ? t("attachmentModelLimited")
          : null,
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (currentConversationArchived) return;
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
            className={`workspace-view ${messages.length === 0 ? "is-empty-view" : ""}`}
            aria-hidden={settingsOpen || sidebarOpen}
            inert={settingsOpen || sidebarOpen || undefined}
          >
          <header className="topbar reference-topbar">
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
              <h1 className="studio-wordmark">Spring Agent Studio</h1>
            </div>
            <div className="topbar-actions">
              <div className="workspace-switchers" aria-label={t("workspace")}>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="topbar-switcher" type="button" aria-label={t("agents")}>
                      <Bot size={17} />
                      <span className="topbar-switcher-copy">
                        <small>{t("agents")}</small>
                        <strong>{currentAgent?.name ?? t("agentEmptyState")}</strong>
                      </span>
                      <ChevronDown size={14} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="menu workspace-switcher-menu" align="end" sideOffset={8}>
                      <DropdownMenu.Label className="menu-label">{t("agents")}</DropdownMenu.Label>
                      {availableAgents.length ? availableAgents.map((agent) => (
                        <DropdownMenu.Item className="menu-item" key={agent.id} onSelect={() => setSelectedAgentId(agent.id)}>
                          <Bot size={15} />
                          {agent.name}
                          {agent.id === currentAgent?.id ? <Check size={15} className="menu-item-check" /> : null}
                        </DropdownMenu.Item>
                      )) : (
                        <DropdownMenu.Item className="menu-item" disabled><CircleAlert size={15} />{t("agentEmptyState")}</DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      className="topbar-switcher"
                      type="button"
                      aria-label={t("personaSelector")}
                      disabled={selectPersonaMutation.isPending || currentConversationArchived}
                    >
                      <UserRound size={17} />
                      <span className="topbar-switcher-copy">
                        <small>{t("personaSelector")}</small>
                        <strong>{currentPersona?.name ?? t("personaNone")}</strong>
                      </span>
                      <ChevronDown size={14} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="menu workspace-switcher-menu" align="end" sideOffset={8}>
                      <DropdownMenu.Label className="menu-label">{t("personaSelector")}</DropdownMenu.Label>
                      <DropdownMenu.Item className="menu-item persona-menu-hint" disabled>
                        {t("personaPermissionHint")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="menu-item" onSelect={() => handlePersonaSelect(null)}>
                        <UserRound size={15} />
                        {t("personaNone")}
                        {!selectedPersonaId ? <Check size={15} className="menu-item-check" /> : null}
                      </DropdownMenu.Item>
                      {personasQuery.isLoading ? (
                        <DropdownMenu.Item className="menu-item" disabled>
                          <LoaderCircle size={15} className="spin" />{t("personaLoading")}
                        </DropdownMenu.Item>
                      ) : personasQuery.data?.length ? personasQuery.data.map((persona: UserPersona) => (
                        <DropdownMenu.Item className="menu-item" key={persona.id} onSelect={() => handlePersonaSelect(persona.id)}>
                          <UserRound size={15} />
                          {persona.name}
                          {persona.defaultPersona ? <span className="persona-default-marker">{t("personaDefault")}</span> : null}
                          {persona.id === selectedPersonaId ? <Check size={15} className="menu-item-check" /> : null}
                        </DropdownMenu.Item>
                      )) : (
                        <DropdownMenu.Item className="menu-item" disabled>
                          <CircleAlert size={15} />{t("personaEmpty")}
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <DropdownMenu.Root onOpenChange={(open) => { if (open) setCapabilityDataRequested(true); }}>
                  <DropdownMenu.Trigger asChild>
                    <button className="topbar-switcher" type="button" aria-label={t("nodes")}>
                      {selectedNode ? <Server size={17} /> : <Monitor size={17} />}
                      <span className="topbar-switcher-copy">
                        <small>{t("nodes")}</small>
                        <strong>{selectedNode?.name ?? (executionMode === "PERSONAL_LOCAL" ? t("localExecutor") : t("noExecutionNode"))}</strong>
                      </span>
                      <ChevronDown size={14} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="menu workspace-switcher-menu" align="end" sideOffset={8}>
                      <DropdownMenu.Label className="menu-label">{t("nodes")}</DropdownMenu.Label>
                      <DropdownMenu.Item className="menu-item" onSelect={() => setCapabilityState((current) => ({ ...current, nodeId: undefined }))}>
                        <Monitor size={15} />{t("localExecutor")}
                        {!capabilityState.nodeId ? <Check size={15} className="menu-item-check" /> : null}
                      </DropdownMenu.Item>
                      {(nodesQuery.data ?? []).filter((node) => node.enabled).map((node) => (
                        <DropdownMenu.Item className="menu-item" key={node.id} onSelect={() => setCapabilityState((current) => ({ ...current, nodeId: node.id }))}>
                          <Server size={15} />{node.name}
                          {node.id === capabilityState.nodeId ? <Check size={15} className="menu-item-check" /> : null}
                        </DropdownMenu.Item>
                      ))}
                      {!nodesQuery.data?.length ? <DropdownMenu.Item className="menu-item" disabled><CircleAlert size={15} />{t("noExecutionNode")}</DropdownMenu.Item> : null}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="icon-button reference-settings-trigger"
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
                      onSelect={() => setTheme("dark")}
                    >
                      <Moon size={15} />
                      {t("dark")}
                      {theme === "dark" ? <Check size={15} className="menu-item-check" /> : null}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() => setTheme("light")}
                    >
                      <Sun size={15} />
                      {t("warm")}
                      {theme === "light" ? <Check size={15} className="menu-item-check" /> : null}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() => setTheme("white")}
                    >
                      <Sun size={15} />
                      {t("white")}
                      {theme === "white" ? <Check size={15} className="menu-item-check" /> : null}
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
                    {conversationId ? (
                      currentConversationArchived ? (
                        <DropdownMenu.Item className="menu-item" disabled>
                          <Archive size={15} /> {t("archived")}
                        </DropdownMenu.Item>
                      ) : (
                        <DropdownMenu.Item
                          className="menu-item"
                          disabled={archiveConversationMutation.isPending}
                          onSelect={handleArchiveConversation}
                        >
                          {archiveConversationMutation.isPending ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <Archive size={15} />
                          )}{" "}
                          {archiveConversationMutation.isPending
                            ? t("archivingConversation")
                            : t("archiveConversation")}
                        </DropdownMenu.Item>
                      )
                    ) : null}
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
            <div className={`message-feed ${messages.length === 0 ? "is-empty" : ""}`}>
              {messages.length === 0 ? (
                <div className="empty-conversation" aria-label={t("workspace")}>
                  <h1>{t("askStudio")}</h1>
                </div>
              ) : null}
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
                      onRetry={() =>
                        message.runId?.startsWith("pending-")
                          ? void handleSend(message.retryInput)
                          : retryMessage(message)
                      }
                      onCancelRun={handleCancelRun}
                      onAudit={(runId) => setAuditRunId(runId)}
                      onApproval={handleApproval}
                      readOnly={currentConversationArchived}
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
                readOnly={currentConversationArchived}
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
            backendUnhealthy={backendUnhealthy}
            persistenceUnavailable={persistenceUnavailable}
            modelReady={modelReady}
            agentModelOverrideUnavailable={agentModelOverrideUnavailable}
            connecting={backendConnecting}
            reconnecting={isReconnecting}
            onReconnect={() => void handleReconnect()}
            onOpenModels={() => openConfiguration("models")}
            onOpenAgents={() => openConfiguration("agents")}
            onOpenNodes={() => openConfiguration("nodes")}
            textareaRef={textareaRef}
            t={t}
            onAttach={(files) => void handleAttach(files)}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            composerNotice={composerNotice}
            localExecutorRecoveryRequired={localExecutorRecoveryRequired}
            readOnly={currentConversationArchived}
            preflighting={isPreflighting}
            skillPreflight={skillPreflight}
            agentToolAllowList={currentAgent?.toolAllowList}
            toolsQuery={toolsQuery}
            knowledgeBasesQuery={knowledgeBasesQuery}
            skillsQuery={skillsQuery}
            mcpQuery={mcpQuery}
            nodesQuery={nodesQuery}
            models={availableModels}
            activeModelProfileId={activeModelProfileId}
            onModelChange={setSelectedModelProfileId}
            capabilityState={capabilityState}
            empty={messages.length === 0}
            onCapabilityChange={handleCapabilityChange}
            onCapabilityMenuOpen={() => setCapabilityDataRequested(true)}
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
              loading={auditQuery.isLoading}
              error={auditQuery.isError}
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
          entries={historyEntries}
          openingId={openingConversationId}
          onOpenConversation={openConversation}
          language={i18n.language}
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
  };
  const openSearch = () => {
    onSearch();
  };
  const expandHistory = () => {
    if (!mobileOpen) onExpandedChange(true);
  };
  const openHistoryDialog = () => {
    onHistory();
  };
  const openManager = (event: React.MouseEvent<HTMLButtonElement>) => {
    onManage(event.currentTarget);
  };
  const openSettings = (event: React.MouseEvent<HTMLButtonElement>) => {
    onSettings(event.currentTarget);
  };
  const recentEntries = historyEntries.slice(0, 12);
  const hasMoreHistory = historyEntries.length > recentEntries.length;
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
        <RailButton label={t("history")} onClick={expandHistory} active={expanded}>
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
              <PanelLeftClose size={17} />
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
                  onClick={openHistoryDialog}
                >
                  {t("more")}
                </button>
              </div>
              {recentEntries.length ? (
                <>
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
                        }}
                      >
                        <History size={15} />
                        <span className="recent-conversation-copy">
                          <span className="recent-conversation-title" aria-hidden="true">
                            {entry.title}
                          </span>
                          {entry.archived ? (
                            <span className="conversation-state-badge is-inline">
                              <Archive size={11} />
                              {t("archived")}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                  {hasMoreHistory ? (
                    <button
                      className="text-button recent-conversation-more"
                      type="button"
                      onClick={openHistoryDialog}
                    >
                      {t("more")}
                    </button>
                  ) : null}
                </>
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
  entries,
  openingId,
  onOpenConversation,
  language,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: StudioMessage[];
  entries: HistoryEntry[];
  openingId: string | null;
  onOpenConversation: (id: string) => void;
  language: string;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const normalized = query.trim().toLowerCase();
  const messageResults = normalized
    ? messages.filter((message) =>
        message.content.toLowerCase().includes(normalized),
      )
    : [];
  const conversationResults = normalized
    ? entries.filter((entry) => entry.title.toLowerCase().includes(normalized))
    : entries.slice(0, 5);
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
            {conversationResults.length ? (
              <section className="search-group" aria-label={t("searchConversations")}>
                <div className="search-group-heading">{t("searchConversations")}</div>
                <div className="search-results">
                  {conversationResults.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="search-result search-conversation-result"
                      onClick={() => onOpenConversation(entry.id)}
                      disabled={Boolean(openingId)}
                      aria-busy={openingId === entry.id || undefined}
                    >
                      <span className="history-item-icon"><History size={14} /></span>
                      <span className="search-result-copy">
                        <strong>{entry.title}</strong>
                        <small>{formatHistoryTimestamp(entry.updatedAt, language)}</small>
                      </span>
                      {openingId === entry.id ? <LoaderCircle size={15} className="spin" /> : <ChevronRight size={15} />}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {messageResults.length ? (
              <section className="search-group" aria-label={t("searchMessages")}>
                <div className="search-group-heading">{t("searchMessages")}</div>
                <div className="search-results">
                  {messageResults.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      className="search-result"
                      onClick={() => jumpToMessage(message.id)}
                    >
                      <span className="search-result-role">
                        {message.role === "USER" ? t("you") : t("digitalEmployee")}
                      </span>
                      <span>{message.content}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {!conversationResults.length && !messageResults.length ? (
              <div className="utility-empty">{query.trim() ? t("noSearchResults") : t("searchPrompt")}</div>
            ) : null}
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
  const openHistoryEntry = (id: string) => {
    onOpenChange(false);
    void onOpenConversation(id);
  };
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
                    onClick={() => openHistoryEntry(entry.id)}
                    disabled={Boolean(openingId)}
                    aria-busy={openingId === entry.id || undefined}
                  >
                    <span className="history-item-icon">
                      <History size={15} />
                    </span>
                    <span className="history-item-copy">
                      <span className="history-item-title-row">
                        <strong>{entry.title}</strong>
                        {entry.archived ? (
                          <span className="conversation-state-badge is-inline">
                            <Archive size={11} />
                            {t("archived")}
                          </span>
                        ) : null}
                      </span>
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

function MessageBlock({
  message,
  expanded,
  onToggle,
  onCitation,
  onCopy,
  onRetry,
  onCancelRun,
  onAudit,
  onApproval,
  readOnly,
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
  onCancelRun: (runId: string) => void;
  onAudit: (runId: string) => void;
  onApproval: (message: StudioMessage, approved: boolean) => void;
  readOnly: boolean;
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
  const canViewAudit = Boolean(message.runId && !message.runId.startsWith("pending-"));
  const failed = message.runState === "failed" || message.runState === "timedOut" || message.runState === "interrupted";
  const canRetry = Boolean(
    !readOnly &&
    message.runId &&
      (!message.runId.startsWith("pending-") || Boolean(message.retryInput)) &&
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
                readOnly ||
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
                readOnly ||
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
      {message.content || canRetry || canCancel || canViewAudit ? (
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
          {canViewAudit && message.runId ? (
            <IconButton label={t("runDetails")} onClick={() => onAudit(message.runId!)}>
              <Activity size={14} />
            </IconButton>
          ) : null}
          {canCancel && message.runId ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="icon-button" type="button" aria-label={t("more")} title={t("more")}>
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" align="start" sideOffset={6}>
                  <DropdownMenu.Item
                    className="menu-item danger"
                    disabled={cancelling}
                    onSelect={() => onCancelRun(message.runId!)}
                  >
                    {cancelling ? <LoaderCircle size={14} className="spin" /> : <CircleStop size={14} />}
                    {t("stop")}
                  </DropdownMenu.Item>
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
  backendUnhealthy,
  persistenceUnavailable,
  modelReady,
  agentModelOverrideUnavailable,
  connecting,
  reconnecting,
  onReconnect,
  onOpenModels,
  onOpenAgents,
  onOpenNodes,
  textareaRef,
  t,
  onAttach,
  attachments,
  onRemoveAttachment,
  composerNotice,
  localExecutorRecoveryRequired,
  preflighting,
  skillPreflight: _skillPreflight,
  agentToolAllowList: _agentToolAllowList,
  toolsQuery,
  knowledgeBasesQuery,
  skillsQuery,
  mcpQuery,
  nodesQuery,
  models,
  activeModelProfileId,
  onModelChange,
  capabilityState,
  empty,
  onCapabilityChange,
  onCapabilityMenuOpen,
  approvalMode,
  onApprovalModeChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  stopping: boolean;
  backendAvailable: boolean;
  backendUnhealthy: boolean;
  persistenceUnavailable: boolean;
  modelReady: boolean;
  agentModelOverrideUnavailable: boolean;
  connecting: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
  onOpenModels: () => void;
  onOpenAgents: () => void;
  onOpenNodes: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  t: (key: string) => string;
  onAttach: (files: File[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  composerNotice: string | null;
  localExecutorRecoveryRequired: boolean;
  preflighting: boolean;
  skillPreflight: SkillPreflight | null;
  agentToolAllowList?: string[];
  toolsQuery: { data?: Tool[] };
  knowledgeBasesQuery: { data?: KnowledgeBase[] };
  skillsQuery: { data?: Skill[] };
  mcpQuery: { data?: McpConnection[] };
  nodesQuery: { data?: NodeConnection[] };
  models: ModelProfile[];
  activeModelProfileId?: string | null;
  onModelChange: (modelId: string) => void;
  capabilityState: CapabilityState;
  empty: boolean;
  onCapabilityChange: (state: CapabilityState) => void;
  onCapabilityMenuOpen: () => void;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const mentionStartRef = useRef<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillPickerQuery, setSkillPickerQuery] = useState("");
  const [fileAccept, setFileAccept] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [textareaRef, value]);
  const registeredOnlineNodes = (nodesQuery.data ?? []).filter(
    (node) =>
      node.kind !== "MANAGED_LOCAL" &&
      node.enabled &&
      node.status?.toUpperCase() === "ONLINE",
  );

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
    ...registeredOnlineNodes
      .filter((node) => node.id === capabilityState.nodeId)
      .map((node) => ({ id: node.id, label: node.name, kind: t("nodes"), key: "nodeId" as const })),
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
  const handlePromptChange = (nextValue: string, cursorPosition: number) => {
    onChange(nextValue);
    const beforeCursor = nextValue.slice(0, cursorPosition);
    const mentionMatch = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
    if (!mentionMatch) {
      mentionStartRef.current = null;
      setSkillPickerQuery("");
      setSkillPickerOpen(false);
      return;
    }
    mentionStartRef.current = cursorPosition - mentionMatch[2].length - 1;
    setSkillPickerQuery(mentionMatch[2]);
    setSkillPickerOpen(true);
  };
  const handleSkillSelect = (skill: Skill) => {
    const mentionStart = mentionStartRef.current;
    const selected = capabilityState.skillIds.includes(skill.id);
    onCapabilityChange({
      ...capabilityState,
      skillIds: selected && mentionStart === null
        ? capabilityState.skillIds.filter((id) => id !== skill.id)
        : selected
          ? capabilityState.skillIds
          : [...capabilityState.skillIds, skill.id],
    });
    if (mentionStart !== null) {
      const textarea = textareaRef.current;
      const cursorPosition = textarea?.selectionStart ?? value.length;
      const nextValue = `${value.slice(0, mentionStart)}@${skill.name} ${value.slice(cursorPosition)}`;
      onChange(nextValue);
      window.setTimeout(() => {
        const nextCursor = mentionStart + skill.name.length + 2;
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      }, 0);
      mentionStartRef.current = null;
    }
    setSkillPickerQuery("");
    setSkillPickerOpen(false);
  };
  return (
    <div className={`composer-wrap ${empty ? "is-empty-composer" : ""}`}>
      <div
        className={`composer ${dragActive ? "is-drag-active" : ""} ${readOnly ? "is-readonly" : ""}`}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          if (readOnly) return;
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          if (readOnly) return;
        }}
        onDragLeave={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (readOnly) return;
          const files = Array.from(event.dataTransfer.files);
          if (!files.length) return;
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
          accept={fileAccept}
          disabled={readOnly}
          onChange={(event) => {
            if (readOnly) {
              event.currentTarget.value = "";
              return;
            }
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
                <button
                  type="button"
                  aria-label={`${t("removeCapability")} ${chip.label}`}
                  title={t("removeCapability")}
                  disabled={readOnly}
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
                  disabled={readOnly}
                  onClick={() => onRemoveAttachment(file.id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => handlePromptChange(event.target.value, event.target.selectionStart)}
            onPaste={(event) => {
              if (readOnly) return;
              const files = Array.from(event.clipboardData.files);
              if (!files.length) return;
              event.preventDefault();
              onAttach(files);
            }}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            aria-disabled={readOnly}
            placeholder={t("placeholder")}
            rows={1}
            aria-label={t("placeholder")}
          />
        </div>
        <div className="composer-action-row">
          <div className="composer-action-left">
            <ComposerPlusMenu
              disabled={readOnly}
              t={t}
              tools={builtInTools}
              skills={skillsQuery.data ?? []}
              mcpConnections={mcpQuery.data ?? []}
              state={capabilityState}
              onCapabilityChange={onCapabilityChange}
              onOpen={onCapabilityMenuOpen}
              onOpenFiles={(accept) => {
                setFileAccept(accept);
                window.setTimeout(() => fileRef.current?.click(), 0);
              }}
            />
            <ApprovalModeMenu
              approvalMode={approvalMode}
              onApprovalModeChange={onApprovalModeChange}
              t={t}
              disabled={readOnly}
            />
            <SkillPickerMenu
              skills={skillsQuery.data ?? []}
              selectedSkillIds={capabilityState.skillIds}
              query={skillPickerQuery}
              open={skillPickerOpen}
              onOpenChange={(open) => {
                if (open) onCapabilityMenuOpen();
                if (!open) mentionStartRef.current = null;
                setSkillPickerOpen(open);
                if (!open) setSkillPickerQuery("");
              }}
              onQueryChange={setSkillPickerQuery}
              onSelect={handleSkillSelect}
              disabled={readOnly}
              t={t}
              showTrigger={false}
            />
          </div>
          <div className="composer-action-controls">
          <ComposerModelMenu
            models={models}
            activeModelProfileId={activeModelProfileId}
            onModelChange={onModelChange}
            disabled={readOnly}
            t={t}
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
                preflighting || readOnly || !backendAvailable || !modelReady || (!value.trim() && !attachments.length)
              }
              aria-label={preflighting ? t("preflightingSkills") : t("send")}
            >
              {preflighting ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} />}
            </button>
          )}
          </div>
        </div>
        {readOnly ? (
          <div className="composer-state" role="status" aria-live="polite">
            <Archive size={13} />
            <span>{t("conversationArchivedHint")}</span>
          </div>
        ) : null}
        {!backendAvailable || connecting ? (
          <div className="composer-status">
            {connecting ? <LoaderCircle size={12} className="spin" /> : <span className="context-dot" data-online={backendAvailable} />}
            <span>{connecting ? t("connecting") : persistenceUnavailable ? t("backendPersistenceUnavailable") : backendUnhealthy ? t("backendUnhealthy") : t("offline")}</span>
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
        {backendAvailable && !modelReady ? (
          <div className="composer-status composer-status-warning" role="status">
            <CircleAlert size={13} />
            <span>{t(agentModelOverrideUnavailable ? "agentModelOverrideUnavailableHint" : "modelSetupHint")}</span>
            <button
              type="button"
              className="connection-retry"
              onClick={agentModelOverrideUnavailable ? onOpenAgents : onOpenModels}
            >
              {t(agentModelOverrideUnavailable ? "configureAgent" : "configureModel")}
            </button>
          </div>
        ) : null}
        {composerNotice ? (
          <div className="composer-notice" role="status" aria-live="polite">
            <CircleAlert size={13} />
            <span>{composerNotice}</span>
            {localExecutorRecoveryRequired ? (
              <button type="button" className="connection-retry" onClick={onOpenNodes}>
                {t("localExecutorCapabilities")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerPlusMenu({
  disabled,
  t,
  tools,
  skills,
  mcpConnections,
  state,
  onCapabilityChange,
  onOpen,
  onOpenFiles,
}: {
  disabled: boolean;
  t: (key: string) => string;
  tools: Tool[];
  skills: Skill[];
  mcpConnections: McpConnection[];
  state: CapabilityState;
  onCapabilityChange: (state: CapabilityState) => void;
  onOpen: () => void;
  onOpenFiles: (accept?: string) => void;
}) {
  const availableSkills = skills.filter((skill) => skill.enabled);
  const availableConnections = mcpConnections.filter((connection) => connection.enabled);
  const toggle = (key: CapabilityArrayKey, id: string, checked: boolean) =>
    onCapabilityChange({
      ...state,
      [key]: checked
        ? [...state[key], id]
        : state[key].filter((value) => value !== id),
    });
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(open) => { if (open) onOpen(); }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="composer-plus-trigger"
          aria-label={t("attachMenu")}
          title={t("attachMenu")}
          disabled={disabled}
        >
          <Plus size={22} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu composer-plus-menu" align="start" side="top" sideOffset={10}>
          <DropdownMenu.Item className="composer-plus-item" onSelect={() => onOpenFiles()}>
            <Paperclip size={18} />
            <span>{t("filesAndImages")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="composer-plus-item">
              <Plug size={18} />
              <span>{t("plugins")}</span>
              <ChevronRight size={15} className="composer-plus-chevron" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu composer-plus-submenu" sideOffset={6}>
                {availableConnections.length ? availableConnections.map((connection) => {
                  const selected = state.mcpServerIds.includes(connection.id);
                  return (
                    <DropdownMenu.CheckboxItem
                      key={connection.id}
                      className="composer-plus-item"
                      checked={selected}
                      onCheckedChange={(checked) => toggle("mcpServerIds", connection.id, checked)}
                    >
                      <Plug size={16} />
                      <span>{connection.name}</span>
                      <DropdownMenu.ItemIndicator className="item-indicator"><Check size={14} /></DropdownMenu.ItemIndicator>
                    </DropdownMenu.CheckboxItem>
                  );
                }) : (
                  <DropdownMenu.Item className="composer-plus-item" disabled>
                    <Plug size={16} />
                    <span>{t("pluginsEmpty")}</span>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="composer-plus-item">
              <Sparkles size={18} />
              <span>{t("skills")}</span>
              <ChevronRight size={15} className="composer-plus-chevron" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu composer-plus-submenu" sideOffset={6}>
                {availableSkills.length ? availableSkills.map((skill) => (
                  <DropdownMenu.CheckboxItem
                    key={skill.id}
                    className="composer-plus-item"
                    checked={state.skillIds.includes(skill.id)}
                    onCheckedChange={(checked) => toggle("skillIds", skill.id, checked)}
                  >
                    <Sparkles size={16} />
                    <span>{skill.name}</span>
                    <DropdownMenu.ItemIndicator className="item-indicator"><Check size={14} /></DropdownMenu.ItemIndicator>
                  </DropdownMenu.CheckboxItem>
                )) : (
                  <DropdownMenu.Item className="composer-plus-item" disabled>
                    <Sparkles size={16} />
                    <span>{t("skillsEmpty")}</span>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="composer-plus-item">
              <Wrench size={18} />
              <span>{t("builtInTools")}</span>
              <ChevronRight size={15} className="composer-plus-chevron" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu composer-plus-submenu" sideOffset={6}>
                {tools.length ? tools.map((tool) => (
                  <DropdownMenu.CheckboxItem
                    key={tool.name}
                    className="composer-plus-item"
                    checked={state.toolNames.includes(tool.name)}
                    onCheckedChange={(checked) => toggle("toolNames", tool.name, checked)}
                  >
                    <Wrench size={16} />
                    <span>{tool.name}</span>
                    <DropdownMenu.ItemIndicator className="item-indicator"><Check size={14} /></DropdownMenu.ItemIndicator>
                  </DropdownMenu.CheckboxItem>
                )) : (
                  <DropdownMenu.Item className="composer-plus-item" disabled>
                    <Wrench size={16} />
                    <span>{t("noCapabilities")}</span>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="composer-plus-item">
              <Target size={18} />
              <span>{t("goals")}</span>
              <ChevronRight size={15} className="composer-plus-chevron" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu composer-plus-submenu">
                <DropdownMenu.Item className="composer-plus-item" disabled>
                  <Target size={16} />
                  <span>{t("goalsEmpty")}</span>
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SkillPickerMenu({
  skills,
  selectedSkillIds,
  query,
  open,
  onOpenChange,
  onQueryChange,
  onSelect,
  disabled,
  t,
  showTrigger = true,
}: {
  skills: Skill[];
  selectedSkillIds: string[];
  query: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (skill: Skill) => void;
  disabled: boolean;
  t: (key: string) => string;
  showTrigger?: boolean;
}) {
  const availableSkills = skills.filter((skill) => skill.enabled);
  const filteredSkills = availableSkills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {showTrigger ? <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`skill-picker-trigger ${selectedSkillIds.length ? "has-selection" : ""}`}
          aria-label={t("skills")}
          title={t("skills")}
          disabled={disabled}
        >
          <Sparkles size={17} />
          {selectedSkillIds.length ? <span className="skill-picker-count">{selectedSkillIds.length}</span> : null}
        </button>
      </DropdownMenu.Trigger> : null}
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu skill-picker-menu" align="start" side="top" sideOffset={10}>
          <div className="skill-picker-heading">
            <div>
              <DropdownMenu.Label className="menu-label">{t("skills")}</DropdownMenu.Label>
              <p>{t("skillPickerHint")}</p>
            </div>
            {selectedSkillIds.length ? <span className="skill-picker-selected-count">{selectedSkillIds.length}</span> : null}
          </div>
          <label className="skill-picker-search">
            <Search size={14} />
            <span className="visually-hidden">{t("searchSkills")}</span>
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t("searchSkills")}
            />
          </label>
          <div className="skill-picker-list" role="group" aria-label={t("skills")}>
            {filteredSkills.length ? filteredSkills.map((skill) => {
              const selected = selectedSkillIds.includes(skill.id);
              return (
                <DropdownMenu.Item
                  className="skill-picker-item"
                  key={skill.id}
                  onSelect={() => onSelect(skill)}
                >
                  <span className={`skill-picker-check ${selected ? "is-selected" : ""}`} aria-hidden="true">
                    {selected ? <Check size={13} /> : null}
                  </span>
                  <span className="skill-picker-item-copy">
                    <strong>{skill.name}</strong>
                    <small>{skill.description || t("skillNoDescription")}</small>
                  </span>
                </DropdownMenu.Item>
              );
            }) : (
              <div className="skill-picker-empty">
                <Sparkles size={16} />
                <span>{availableSkills.length ? t("noMatchingSkills") : t("skillsEmpty")}</span>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ComposerModelMenu({
  models,
  activeModelProfileId,
  onModelChange,
  disabled,
  t,
}: {
  models: ModelProfile[];
  activeModelProfileId?: string | null;
  onModelChange: (modelId: string) => void;
  disabled: boolean;
  t: (key: string) => string;
}) {
  const activeModel = models.find((model) => model.id === activeModelProfileId);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="composer-model-trigger" disabled={disabled} aria-label={t("models")}>
          <Cpu size={15} />
          <span>{activeModel?.modelName ?? t("modelEmpty")}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu composer-model-menu" align="end" side="top" sideOffset={10}>
          <DropdownMenu.Label className="menu-label">{t("models")}</DropdownMenu.Label>
          {models.length ? models.map((model) => (
            <DropdownMenu.Item className="menu-item" key={model.id} onSelect={() => onModelChange(model.id)}>
              <Cpu size={15} />
              <span className="menu-item-copy"><strong>{model.modelName}</strong><small>{model.providerType}</small></span>
              {model.id === activeModelProfileId ? <Check size={15} className="menu-item-check" /> : null}
            </DropdownMenu.Item>
          )) : (
            <DropdownMenu.Item className="menu-item" disabled><CircleAlert size={15} />{t("modelEmpty")}</DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ApprovalModeMenu({
  approvalMode,
  onApprovalModeChange,
  t,
  disabled,
}: {
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  t: (key: string) => string;
  disabled: boolean;
}) {
  const fullAccess = approvalMode === "full-access";
  const SelectedIcon = fullAccess ? ShieldAlert : ShieldCheck;

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`approval-mode-trigger ${fullAccess ? "is-full-access" : ""}`}
          aria-label={fullAccess ? t("fullAccess") : t("approvalOnRequest")}
          title={t("approvalMode")}
          disabled={disabled}
        >
          <SelectedIcon size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu approval-mode-menu" align="end" side="top" sideOffset={8}>
          <DropdownMenu.Label className="approval-mode-menu-title">
            {t("approvalMode")}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={approvalMode}
            onValueChange={(value) => onApprovalModeChange(value as ApprovalMode)}
          >
            <DropdownMenu.RadioItem value="on-request" className="approval-mode-item">
              <ShieldCheck size={16} />
              <span>
                <strong>{t("approvalOnRequest")}</strong>
                <small>{t("approvalOnRequestHint")}</small>
              </span>
              <DropdownMenu.ItemIndicator className="item-indicator">
                <Check size={14} />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="full-access" className="approval-mode-item">
              <Shield size={16} />
              <span>
                <strong>{t("fullAccess")}</strong>
                <small>{t("fullAccessHint")}</small>
              </span>
              <DropdownMenu.ItemIndicator className="item-indicator">
                <Check size={14} />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function CapabilityMenu({
  tools,
  knowledgeBases,
  skills,
  mcpConnections,
  nodes,
  state,
  onChange,
  onOpen,
  t,
  count,
  skillPreflight,
  approvalMode,
  onApprovalModeChange,
  disabled,
}: {
  tools: Tool[];
  knowledgeBases: KnowledgeBase[];
  skills: Skill[];
  mcpConnections: McpConnection[];
  nodes: NodeConnection[];
  state: CapabilityState;
  onChange: (state: CapabilityState) => void;
  onOpen: () => void;
  t: (key: string) => string;
  count: number;
  skillPreflight: SkillPreflight | null;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false);
  const toggle = (key: CapabilityArrayKey, id: string, checked: boolean) =>
    disabled
      ? undefined
      : onChange({
          ...state,
          [key]: checked
            ? [...state[key], id]
            : state[key].filter((item) => item !== id),
        });
  const clearSelection = () =>
    !disabled &&
    onChange({
      knowledgeBaseIds: [],
      skillIds: [],
      mcpServerIds: [],
      toolNames: [],
      nodeId: undefined,
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
    <DropdownMenu.Root onOpenChange={(open) => { if (open) onOpen(); }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="capability-button"
          aria-label={t("chooseCapability")}
          disabled={disabled}
        >
          <ShieldCheck size={16} />
          <span className="capability-button-label">
            {approvalMode === "full-access" ? t("fullAccess") : t("approvalOnRequest")}
          </span>
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
              <button type="button" className="capability-clear" onClick={clearSelection} disabled={disabled}>
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
                if (disabled) return;
                if (value === "full-access" && approvalMode !== "full-access") {
                  setConfirmingFullAccess(true);
                  return;
                }
                onApprovalModeChange(value as ApprovalMode);
              }}
            >
              <DropdownMenu.RadioItem value="on-request" className="capability-item" disabled={disabled}>
                <DropdownMenu.ItemIndicator className="item-indicator">
                  <Check size={13} />
                </DropdownMenu.ItemIndicator>
                <span>
                  <strong>{t("approvalOnRequest")}</strong>
                  <small>{t("approvalOnRequestHint")}</small>
                </span>
              </DropdownMenu.RadioItem>
              <DropdownMenu.RadioItem value="full-access" className="capability-item" disabled={disabled}>
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
                disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
            />
          ) : null}
          {nodes.length ? (
            <div className="capability-group">
              <div className="capability-group-title">
                {t("executionTarget")}
              </div>
              <DropdownMenu.RadioGroup
                value={state.nodeId ?? ""}
                onValueChange={(value) => {
                  if (disabled) return;
                  onChange({ ...state, nodeId: value || undefined });
                }}
              >
                {nodes.map((node) => (
                  <DropdownMenu.RadioItem
                    key={node.id}
                    value={node.id}
                    className="capability-item"
                    disabled={disabled}
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
  disabled,
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
  disabled: boolean;
}) {
  return (
    <div className="capability-group">
      <div className="capability-group-title">{title}</div>
      {items.map((item) => (
        <DropdownMenu.CheckboxItem
          key={item.id}
          className="capability-item"
          checked={item.checked}
          disabled={disabled}
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
  const [agentEditorDirty, setAgentEditorDirty] = useState(false);
  const [pendingConfigurationAction, setPendingConfigurationAction] = useState<{ type: "close" } | { type: "tab"; tab: string } | null>(null);
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
    enabled: tab === "nodes" && executionMode !== "PERSONAL_LOCAL",
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
    { id: "memory", icon: MemoryStick, label: t("memoryManagement") },
    { id: "personas", icon: UserRound, label: t("personaManagement"), hintKey: "personaHint" },
    { id: "skills", icon: Sparkles, label: t("skills") },
    { id: "mcp", icon: Globe2, label: t("mcp") },
    { id: "knowledge", icon: Database, label: t("knowledge") },
    { id: "models", icon: TerminalSquare, label: t("models") },
    {
      id: "nodes",
      icon: HardDrive,
      label: executionMode === "PERSONAL_LOCAL" ? t("localExecutorCapabilities") : t("nodes"),
      hintKey: executionMode === "PERSONAL_LOCAL" ? "localExecutorHint" : "nodesHint",
    },
  ];
  const requestClose = useCallback(() => {
    if (tab === "agents" && agentEditorDirty) {
      setPendingConfigurationAction({ type: "close" });
      return;
    }
    onClose();
  }, [agentEditorDirty, onClose, tab]);
  const requestTabChange = useCallback((nextTab: string) => {
    if (nextTab === tab) return;
    if (tab === "agents" && agentEditorDirty) {
      setPendingConfigurationAction({ type: "tab", tab: nextTab });
      return;
    }
    setTab(nextTab);
  }, [agentEditorDirty, setTab, tab]);
  const discardConfigurationChanges = () => {
    const action = pendingConfigurationAction;
    setPendingConfigurationAction(null);
    setAgentEditorDirty(false);
    if (!action) return;
    if (action.type === "close") onClose();
    else setTab(action.tab);
  };
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
        if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))) return;
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);
  return (
    <section className="configuration-workspace" aria-labelledby="configuration-title">
          <header className="configuration-header">
            <button
              className="configuration-back"
              type="button"
              aria-label={t("workspace")}
              title={t("workspace")}
              onClick={requestClose}
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
          </header>
          <Tabs.Root
            value={tab}
            onValueChange={requestTabChange}
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
              {tabs.map(({ id, label, hintKey }) => (
                <Tabs.Content
                  value={id}
                  key={id}
                  className={`configuration-content ${id === "agents" ? "configuration-content-agents" : ""}`}
                >
                  <ManagerPanelHeading
                    label={label}
                    id={id}
                    hintKey={hintKey}
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
                    onAgentDirtyChange={setAgentEditorDirty}
                    t={t}
                  />
                </Tabs.Content>
              ))}
            </div>
          </Tabs.Root>
          <ConfigurationUnsavedDialog open={Boolean(pendingConfigurationAction)} onOpenChange={(open) => { if (!open) setPendingConfigurationAction(null); }} onDiscard={discardConfigurationChanges} t={t} />
    </section>
  );
}

function ConfigurationUnsavedDialog({ open, onOpenChange, onDiscard, t }: { open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void; t: (key: string) => string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-unsaved-dialog" aria-describedby="configuration-unsaved-description">
        <div className="dialog-header"><div><Dialog.Title>{t("agentUnsavedTitle")}</Dialog.Title><Dialog.Description id="configuration-unsaved-description">{t("agentUnsavedHint")}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div>
        <div className="inline-form-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("agentKeepEditing")}</button></Dialog.Close><button type="button" className="danger-button" onClick={onDiscard}>{t("agentDiscardChanges")}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function ManagerPanelHeading({
  label,
  id,
  t,
  hintKey,
  onAdd,
  onRefresh,
}: {
  label: string;
  id: string;
  t: (key: string) => string;
  hintKey?: string;
  onAdd?: () => void;
  onRefresh: () => void;
}) {
  const resolvedHintKey = hintKey ?? `${id}Hint`;
  return (
    <div className="panel-heading">
      <div>
        <h3>{label}</h3>
        <p>{t(resolvedHintKey)}</p>
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
  onAgentDirtyChange,
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
  onAgentDirtyChange: (dirty: boolean) => void;
  t: (key: string) => string;
}) {
  if (id === "agents")
    return (
      <Suspense fallback={<div className="manager-placeholder"><LoaderCircle size={18} className="spin" /></div>}>
        <AgentManager agents={agents} models={models} skills={skills ?? []} tools={tools} query={queries.agents} t={t} onDirtyChange={onAgentDirtyChange} />
      </Suspense>
    );
  if (id === "memory")
    return (
      <Suspense
        fallback={
          <div className="manager-placeholder">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        }
      >
        <MemoryManager t={t} />
      </Suspense>
    );
  if (id === "personas")
    return (
      <Suspense fallback={<div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>}>
        <PersonaManager t={t} />
      </Suspense>
    );
  if (id === "skills")
    return (
      <Suspense
        fallback={
          <div className="manager-placeholder">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        }
      >
        <SkillsManager
          installed={skills ?? []}
          query={queries.skills}
          onToggle={onSkillToggle}
          t={t}
        />
      </Suspense>
    );
  if (id === "mcp")
    return (
      <Suspense
        fallback={
          <div className="manager-placeholder">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        }
      >
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
      </Suspense>
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
        <Suspense
          fallback={
            <div className="manager-placeholder">
              <LoaderCircle size={18} className="spin" />
              <span>{t("loading")}</span>
            </div>
          }
        >
          <KnowledgeManager
            bases={knowledgeBases ?? []}
            query={queries.knowledge}
            t={t}
          />
        </Suspense>
      </div>
    );
  if (id === "models")
    return (
      <Suspense
        fallback={
          <div className="manager-placeholder">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        }
      >
        <ModelManager
          models={models}
          onToggle={onModelToggle}
          onSetDefault={onSetDefault}
          t={t}
        />
      </Suspense>
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
        executionMode={executionMode}
        t={t}
      />
    </Suspense>
  );
}

function isExternalToolName(name: string) {
  return name.startsWith("mcp:") || name.startsWith("mcp_") || name.startsWith("node:") || name.startsWith("node_");
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

function idToQueryKey(id: string) {
  if (id === "memory") return ["memories"];
  if (id === "personas") return ["personas"];
  if (id === "skills") return ["skills"];
  if (id === "mcp") return ["mcp-connections"];
  if (id === "knowledge") return ["knowledge-bases"];
  if (id === "runtime") return ["execution-settings"];
  if (id === "nodes") return ["nodes"];
  if (id === "models") return ["models"];
  return ["agents"];
}

export default App;
