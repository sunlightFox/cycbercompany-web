import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MemoryStick,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioApi } from "../lib/api";
import type { AgentV2, MemoryItem, MemoryOrigin, MemoryScope, MemoryStatus, MemoryType, UserPersona } from "../types";

const memoryTypes: MemoryType[] = ["PROFILE", "SEMANTIC", "EPISODIC", "PROCEDURAL"];
const memoryStatuses: MemoryStatus[] = ["CANDIDATE", "CONFIRMED", "REJECTED"];
const sharedPersonaFilter = "__shared__";

type MemoryFormValues = {
  agentId: string;
  scope: MemoryScope;
  personaId: string;
  type: MemoryType;
  content: string;
  importance: number;
  expiresAt: string;
};

const memoryFormSchema = z.object({
  agentId: z.string().trim().min(1),
  scope: z.enum(["AGENT", "USER"]),
  personaId: z.string().trim().max(200),
  type: z.enum(memoryTypes),
  content: z.string().trim().min(1).max(4000),
  importance: z.number().min(0).max(1),
  expiresAt: z.string(),
});

const emptyForm: MemoryFormValues = {
  agentId: "",
  scope: "AGENT",
  personaId: "",
  type: "PROFILE",
  content: "",
  importance: 0.5,
  expiresAt: "",
};

