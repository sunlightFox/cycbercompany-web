import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, CircleAlert, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Agent, AgentManifestV2, AgentV2, ModelProfile, Skill, Tool } from "../types";
import { StudioApiError, studioApi } from "../lib/api";

type Translate = (key: string) => string;
const editorSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  role: z.string().trim().min(1).max(240),
  mission: z.string().trim().min(1).max(600),
  instructions: z.string().trim().max(12000),
});
type EditorValues = z.infer<typeof editorSchema>;

export function AgentManager({ agents: _agents, models, skills: _skills, tools: _tools, query: _query, t, onDirtyChange }: {
  agents: Agent[]; models: ModelProfile[]; skills: Skill[]; tools: Tool[]; query: { isLoading: boolean; isError: boolean; refetch: () => unknown }; t: Translate; onDirtyChange?: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents-v2"], queryFn: studioApi.listAgentsV2 });
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const form = useForm<EditorValues>({ resolver: zodResolver(editorSchema), defaultValues: emptyValues() });
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && agents[0]) setSelectedId(agents[0].id);
    if (selectedId && !agents.some((agent) => agent.id === selectedId)) setSelectedId(agents[0]?.id ?? "");
  }, [agents, selectedId]);
  useEffect(() => {
    if (selected) form.reset(valuesFromAgent(selected));
  }, [form, selected]);
  useEffect(() => { onDirtyChange?.(form.formState.isDirty); return () => onDirtyChange?.(false); }, [form.formState.isDirty, onDirtyChange]);

  const visibleAgents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return agents.filter((agent) => agent.status !== "ARCHIVED" && (!term || `${agent.displayName} ${agent.description} ${agent.category}`.toLowerCase().includes(term)));
  }, [agents, search]);
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["agents-v2"] }), queryClient.invalidateQueries({ queryKey: ["agents"] })]); };
  const publish = async (agent: AgentV2, manifest: AgentManifestV2) => {
    const draft = agent.latestDraft ?? await studioApi.createAgentV2Draft(agent.id);
    const saved = await studioApi.updateAgentV2Manifest(agent.id, draft.id, { manifest, expectedRevision: draft.revision });
    await studioApi.publishAgentV2Draft(agent.id, saved.id);
  };
  const saveMutation = useMutation({
    mutationFn: async (values: EditorValues) => { if (!selected) throw new Error(t("agentSelectRequired")); await publish(selected, manifestWithValues(selected, values, models)); },
    onSuccess: async () => { await refresh(); form.reset(form.getValues()); setNotice("已保存并立即可用"); setError(""); },
    onError: (cause) => setError(errorMessage(cause, "保存失败，请稍后重试。")),
  });
  const createMutation = useMutation({
    mutationFn: async (values: EditorValues) => {
      const created = await studioApi.createAgentV2({ manifest: defaultManifest(values, models), visibility: "PRIVATE" });
      const draft = created.latestDraft;
      if (!draft) throw new Error("数字员工创建成功，但未能初始化可发布版本。");
      await studioApi.publishAgentV2Draft(created.id, draft.id);
      return created;
    },
    onSuccess: async (agent) => { await refresh(); setSelectedId(agent.id); setCreateOpen(false); form.reset(valuesFromAgent(agent)); setNotice("数字员工已创建，当前即可使用"); setError(""); },
    onError: (cause) => setError(errorMessage(cause, "创建失败，请稍后重试。")),
  });
  const deleteMutation = useMutation({
    mutationFn: async () => { if (!selected) throw new Error(t("agentSelectRequired")); return studioApi.archiveAgentV2(selected.id); },
    onSuccess: async () => { setSelectedId(""); setDeleteOpen(false); await refresh(); setNotice("数字员工已删除"); setError(""); },
    onError: (cause) => setError(errorMessage(cause, "删除失败，请稍后重试。")),
  });
  if (agentsQuery.isLoading) return <ManagerState loading text={t("loading")} />;
  if (agentsQuery.isError) return <ManagerState text={t("loadFailed")} action={t("retryLoad")} onAction={() => void agentsQuery.refetch()} />;

  return <div className="agent-simple-manager">
    <aside className="agent-simple-list" aria-label={t("agents")}>
      <div className="agent-simple-list-header"><div><strong>{t("agents")}</strong><small>选择当前工作台使用的数字员工</small></div><button type="button" className="primary-button" onClick={() => { setError(""); setCreateOpen(true); }}><Plus size={15} />创建</button></div>
      <label className="agent-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t("search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索数字员工" /></label>
      <div className="agent-simple-list-items">{visibleAgents.map((agent) => <button type="button" key={agent.id} onClick={() => setSelectedId(agent.id)} className={`agent-simple-item ${agent.id === selectedId ? "is-active" : ""}`}><span className="agent-avatar"><Bot size={16} /></span><span><strong>{agent.displayName}</strong><small>{agent.description || "等待设置人设"}</small></span><i aria-label="可用" title="可用" /></button>)}{!visibleAgents.length ? <div className="agent-catalog-empty">暂无数字员工</div> : null}</div>
    </aside>
    <section className="agent-simple-content">
      {notice ? <div className="manager-notice success" role="status"><CheckCircle2 size={14} />{notice}</div> : null}{error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}
      {selected ? <AgentEditor agent={selected} form={form} pending={saveMutation.isPending} onSave={() => void form.handleSubmit((values) => saveMutation.mutate(values))()} onDelete={() => setDeleteOpen(true)} /> : <div className="agent-simple-empty"><Bot size={22} /><strong>选择一个数字员工开始设置</strong><span>或创建一个新的数字员工。</span></div>}
    </section>
    <CreateDialog open={createOpen} pending={createMutation.isPending} error={error} onOpenChange={setCreateOpen} onSubmit={(values) => createMutation.mutate(values)} />
    <DeleteDialog open={deleteOpen} pending={deleteMutation.isPending} name={selected?.displayName ?? ""} onOpenChange={setDeleteOpen} onDelete={() => deleteMutation.mutate()} />
  </div>;
}