export default function MemoryManager({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [agentId, setAgentId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const [type, setType] = useState<MemoryType | "">("");
  const [origin, setOrigin] = useState<MemoryOrigin | "">("");
  const [status, setStatus] = useState<MemoryStatus | "">("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const form = useForm<MemoryFormValues>({ defaultValues: emptyForm });

  const filters = useMemo(
    () => ({
      agentId: agentId || undefined,
      personaId: personaId || undefined,
      sharedOnly: sharedOnly || undefined,
      type: type || undefined,
      status: status || undefined,
      origin: origin || undefined,
      query: deferredQuery.trim() || undefined,
      limit: 100,
    }),
    [agentId, deferredQuery, origin, personaId, sharedOnly, status, type],
  );
  const memoriesQuery = useQuery({
    queryKey: ["memories", filters],
    queryFn: () => studioApi.listMemories(filters),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents-v2"],
    queryFn: studioApi.listAgentsV2,
  });
  const personasQuery = useQuery({
    queryKey: ["personas"],
    queryFn: studioApi.listPersonas,
  });
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const personas = useMemo(() => personasQuery.data ?? [], [personasQuery.data]);
  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.displayName])),
    [agents],
  );
  const personaNames = useMemo(
    () => new Map(personas.map((persona) => [persona.id, persona.name])),
    [personas],
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["memories"] });
  const mutationError = (failure: unknown) => {
    setNotice("");
    setError(failure instanceof Error && failure.message ? failure.message : t("memoryActionFailed"));
  };
  const saveMutation = useMutation({
    mutationFn: (values: MemoryFormValues) => {
      const expiresAt = values.expiresAt ? new Date(`${values.expiresAt}T23:59:59`).toISOString() : null;
      if (editing) {
        return studioApi.updateMemory(editing.id, {
          type: values.type,
          content: values.content.trim(),
          importance: values.importance,
          expiresAt,
          expectedRevision: editing.revision,
          scope: values.scope,
          personaId: values.scope === "USER" ? values.personaId || null : null,
        });
      }
      return studioApi.createMemory({
        agentId: values.agentId,
        scope: values.scope,
        personaId: values.scope === "USER" ? values.personaId || null : null,
        type: values.type,
        content: values.content.trim(),
        importance: values.importance,
        expiresAt,
      });
    },
    onSuccess: () => {
      setEditorOpen(false);
      setEditing(null);
      setError("");
      setNotice(t("memorySaved"));
      refresh();
    },
    onError: mutationError,
  });
  const confirmMutation = useMutation({
    mutationFn: studioApi.confirmMemory,
    onSuccess: () => {
      setError("");
      setNotice(t("memoryConfirmed"));
      refresh();
    },
    onError: mutationError,
  });
  const rejectMutation = useMutation({
    mutationFn: studioApi.rejectMemory,
    onSuccess: () => {
      setError("");
      setNotice(t("memoryRejected"));
      refresh();
    },
    onError: mutationError,
  });
  const deleteMutation = useMutation({
    mutationFn: studioApi.deleteMemory,
    onSuccess: () => {
      setDeleteTarget(null);
      setError("");
      setNotice(t("memoryDeleted"));
      refresh();
    },
    onError: mutationError,
  });
  const clearMutation = useMutation({
    mutationFn: () => studioApi.clearMemories(agentId || undefined, personaId || undefined, sharedOnly),
    onSuccess: (result) => {
      setClearOpen(false);
      setError("");
      setNotice(t("memoryCleared", { count: result.deleted }));
      refresh();
    },
    onError: mutationError,
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ ...emptyForm, agentId: agentId || agents.find((item) => item.status !== "ARCHIVED")?.id || "", personaId });
    setError("");
    setEditorOpen(true);
  };
  const openEdit = (memory: MemoryItem) => {
    setEditing(memory);
    form.reset({
      agentId: memory.agentId,
      scope: memory.scope,
      personaId: memory.personaId ?? "",
      type: memory.type,
      content: memory.content,
      importance: memory.importance,
      expiresAt: memory.expiresAt ? memory.expiresAt.slice(0, 10) : "",
    });
    setError("");
    setEditorOpen(true);
  };
  const submit = form.handleSubmit((values) => {
    const parsed = memoryFormSchema.safeParse(values);
    if (!parsed.success) {
      setError(t("memoryFormInvalid"));
      return;
    }
    saveMutation.mutate(parsed.data);
  });
  const resetFilters = () => {
    setQuery("");
    setAgentId("");
    setPersonaId("");
    setSharedOnly(false);
    setType("");
    setOrigin("");
    setStatus("");
  };
  const formatDate = (value: string | null) => {
    if (!value) return t("memoryNever");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language === "en" ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  };
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedPersona = personas.find((persona) => persona.id === personaId);
  const clearScopeLabel = [selectedAgent?.displayName, sharedOnly ? t("memoryGlobalPersona") : selectedPersona?.name].filter(Boolean).join(" · ");
  const memories = memoriesQuery.data ?? [];

  return (
    <div className="memory-manager">
      <div className="memory-toolbar">
        <label className="memory-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{t("memorySearch")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("memorySearchPlaceholder")} />
        </label>
        <button type="button" className="primary-button" onClick={openCreate} disabled={agentsQuery.isLoading || !agents.length}>
          <Plus size={15} />
          {t("memoryAdd")}
        </button>
      </div>

      <div className="memory-filters" aria-label={t("memoryFilters")}>
        <label>
          <span>{t("memoryAgent")}</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">{t("memoryAllAgents")}</option>
            {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}
          </select>
        </label>
        <label>
          <span>{t("memoryPersona")}</span>
          <select
            value={sharedOnly ? sharedPersonaFilter : personaId}
            onChange={(event) => {
              const value = event.target.value;
              setSharedOnly(value === sharedPersonaFilter);
              setPersonaId(value === sharedPersonaFilter ? "" : value);
            }}
          >
            <option value="">{t("memoryAllPersonas")}</option>
            <option value={sharedPersonaFilter}>{t("memoryGlobalPersona")}</option>
            {personas.map((persona) => <option value={persona.id} key={persona.id}>{persona.name}</option>)}
          </select>
        </label>
        <label>
          <span>{t("memoryType")}</span>
          <select value={type} onChange={(event) => setType(event.target.value as MemoryType | "")}>
            <option value="">{t("memoryAllTypes")}</option>
            {memoryTypes.map((value) => <option value={value} key={value}>{t(`memoryType${value}`)}</option>)}
          </select>
        </label>
        <label>
          <span>来源</span>
          <select value={origin} onChange={(event) => setOrigin(event.target.value as MemoryOrigin | "")}>
            <option value="">全部来源</option>
            <option value="USER_CREATED">用户创建</option>
            <option value="AUTO_EXTRACTED">自动提炼</option>
            <option value="AUTO_MERGED">自动合并</option>
          </select>
        </label>
        <label>
          <span>{t("memoryStatus")}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as MemoryStatus | "")}>
            <option value="">{t("memoryAllStatuses")}</option>
            {memoryStatuses.map((value) => <option value={value} key={value}>{t(`memoryStatus${value}`)}</option>)}
          </select>
        </label>
        <button type="button" className="quiet-button memory-reset" onClick={resetFilters}>{t("reset")}</button>
      </div>

      {notice ? <div className="manager-notice" role="status"><Check size={14} />{notice}</div> : null}
      {error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}

      {memoriesQuery.isLoading || agentsQuery.isLoading || personasQuery.isLoading ? (
        <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("memoryLoading")}</span></div>
      ) : memoriesQuery.isError || agentsQuery.isError || personasQuery.isError ? (
        <div className="manager-placeholder">
          <CircleAlert size={20} />
          <strong>{t("memoryLoadFailed")}</strong>
          <button type="button" className="secondary-button" onClick={() => { memoriesQuery.refetch(); agentsQuery.refetch(); personasQuery.refetch(); }}>{t("retry")}</button>
        </div>
      ) : memories.length === 0 ? (
        <div className="manager-placeholder memory-empty">
          <MemoryStick size={22} />
          <strong>{t("memoryEmpty")}</strong>
          <span>{t("memoryEmptyHint")}</span>
          {(query || agentId || personaId || sharedOnly || type || status) ? <button type="button" className="secondary-button" onClick={resetFilters}>{t("memoryClearFilters")}</button> : null}
        </div>
      ) : (
        <div className="memory-list" aria-live="polite">
          <div className="memory-list-summary">
            <span>{t("memoryResultCount", { count: memories.length })}</span>
            <button type="button" className="danger-text-button" onClick={() => setClearOpen(true)}>{agentId || personaId || sharedOnly ? t("memoryClearScope") : t("memoryClearAll")}</button>
          </div>
          {memories.map((memory) => (
            <article className="memory-row" key={memory.id}>
              <div className="memory-row-main">
                <div className="memory-row-meta">
                  <span className={`memory-status is-${memory.status.toLowerCase()}`}>{t(`memoryStatus${memory.status}`)}</span>
                  <span>{t(`memoryType${memory.type}`)}</span>
                  <span>{memory.origin === "USER_CREATED" ? "用户创建" : memory.origin === "AUTO_EXTRACTED" ? "自动提炼" : "自动合并"}</span>
                  <span>{agentNames.get(memory.agentId) ?? memory.agentId}</span>
                  <span>{memory.personaId ? personaNames.get(memory.personaId) ?? memory.personaId : t("memoryGlobalPersona")}</span>
                  {memory.sensitivity !== "NORMAL" ? <span className="memory-sensitive"><ShieldAlert size={13} />{t(`memorySensitivity${memory.sensitivity}`)}</span> : null}
                </div>
                <p>{memory.content}</p>
                <div className="memory-row-details">
                  <span>{t("memoryImportance", { value: Math.round(memory.importance * 100) })}</span>
                  <span><Clock3 size={13} />{t("memoryUpdated", { date: formatDate(memory.updatedAt) })}</span>
                  {memory.expiresAt ? <span>{t("memoryExpires", { date: formatDate(memory.expiresAt) })}</span> : null}
                </div>
                {memory.evidenceSummary ? <div className="memory-evidence"><strong>{t("memoryEvidence")}</strong><span>{memory.evidenceSummary}</span></div> : null}
              </div>
              <div className="memory-row-actions">
                {memory.status === "CANDIDATE" ? (
                  <>
                    <button type="button" className="secondary-button" onClick={() => confirmMutation.mutate(memory.id)} disabled={confirmMutation.isPending || rejectMutation.isPending}>
                      {confirmMutation.isPending && confirmMutation.variables === memory.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                      {t("memoryConfirm")}
                    </button>
                    <button type="button" className="quiet-button memory-reject-button" onClick={() => rejectMutation.mutate(memory.id)} disabled={confirmMutation.isPending || rejectMutation.isPending}>
                      {rejectMutation.isPending && rejectMutation.variables === memory.id ? <LoaderCircle size={14} className="spin" /> : <ShieldAlert size={14} />}
                      {t("memoryReject")}
                    </button>
                  </>
                ) : null}
                <button type="button" className="icon-button" aria-label={t("memoryEdit")} title={t("memoryEdit")} onClick={() => openEdit(memory)}><Pencil size={15} /></button>
                <button type="button" className="icon-button danger-icon-button" aria-label={t("memoryDelete")} title={t("memoryDelete")} onClick={() => setDeleteTarget(memory)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog.Root open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditing(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="utility-dialog memory-editor-dialog" aria-describedby="memory-editor-description">
            <div className="dialog-header">
              <div><Dialog.Title>{editing ? t("memoryEditTitle") : t("memoryCreateTitle")}</Dialog.Title><Dialog.Description id="memory-editor-description">{t("memoryEditorHint")}</Dialog.Description></div>
              <Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close>
            </div>
            <form className="memory-form" onSubmit={submit}>
              <label>
                <span>{t("memoryAgent")}</span>
                <select {...form.register("agentId")} disabled={Boolean(editing)} autoFocus={!editing}>
                  <option value="">{t("memorySelectAgent")}</option>
                  {agents.filter((agent) => agent.status !== "ARCHIVED" || agent.id === editing?.agentId).map((agent: AgentV2) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}
                </select>
              </label>
              <label>
                <span>记忆归属</span>
                <select {...form.register("scope")}>
                  <option value="AGENT">智能体记忆</option>
                  <option value="USER">用户记忆</option>
                </select>
                <small>智能体记忆会在该智能体的每次对话中可用；用户记忆可按画像限定。</small>
              </label>
              <label>
                <span>{t("memoryPersona")}</span>
                <select {...form.register("personaId")} disabled={form.watch("scope") === "AGENT"}>
                  <option value="">{t("memoryGlobalPersona")}</option>
                  {personas.map((persona: UserPersona) => <option value={persona.id} key={persona.id}>{persona.name}</option>)}
                </select>
                <small>{t("memoryPersonaHint")}</small>
              </label>
              <label>
                <span>{t("memoryType")}</span>
                <select {...form.register("type")} autoFocus={Boolean(editing)}>{memoryTypes.map((value) => <option value={value} key={value}>{t(`memoryType${value}`)}</option>)}</select>
              </label>
              <label className="memory-form-wide">
                <span>{t("memoryContent")}</span>
                <textarea {...form.register("content")} rows={6} maxLength={4000} placeholder={t("memoryContentPlaceholder")} />
              </label>
              <label>
                <span>{t("memoryImportanceLabel")}</span>
                <input type="number" min="0" max="1" step="0.1" {...form.register("importance", { valueAsNumber: true })} />
                <small>{t("memoryImportanceHint")}</small>
              </label>
              <label>
                <span>{t("memoryExpiration")}</span>
                <input type="date" {...form.register("expiresAt")} min={new Date().toISOString().slice(0, 10)} />
                <small>{t("memoryExpirationHint")}</small>
              </label>
              <div className="inline-form-actions memory-form-wide">
                <Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close>
                <button type="submit" className="primary-button" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                  {editing ? t("save") : t("memoryCreate")}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("memoryDeleteTitle")}
        description={t("memoryDeleteHint", { content: deleteTarget?.content ?? "" })}
        confirmLabel={t("memoryDelete")}
        busy={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        t={t}
      />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={agentId || personaId || sharedOnly ? t("memoryClearScopeTitle") : t("memoryClearAllTitle")}
        description={agentId || personaId || sharedOnly ? t("memoryClearScopeHint", { scope: clearScopeLabel || t("memorySelectedScope") }) : t("memoryClearAllHint")}
        confirmLabel={agentId || personaId || sharedOnly ? t("memoryClearScope") : t("memoryClearAll")}
        busy={clearMutation.isPending}
        onConfirm={() => clearMutation.mutate()}
        t={t}
      />
    </div>
  );
}

function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, busy, onConfirm, t }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  t: (key: string) => string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="utility-dialog memory-confirm-dialog" aria-describedby="memory-confirm-description">
          <div className="dialog-header">
            <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description id="memory-confirm-description">{description}</Dialog.Description></div>
            <Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close>
          </div>
          <div className="inline-form-actions">
            <Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close>
            <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{confirmLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