function AgentEditor({ agent, form, pending, onSave, onDelete }: { agent: AgentV2; form: ReturnType<typeof useForm<EditorValues>>; pending: boolean; onSave: () => void; onDelete: () => void }) {
  return <form className="agent-simple-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <header><div><span className="agent-simple-available"><i />可用</span><h3>{agent.displayName}</h3><p>工具、Skills 和工作台能力已默认可用，无需逐项配置。</p></div><button type="button" className="secondary-button danger-text" onClick={onDelete}><Trash2 size={14} />删除</button></header>
    <section><div className="agent-simple-section-title"><h4>基础信息</h4><span>让团队知道它能做什么</span></div><div className="agent-simple-fields"><Field label="名称" error={form.formState.errors.displayName?.message}><input {...form.register("displayName")} /></Field><Field label="一句话介绍" error={form.formState.errors.description?.message}><input {...form.register("description")} placeholder="例如：协助整理项目与跟进事项" /></Field></div></section>
    <section><div className="agent-simple-section-title"><h4>人设</h4><span>决定它如何思考和表达</span></div><div className="agent-simple-fields"><Field label="角色" error={form.formState.errors.role?.message}><input {...form.register("role")} placeholder="例如：专业、可靠的项目助理" /></Field><Field label="主要任务" error={form.formState.errors.mission?.message}><textarea rows={3} {...form.register("mission")} placeholder="它会帮助用户完成什么？" /></Field><Field wide label="补充要求（可选）" error={form.formState.errors.instructions?.message}><textarea rows={6} {...form.register("instructions")} placeholder="例如：先给出结论，再列出关键依据；不确定时主动说明。" /></Field></div></section>
    <footer><span>保存后会立即生效</span><button type="submit" className="primary-button" disabled={pending || !form.formState.isDirty}>{pending ? <LoaderCircle size={15} className="spin" /> : null}{pending ? "保存中" : "保存并启用"}</button></footer>
  </form>;
}
function CreateDialog({ open, pending, error, onOpenChange, onSubmit }: { open: boolean; pending: boolean; error: string; onOpenChange: (open: boolean) => void; onSubmit: (values: EditorValues) => void }) {
  const form = useForm<EditorValues>({ resolver: zodResolver(editorSchema), defaultValues: emptyValues() });
  useEffect(() => { if (!open) form.reset(emptyValues()); }, [form, open]);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-simple-dialog" aria-describedby="agent-create-description"><div className="dialog-header"><div><Dialog.Title>创建数字员工</Dialog.Title><Dialog.Description id="agent-create-description">填写基础信息和人设，创建后立即可用。</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭"><X size={17} /></button></Dialog.Close></div><form className="agent-simple-create" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(onSubmit)(); }}>{error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}<Field label="名称" error={form.formState.errors.displayName?.message}><input autoFocus {...form.register("displayName")} placeholder="例如：项目助理" /></Field><Field label="一句话介绍" error={form.formState.errors.description?.message}><input {...form.register("description")} placeholder="例如：协助整理项目与跟进事项" /></Field><Field label="角色" error={form.formState.errors.role?.message}><input {...form.register("role")} placeholder="例如：专业、可靠的项目助理" /></Field><Field label="主要任务" error={form.formState.errors.mission?.message}><textarea rows={3} {...form.register("mission")} placeholder="它会帮助用户完成什么？" /></Field><Field label="补充要求（可选）" error={form.formState.errors.instructions?.message}><textarea rows={4} {...form.register("instructions")} /></Field><div className="agent-simple-default-note"><CheckCircle2 size={15} />创建后默认拥有工作台中已启用工具和 Skills 的使用权限。</div><div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => onOpenChange(false)}>取消</button><button type="submit" className="primary-button" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}{pending ? "创建中" : "创建并启用"}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function DeleteDialog({ open, pending, name, onOpenChange, onDelete }: { open: boolean; pending: boolean; name: string; onOpenChange: (open: boolean) => void; onDelete: () => void }) { return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-delete-dialog"><div className="dialog-header"><div><Dialog.Title>删除数字员工？</Dialog.Title><Dialog.Description>“{name}”将不再可用，此操作不可撤销。</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭"><X size={17} /></button></Dialog.Close></div><div className="inline-form-actions"><button type="button" className="secondary-button" onClick={() => onOpenChange(false)}>取消</button><button type="button" className="danger-button" disabled={pending} onClick={onDelete}>{pending ? "删除中" : "确认删除"}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>; }
function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: React.ReactNode }) { return <label className={`agent-simple-field ${wide ? "is-wide" : ""}`}><span>{label}</span>{children}{error ? <small className="form-error">{error}</small> : null}</label>; }
function ManagerState({ loading, text, action, onAction }: { loading?: boolean; text: string; action?: string; onAction?: () => void }) { return <div className="manager-placeholder agent-manager-state">{loading ? <LoaderCircle size={18} className="spin" /> : <CircleAlert size={18} />}<span>{text}</span>{action ? <button type="button" className="secondary-button" onClick={onAction}>{action}</button> : null}</div>; }
function emptyValues(): EditorValues { return { displayName: "", description: "", role: "", mission: "", instructions: "" }; }
function valuesFromAgent(agent: AgentV2): EditorValues { const persona = agent.latestDraft?.manifest.persona ?? agent.currentPublishedVersion?.manifest.persona; const identity = agent.latestDraft?.manifest.identity ?? agent.currentPublishedVersion?.manifest.identity; return { displayName: identity?.displayName ?? agent.displayName, description: identity?.description ?? agent.description ?? "", role: persona?.role ?? "", mission: persona?.mission ?? "", instructions: persona?.communication?.customInstructions ?? "" }; }
function defaultManifest(values: EditorValues, models: ModelProfile[]): AgentManifestV2 { const modelId = models.find((model) => model.enabled)?.id ?? models[0]?.id ?? "default"; return { schemaVersion: 2, identity: { displayName: values.displayName, description: values.description, category: "数字员工" }, persona: { role: values.role, mission: values.mission, responsibilities: [values.mission], boundaries: ["在需要确认或信息不足时，主动向用户说明。"], communication: { defaultLanguage: "zh-CN", responseDensity: "BALANCED", customInstructions: values.instructions } }, capabilities: { model: { defaultProfileId: modelId, selectionMode: "FIXED" }, tools: [], skills: [], mcpConnections: [], knowledgeBases: [], collaborators: [] }, memory: { mode: "CONVERSATION", shortTerm: { strategy: "SUMMARY", maxContextTokens: 16000 }, longTerm: { enabled: false, categories: [], writeMode: "EXPLICIT_ONLY", retrievalMode: "HYBRID", topK: 5, sensitiveDataPolicy: "CONFIRM" } }, runtime: { autonomy: "ASSIST", planning: "IMPLICIT", maxSteps: 40, timeoutSeconds: 300, failureStrategy: "ASK_USER" }, safety: { approvalPreset: "BALANCED", inputGuardrails: [], outputGuardrails: [] } }; }
function manifestWithValues(agent: AgentV2, values: EditorValues, models: ModelProfile[]): AgentManifestV2 { const source = agent.latestDraft?.manifest ?? agent.currentPublishedVersion?.manifest; const base = source ? structuredClone(source) : defaultManifest(values, models); return { ...base, identity: { ...base.identity, displayName: values.displayName, description: values.description }, persona: { ...base.persona, role: values.role, mission: values.mission, responsibilities: base.persona.responsibilities?.length ? base.persona.responsibilities : [values.mission], communication: { ...base.persona.communication, customInstructions: values.instructions } } }; }
function errorMessage(error: unknown, fallback: string) { if (error instanceof StudioApiError) return error.message || fallback; return error instanceof Error ? error.message : fallback; }
