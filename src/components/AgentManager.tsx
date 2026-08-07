import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  FlaskConical,
  History,
  LoaderCircle,
  MemoryStick,
  Plus,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type {
  Agent,
  AgentEvaluationReport,
  AgentManifestV2,
  AgentV2,
  KnowledgeBase,
  McpConnection,
  ModelProfile,
  Skill,
  Tool,
} from "../types";
import { StudioApiError, studioApi } from "../lib/api";

const listText = z.string().trim();
const agentFormSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  category: z.string().trim().max(80),
  tagsText: listText,
  visibility: z.enum(["PRIVATE", "TEAM", "TENANT"]),
  status: z.enum(["ACTIVE", "DISABLED"]),
  role: z.string().trim().min(1).max(240),
  mission: z.string().trim().min(1).max(600),
  audience: z.string().trim().max(400),
  responsibilitiesText: z.string().trim().min(1),
  boundariesText: z.string().trim().min(1),
  traitsText: listText,
  defaultLanguage: z.string().trim().min(2).max(16),
  toneText: listText,
  responseDensity: z.enum(["COMPACT", "BALANCED", "DETAILED"]),
  customInstructions: z.string().max(12000),
  greeting: z.string().max(1000),
  startersText: listText,
  modelProfileId: z.string().trim().min(1),
  toolIds: z.array(z.string()),
  skillIds: z.array(z.string()),
  mcpIds: z.array(z.string()),
  knowledgeBaseIds: z.array(z.string()),
  memoryMode: z.enum(["OFF", "CONVERSATION", "PERSONALIZED"]),
  shortTermStrategy: z.enum(["WINDOW", "SUMMARY", "HYBRID"]),
  maxContextTokens: z.number().int().min(512).max(200000),
  memoryCategories: z.array(z.enum(["PROFILE", "SEMANTIC", "EPISODIC", "PROCEDURAL"])),
  memoryWriteMode: z.enum(["EXPLICIT_ONLY", "SUGGEST", "AUTO"]),
  memoryRetrievalMode: z.enum(["KEYWORD", "SEMANTIC", "HYBRID"]),
  memoryTopK: z.number().int().min(1).max(12),
  minRelevance: z.number().min(0).max(1),
  approvalPreset: z.enum(["CONSERVATIVE", "BALANCED"]),
  autonomy: z.enum(["ASSIST", "EXECUTE", "ORCHESTRATE"]),
  planning: z.enum(["NONE", "IMPLICIT", "VISIBLE"]),
  maxSteps: z.number().int().min(1).max(200),
  timeoutSeconds: z.number().int().min(5).max(86400),
  failureStrategy: z.enum(["STOP", "RETRY_SAFE", "ASK_USER", "FALLBACK_MODEL"]),
  evaluationSuiteIds: z.array(z.string()),
  requiredBeforePublish: z.boolean(),
  minimumPassRate: z.number().min(0).max(1),
});

type AgentFormData = z.infer<typeof agentFormSchema>;
type AgentStep = "identity" | "persona" | "capabilities" | "knowledge" | "memory" | "safety" | "evaluation" | "publish";
type Translate = (key: string) => string;

const steps: Array<{ id: AgentStep; icon: typeof Bot; labelKey: string }> = [
  { id: "identity", icon: Bot, labelKey: "agentStepIdentity" },
  { id: "persona", icon: Sparkles, labelKey: "agentStepPersona" },
  { id: "capabilities", icon: Wrench, labelKey: "agentStepCapabilities" },
  { id: "knowledge", icon: Database, labelKey: "agentStepKnowledge" },
  { id: "memory", icon: MemoryStick, labelKey: "agentStepMemory" },
  { id: "safety", icon: ShieldCheck, labelKey: "agentStepSafety" },
  { id: "evaluation", icon: FlaskConical, labelKey: "agentStepEvaluation" },
  { id: "publish", icon: Rocket, labelKey: "agentStepPublish" },
];

const evaluationSuites = ["coding-review-smoke", "role-boundary-smoke", "memory-safety-smoke"];

export function AgentManager({
  agents: _agents,
  models,
  skills,
  tools,
  query: _query,
  t,
  onDirtyChange,
}: {
  agents: Agent[];
  models: ModelProfile[];
  skills: Skill[];
  tools: Tool[];
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  t: Translate;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents-v2"], queryFn: studioApi.listAgentsV2 });
  const mcpQuery = useQuery({ queryKey: ["mcp-connections"], queryFn: studioApi.listMcpConnections });
  const knowledgeQuery = useQuery({ queryKey: ["knowledge-bases"], queryFn: studioApi.listKnowledgeBases });
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState<AgentStep>("identity");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DRAFT" | "PUBLISHED">("ALL");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState("");
  const [evaluationReport, setEvaluationReport] = useState<AgentEvaluationReport | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [pendingEditorAction, setPendingEditorAction] = useState<{ type: "select"; id: string } | { type: "create" } | null>(null);

  const availableAgents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const selectedAgent = availableAgents.find((agent) => agent.id === selectedId) ?? null;
  const activeVersion = selectedAgent?.latestDraft ?? selectedAgent?.currentPublishedVersion ?? null;
  const form = useForm<AgentFormData>({ resolver: zodResolver(agentFormSchema), defaultValues: emptyForm(models, t) });
  const isDirty = form.formState.isDirty;
  const createForm = useForm<{ displayName: string; description: string; category: string; visibility: "PRIVATE" | "TEAM" | "TENANT" }>({
    resolver: zodResolver(z.object({
      displayName: z.string().trim().min(1).max(80),
      description: z.string().trim().max(240),
      category: z.string().trim().max(80),
      visibility: z.enum(["PRIVATE", "TEAM", "TENANT"]),
    })),
    defaultValues: { displayName: "", description: "", category: "", visibility: "PRIVATE" },
  });

  const versionsQuery = useQuery({
    queryKey: ["agents-v2", selectedId, "versions"],
    queryFn: () => studioApi.listAgentV2Versions(selectedId),
    enabled: Boolean(selectedId) && step === "publish",
  });

  useEffect(() => {
    if (!selectedId && availableAgents[0]) setSelectedId(availableAgents[0].id);
    if (selectedId && !availableAgents.some((agent) => agent.id === selectedId)) setSelectedId(availableAgents[0]?.id ?? "");
  }, [availableAgents, selectedId]);

  useEffect(() => {
    if (!selectedAgent || !activeVersion) return;
    form.reset(formFromAgent(selectedAgent, activeVersion.manifest));
    setEvaluationReport(null);
  }, [activeVersion, form, selectedAgent]);

  useEffect(() => {
    setNotice("");
    setActionError("");
    setArchiveConfirm(false);
  }, [selectedId]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const filteredAgents = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return availableAgents.filter((agent) => {
      const matchesSearch = !normalized || `${agent.displayName} ${agent.description} ${agent.category} ${agent.tags.join(" ")}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === "ALL" || (statusFilter === "DRAFT" ? Boolean(agent.latestDraft) : Boolean(agent.currentPublishedVersion));
      return matchesSearch && matchesStatus;
    });
  }, [availableAgents, search, statusFilter]);

  const refreshAgents = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agents-v2"] }),
      queryClient.invalidateQueries({ queryKey: ["agents"] }),
    ]);
  };

  const requestAgentSelection = (id: string) => {
    if (id === selectedId) return;
    if (isDirty) {
      setPendingEditorAction({ type: "select", id });
      return;
    }
    setSelectedId(id);
  };

  const requestCreateAgent = () => {
    setActionError("");
    if (isDirty) {
      setPendingEditorAction({ type: "create" });
      return;
    }
    setCreateOpen(true);
  };

  const discardPendingChanges = () => {
    const action = pendingEditorAction;
    setPendingEditorAction(null);
    if (!action) return;
    if (action.type === "select") {
      setSelectedId(action.id);
      return;
    }
    if (selectedAgent && activeVersion) form.reset(formFromAgent(selectedAgent, activeVersion.manifest));
    setCreateOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (values: { displayName: string; description: string; category: string; visibility: "PRIVATE" | "TEAM" | "TENANT" }) =>
      studioApi.createAgentV2({ manifest: newManifest(values, models, t), visibility: values.visibility }),
    onSuccess: async (agent) => {
      await refreshAgents();
      setSelectedId(agent.id);
      setCreateOpen(false);
      createForm.reset();
      setNotice(t("agentCreated"));
    },
    onError: (error) => setActionError(errorMessage(error, t("agentSaveFailed"), t)),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: AgentFormData) => {
      if (!selectedAgent) throw new Error(t("agentSelectRequired"));
      let currentAgent = selectedAgent;
      if (values.visibility !== selectedAgent.visibility || values.status !== selectedAgent.status) {
        currentAgent = await studioApi.updateAgentV2Settings(selectedAgent.id, {
          visibility: values.visibility,
          status: values.status,
          expectedRevision: selectedAgent.revision,
        });
      }
      const draft = currentAgent.latestDraft ?? await studioApi.createAgentV2Draft(currentAgent.id);
      return studioApi.updateAgentV2Manifest(currentAgent.id, draft.id, {
        manifest: manifestFromForm(values),
        expectedRevision: draft.revision,
      });
    },
    onSuccess: async () => {
      await refreshAgents();
      setNotice(t("agentDraftSaved"));
      setActionError("");
    },
    onError: (error) => setActionError(errorMessage(error, t("agentSaveFailed"), t)),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent?.latestDraft) throw new Error(t("agentSaveDraftFirst"));
      return studioApi.validateAgentV2Draft(selectedAgent.id, selectedAgent.latestDraft.id);
    },
    onSuccess: (result) => {
      setNotice(result.valid ? t("agentValidationPassed") : "");
      setActionError(result.valid ? "" : result.errors.join(" · "));
    },
    onError: (error) => setActionError(errorMessage(error, t("agentValidationFailed"), t)),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent?.latestDraft) throw new Error(t("agentSaveDraftFirst"));
      const content = testInput.trim();
      if (!content) throw new Error(t("agentTestMessageRequired"));
      return studioApi.testAgentV2Draft(selectedAgent.id, selectedAgent.latestDraft.id, [{ role: "USER", content }]);
    },
    onSuccess: (result) => {
      setTestResult(result.content);
      setActionError("");
    },
    onError: (error) => setActionError(errorMessage(error, t("agentTestFailed"), t)),
  });

  const evaluationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent?.latestDraft) throw new Error(t("agentSaveDraftFirst"));
      return studioApi.evaluateAgentV2Draft(selectedAgent.id, selectedAgent.latestDraft.id);
    },
    onSuccess: (report) => {
      setEvaluationReport(report);
      setNotice(report.passed ? t("agentEvaluationPassed") : "");
      setActionError(report.passed ? "" : t("agentEvaluationFailed"));
    },
    onError: (error) => setActionError(errorMessage(error, t("agentEvaluationFailed"), t)),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent?.latestDraft) throw new Error(t("agentSaveDraftFirst"));
      return studioApi.publishAgentV2Draft(selectedAgent.id, selectedAgent.latestDraft.id);
    },
    onSuccess: async () => {
      await refreshAgents();
      await queryClient.invalidateQueries({ queryKey: ["agents-v2", selectedId, "versions"] });
      setNotice(t("agentPublished"));
      setActionError("");
    },
    onError: (error) => setActionError(errorMessage(error, t("agentPublishFailed"), t)),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error(t("agentSelectRequired"));
      return studioApi.archiveAgentV2(selectedAgent.id);
    },
    onSuccess: async () => {
      setSelectedId("");
      setArchiveConfirm(false);
      await refreshAgents();
      setNotice(t("agentArchived"));
    },
    onError: (error) => setActionError(errorMessage(error, t("agentArchiveFailed"), t)),
  });

  if (agentsQuery.isLoading) return <ManagerState icon="loading" text={t("loading")} />;
  if (agentsQuery.isError) return <ManagerState icon="error" text={t("loadFailed")} action={t("retryLoad")} onAction={() => void agentsQuery.refetch()} />;

  return (
    <div className="agent-studio-manager">
      <aside className="agent-catalog" aria-label={t("agents")}>
        <div className="agent-catalog-toolbar">
          <label className="agent-search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">{t("search")}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("agentSearchPlaceholder")} />
          </label>
          <button type="button" className="icon-button" aria-label={t("newAgent")} title={t("newAgent")} onClick={requestCreateAgent}><Plus size={17} /></button>
        </div>
        <div className="agent-filter" aria-label={t("agentFilterLabel")}>
          {(["ALL", "DRAFT", "PUBLISHED"] as const).map((value) => (
            <button key={value} type="button" className={statusFilter === value ? "is-active" : ""} onClick={() => setStatusFilter(value)}>{t(`agentFilter${value}`)}</button>
          ))}
        </div>
        <div className="agent-catalog-list">
          {filteredAgents.map((agent) => (
            <button key={agent.id} type="button" className={`agent-catalog-item ${selectedId === agent.id ? "is-active" : ""}`} onClick={() => requestAgentSelection(agent.id)}>
              <span className="agent-avatar"><Bot size={16} /></span>
              <span className="agent-catalog-copy">
                <strong>{agent.displayName}</strong>
                <small>{agent.category || agent.description || t("noDescription")}</small>
              </span>
              <span className={`agent-state-mark ${agent.latestDraft ? "is-draft" : "is-published"}`} title={agent.latestDraft ? t("agentDraft") : t("agentPublishedState")} />
            </button>
          ))}
          {!filteredAgents.length ? <div className="agent-catalog-empty">{search ? t("agentNoSearchResults") : t("agentEmptyState")}</div> : null}
        </div>
      </aside>

      <section className="agent-workbench">
        {selectedAgent && activeVersion ? (
          <>
            <header className="agent-workbench-header">
              <div>
                <div className="agent-title-line">
                  <h4>{selectedAgent.displayName}</h4>
                  <StatusBadge agent={selectedAgent} t={t} />
                </div>
                <p>{selectedAgent.description || t("noDescription")}</p>
              </div>
              <div className="agent-header-actions">
                <button type="button" className="secondary-button" disabled={!selectedAgent.latestDraft} onClick={() => { setActionError(""); setTestResult(""); setTestOpen(true); }}><TestTube2 size={14} />{t("agentTest")}</button>
                <button type="button" className="primary-button" disabled={saveMutation.isPending || !form.formState.isDirty} onClick={() => void form.handleSubmit((values) => saveMutation.mutate(values))()}>
                  {saveMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saveMutation.isPending ? t("agentSaving") : t("agentSaveDraft")}
                </button>
              </div>
            </header>

            {notice ? <div className="manager-notice success" role="status"><CheckCircle2 size={14} />{notice}</div> : null}
            {actionError && !createOpen && !testOpen ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{actionError}</div> : null}

            <div className="agent-editor-layout">
              <nav className="agent-step-nav" aria-label={t("agentConfigurationSteps")}>
                {steps.map(({ id, icon: Icon, labelKey }, index) => (
                  <button key={id} type="button" className={step === id ? "is-active" : ""} onClick={() => setStep(id)}>
                    <span className="agent-step-index">{index + 1}</span>
                    <Icon size={15} />
                    <span>{t(labelKey)}</span>
                    <ChevronRight size={14} className="agent-step-chevron" />
                  </button>
                ))}
              </nav>

              <form className="agent-v2-form" onSubmit={(event) => event.preventDefault()}>
                <StepHeading step={step} t={t} />
                {step === "identity" ? <IdentityStep form={form} t={t} /> : null}
                {step === "persona" ? <PersonaStep form={form} t={t} /> : null}
                {step === "capabilities" ? <CapabilitiesStep form={form} models={models} tools={tools} skills={skills} mcpConnections={mcpQuery.data ?? []} t={t} /> : null}
                {step === "knowledge" ? <KnowledgeStep form={form} knowledgeBases={knowledgeQuery.data ?? []} loading={knowledgeQuery.isLoading} error={knowledgeQuery.isError} t={t} /> : null}
                {step === "memory" ? <MemoryStep form={form} t={t} /> : null}
                {step === "safety" ? <SafetyStep form={form} t={t} /> : null}
                {step === "evaluation" ? <EvaluationStep form={form} report={evaluationReport} pending={evaluationMutation.isPending} onRun={() => evaluationMutation.mutate()} t={t} /> : null}
                {step === "publish" ? (
                  <PublishStep
                    agent={selectedAgent}
                    manifest={manifestFromForm(form.getValues())}
                    versions={versionsQuery.data ?? []}
                    versionsLoading={versionsQuery.isLoading}
                    validationPending={validateMutation.isPending}
                    publishPending={publishMutation.isPending}
                    archivePending={archiveMutation.isPending}
                    archiveConfirm={archiveConfirm}
                    onArchiveConfirm={setArchiveConfirm}
                    onValidate={() => validateMutation.mutate()}
                    onPublish={() => publishMutation.mutate()}
                    onArchive={() => archiveMutation.mutate()}
                    t={t}
                  />
                ) : null}
              </form>
            </div>
          </>
        ) : (
          <ManagerState icon="empty" text={t("agentEmptyState")} action={t("newAgent")} onAction={requestCreateAgent} />
        )}
      </section>

      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} form={createForm} error={actionError} pending={createMutation.isPending} onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))} t={t} />
      <TestAgentDialog open={testOpen} onOpenChange={setTestOpen} input={testInput} onInput={setTestInput} result={testResult} error={actionError} pending={testMutation.isPending} onSubmit={() => testMutation.mutate()} t={t} />
      <UnsavedChangesDialog open={Boolean(pendingEditorAction)} onOpenChange={(open) => { if (!open) setPendingEditorAction(null); }} onDiscard={discardPendingChanges} t={t} />
    </div>
  );
}

function IdentityStep({ form, t }: FormStepProps) {
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentIdentitySection")} hint={t("agentIdentityHint")} />
        <div className="agent-form-grid">
          <FormField label={t("agentName")} error={form.formState.errors.displayName?.message}><input {...form.register("displayName")} /></FormField>
          <FormField label={t("agentCategory")} error={form.formState.errors.category?.message}><input {...form.register("category")} /></FormField>
          <FormField wide label={t("description")} error={form.formState.errors.description?.message}><textarea rows={3} {...form.register("description")} /></FormField>
          <FormField wide label={t("agentTags")} hint={t("agentListPerLine")}><textarea rows={3} {...form.register("tagsText")} /></FormField>
        </div>
      </section>
      <section className="agent-form-section">
        <SectionTitle title={t("agentAccessSection")} hint={t("agentAccessHint")} />
        <div className="agent-form-grid">
          <FormField label={t("agentVisibility")}><select {...form.register("visibility")}><option value="PRIVATE">{t("agentVisibilityPrivate")}</option><option value="TEAM">{t("agentVisibilityTeam")}</option><option value="TENANT">{t("agentVisibilityTenant")}</option></select></FormField>
          <FormField label={t("status")}><select {...form.register("status")}><option value="ACTIVE">{t("enabled")}</option><option value="DISABLED">{t("disabled")}</option></select></FormField>
        </div>
      </section>
    </div>
  );
}

function PersonaStep({ form, t }: FormStepProps) {
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentRoleSection")} hint={t("agentRoleHint")} />
        <div className="agent-form-grid">
          <FormField label={t("agentRole")} error={form.formState.errors.role?.message}><input {...form.register("role")} /></FormField>
          <FormField label={t("agentAudience")}><input {...form.register("audience")} /></FormField>
          <FormField wide label={t("agentMission")} error={form.formState.errors.mission?.message}><textarea rows={4} {...form.register("mission")} /></FormField>
          <FormField label={t("agentResponsibilities")} hint={t("agentListPerLine")} error={form.formState.errors.responsibilitiesText?.message}><textarea rows={7} {...form.register("responsibilitiesText")} /></FormField>
          <FormField label={t("agentBoundaries")} hint={t("agentListPerLine")} error={form.formState.errors.boundariesText?.message}><textarea rows={7} {...form.register("boundariesText")} /></FormField>
        </div>
      </section>
      <section className="agent-form-section">
        <SectionTitle title={t("agentCommunicationSection")} hint={t("agentCommunicationHint")} />
        <div className="agent-form-grid">
          <FormField label={t("agentLanguage")}><input {...form.register("defaultLanguage")} /></FormField>
          <FormField label={t("agentResponseDensity")}><select {...form.register("responseDensity")}><option value="COMPACT">{t("agentDensityCompact")}</option><option value="BALANCED">{t("agentDensityBalanced")}</option><option value="DETAILED">{t("agentDensityDetailed")}</option></select></FormField>
          <FormField label={t("agentTraits")} hint={t("agentListPerLine")}><textarea rows={4} {...form.register("traitsText")} /></FormField>
          <FormField label={t("agentTone")} hint={t("agentListPerLine")}><textarea rows={4} {...form.register("toneText")} /></FormField>
          <FormField wide label={t("agentCustomInstructions")}><textarea rows={6} {...form.register("customInstructions")} /></FormField>
          <FormField wide label={t("agentGreeting")}><textarea rows={3} {...form.register("greeting")} /></FormField>
          <FormField wide label={t("agentStarters")} hint={t("agentListPerLine")}><textarea rows={4} {...form.register("startersText")} /></FormField>
        </div>
      </section>
    </div>
  );
}

function CapabilitiesStep({ form, models, tools, skills, mcpConnections, t }: FormStepProps & { models: ModelProfile[]; tools: Tool[]; skills: Skill[]; mcpConnections: McpConnection[] }) {
  const toolIds = form.watch("toolIds");
  const skillIds = form.watch("skillIds");
  const mcpIds = form.watch("mcpIds");
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentModelSection")} hint={t("agentModelHint")} />
        <FormField label={t("agentDefaultModel")} error={form.formState.errors.modelProfileId?.message}><select {...form.register("modelProfileId")}><option value="">{t("agentSelectModel")}</option>{models.filter((model) => model.enabled).map((model) => <option key={model.id} value={model.id}>{model.modelName} · {model.id}</option>)}</select></FormField>
      </section>
      <SelectionSection title={t("agentTools")} hint={t("agentToolsHint")} empty={t("agentNoTools")} items={tools.map((tool) => ({ id: tool.name, label: tool.name, detail: tool.description || tool.riskLevel, risk: tool.requiresApproval }))} selected={toolIds} onToggle={(id, checked) => setArrayValue(form, "toolIds", toolIds, id, checked)} t={t} />
      <SelectionSection title={t("agentSkills")} hint={t("agentSkillsHint")} empty={t("agentNoSkills")} items={skills.filter((skill) => skill.enabled).map((skill) => ({ id: skill.id, label: skill.name, detail: skill.description || skill.id }))} selected={skillIds} onToggle={(id, checked) => setArrayValue(form, "skillIds", skillIds, id, checked)} t={t} />
      <SelectionSection title={t("agentMcpSection")} hint={t("agentMcpHint")} empty={t("agentNoMcp")} items={mcpConnections.filter((connection) => connection.enabled).map((connection) => ({ id: connection.id, label: connection.name, detail: connection.description || connection.transportType || connection.id }))} selected={mcpIds} onToggle={(id, checked) => setArrayValue(form, "mcpIds", mcpIds, id, checked)} t={t} />
    </div>
  );
}

function KnowledgeStep({ form, knowledgeBases, loading, error, t }: FormStepProps & { knowledgeBases: KnowledgeBase[]; loading: boolean; error: boolean }) {
  const selected = form.watch("knowledgeBaseIds");
  if (loading) return <ManagerState icon="loading" text={t("loading")} />;
  if (error) return <ManagerState icon="error" text={t("loadFailed")} />;
  return <SelectionSection title={t("agentKnowledgeSection")} hint={t("agentKnowledgeHint")} empty={t("agentNoKnowledge")} items={knowledgeBases.map((base) => ({ id: base.id, label: base.name, detail: base.description || base.id }))} selected={selected} onToggle={(id, checked) => setArrayValue(form, "knowledgeBaseIds", selected, id, checked)} t={t} />;
}

function MemoryStep({ form, t }: FormStepProps) {
  const mode = form.watch("memoryMode");
  const categories = form.watch("memoryCategories");
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentMemoryModeSection")} hint={t("agentMemoryModeHint")} />
        <div className="agent-choice-grid">
          {(["OFF", "CONVERSATION", "PERSONALIZED"] as const).map((value) => <ChoiceButton key={value} checked={mode === value} title={t(`agentMemory${value}`)} detail={t(`agentMemory${value}Hint`)} onClick={() => form.setValue("memoryMode", value, { shouldDirty: true })} />)}
        </div>
      </section>
      <section className="agent-form-section">
        <SectionTitle title={t("agentShortTermSection")} hint={t("agentShortTermHint")} />
        <div className="agent-form-grid">
          <FormField label={t("agentMemoryStrategy")}><select {...form.register("shortTermStrategy")}><option value="WINDOW">{t("agentMemoryWindow")}</option><option value="SUMMARY">{t("agentMemorySummary")}</option><option value="HYBRID">{t("agentMemoryHybrid")}</option></select></FormField>
          <FormField label={t("agentContextTokens")}><input type="number" {...form.register("maxContextTokens", { valueAsNumber: true })} /></FormField>
        </div>
      </section>
      {mode === "PERSONALIZED" ? (
        <section className="agent-form-section">
          <SectionTitle title={t("agentLongTermSection")} hint={t("agentLongTermHint")} />
          <div className="agent-check-grid">
            {(["PROFILE", "SEMANTIC", "EPISODIC", "PROCEDURAL"] as const).map((value) => <CheckOption key={value} checked={categories.includes(value)} label={t(`agentMemoryCategory${value}`)} detail={t(`agentMemoryCategory${value}Hint`)} onChange={(checked) => setArrayValue(form, "memoryCategories", categories, value, checked)} />)}
          </div>
          <div className="agent-form-grid agent-form-grid-spaced">
            <FormField label={t("agentMemoryWriteMode")}><select {...form.register("memoryWriteMode")}><option value="EXPLICIT_ONLY">{t("agentMemoryWriteExplicit")}</option><option value="SUGGEST">{t("agentMemoryWriteSuggest")}</option><option value="AUTO">{t("agentMemoryWriteAuto")}</option></select></FormField>
            <FormField label={t("agentMemoryRetrievalMode")}><select {...form.register("memoryRetrievalMode")}><option value="KEYWORD">{t("agentMemoryKeyword")}</option><option value="SEMANTIC">{t("agentMemorySemantic")}</option><option value="HYBRID">{t("agentMemoryHybrid")}</option></select></FormField>
            <FormField label={t("agentMemoryTopK")}><input type="number" {...form.register("memoryTopK", { valueAsNumber: true })} /></FormField>
            <FormField label={t("agentMemoryRelevance")}><input type="number" step="0.01" {...form.register("minRelevance", { valueAsNumber: true })} /></FormField>
          </div>
          <div className="agent-policy-note"><ShieldCheck size={16} /><span>{t("agentMemoryConfirmationPolicy")}</span></div>
        </section>
      ) : null}
    </div>
  );
}

function SafetyStep({ form, t }: FormStepProps) {
  const approval = form.watch("approvalPreset");
  const autonomy = form.watch("autonomy");
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentAutonomySection")} hint={t("agentAutonomyHint")} />
        <div className="agent-choice-grid">
          {(["ASSIST", "EXECUTE", "ORCHESTRATE"] as const).map((value) => <ChoiceButton key={value} checked={autonomy === value} title={t(`agentAutonomy${value}`)} detail={t(`agentAutonomy${value}Hint`)} onClick={() => form.setValue("autonomy", value, { shouldDirty: true })} />)}
        </div>
        <div className="agent-form-grid agent-form-grid-spaced">
          <FormField label={t("agentPlanning")}><select {...form.register("planning")}><option value="NONE">{t("agentPlanningNone")}</option><option value="IMPLICIT">{t("agentPlanningImplicit")}</option><option value="VISIBLE">{t("agentPlanningVisible")}</option></select></FormField>
          <FormField label={t("agentFailureStrategy")}><select {...form.register("failureStrategy")}><option value="STOP">{t("agentFailureStop")}</option><option value="RETRY_SAFE">{t("agentFailureRetry")}</option><option value="ASK_USER">{t("agentFailureAsk")}</option><option value="FALLBACK_MODEL">{t("agentFailureFallback")}</option></select></FormField>
          <FormField label={t("agentMaxSteps")}><input type="number" {...form.register("maxSteps", { valueAsNumber: true })} /></FormField>
          <FormField label={t("agentTimeout")}><input type="number" {...form.register("timeoutSeconds", { valueAsNumber: true })} /></FormField>
        </div>
      </section>
      <section className="agent-form-section">
        <SectionTitle title={t("agentApprovalSection")} hint={t("agentApprovalHint")} />
        <div className="agent-choice-grid two">
          {(["CONSERVATIVE", "BALANCED"] as const).map((value) => <ChoiceButton key={value} checked={approval === value} title={t(`agentApproval${value}`)} detail={t(`agentApproval${value}Hint`)} onClick={() => form.setValue("approvalPreset", value, { shouldDirty: true })} />)}
        </div>
      </section>
    </div>
  );
}

function EvaluationStep({ form, report, pending, onRun, t }: FormStepProps & { report: AgentEvaluationReport | null; pending: boolean; onRun: () => void }) {
  const suites = form.watch("evaluationSuiteIds");
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentEvaluationSuites")} hint={t("agentEvaluationSuitesHint")} />
        <div className="agent-check-grid">
          {evaluationSuites.map((suite) => <CheckOption key={suite} checked={suites.includes(suite)} label={suite} detail={t(`agentSuite${suite.replaceAll("-", "_")}`)} onChange={(checked) => setArrayValue(form, "evaluationSuiteIds", suites, suite, checked)} />)}
        </div>
        <div className="agent-form-grid agent-form-grid-spaced">
          <FormField label={t("agentMinimumPassRate")}><input type="number" step="0.05" {...form.register("minimumPassRate", { valueAsNumber: true })} /></FormField>
          <label className="agent-inline-check"><input type="checkbox" {...form.register("requiredBeforePublish")} /><span><strong>{t("agentRequireEvaluation")}</strong><small>{t("agentRequireEvaluationHint")}</small></span></label>
        </div>
        <button type="button" className="primary-button agent-run-action" disabled={pending || !suites.length} onClick={onRun}>{pending ? <LoaderCircle size={14} className="spin" /> : <FlaskConical size={14} />}{pending ? t("agentEvaluationRunning") : t("agentRunEvaluation")}</button>
      </section>
      {report ? <EvaluationReport report={report} t={t} /> : <div className="agent-empty-report"><FlaskConical size={20} /><strong>{t("agentNoEvaluation")}</strong><span>{t("agentNoEvaluationHint")}</span></div>}
    </div>
  );
}

function PublishStep({ agent, manifest, versions, versionsLoading, validationPending, publishPending, archivePending, archiveConfirm, onArchiveConfirm, onValidate, onPublish, onArchive, t }: {
  agent: AgentV2; manifest: AgentManifestV2; versions: AgentV2["latestDraft"][]; versionsLoading: boolean; validationPending: boolean; publishPending: boolean; archivePending: boolean; archiveConfirm: boolean; onArchiveConfirm: (value: boolean) => void; onValidate: () => void; onPublish: () => void; onArchive: () => void; t: Translate;
}) {
  return (
    <div className="agent-form-sections">
      <section className="agent-form-section">
        <SectionTitle title={t("agentReleaseSection")} hint={t("agentReleaseHint")} />
        <div className="agent-release-checks">
          <ReleaseCheck passed={Boolean(agent.latestDraft)} label={t("agentReleaseDraftReady")} />
          <ReleaseCheck passed={Boolean(manifest.capabilities.model.defaultProfileId)} label={t("agentReleaseModelReady")} />
          <ReleaseCheck passed={!manifest.evaluation?.requiredBeforePublish || Boolean(manifest.evaluation.suiteIds?.length)} label={t("agentReleaseEvaluationConfigured")} />
        </div>
        <div className="agent-release-actions">
          <button type="button" className="secondary-button" disabled={validationPending || !agent.latestDraft} onClick={onValidate}>{validationPending ? <LoaderCircle size={14} className="spin" /> : <CheckCircle2 size={14} />}{t("agentValidateDraft")}</button>
          <button type="button" className="primary-button" disabled={publishPending || !agent.latestDraft} onClick={onPublish}>{publishPending ? <LoaderCircle size={14} className="spin" /> : <Rocket size={14} />}{t("agentPublishVersion")}</button>
        </div>
      </section>
      <section className="agent-form-section">
        <SectionTitle title={t("agentVersionHistory")} hint={t("agentVersionHistoryHint")} />
        {versionsLoading ? <ManagerState icon="loading" text={t("loading")} /> : (
          <div className="agent-version-list">
            {versions.filter(Boolean).map((version) => version ? <div className="agent-version-row" key={version.id}><span className="agent-version-icon"><History size={14} /></span><div><strong>v{version.versionNumber}</strong><small>{version.state === "PUBLISHED" ? t("agentPublishedState") : t("agentDraft")} · {formatDate(version.createdAt, t)}</small></div><code>{version.manifestDigest.slice(0, 10)}</code></div> : null)}
          </div>
        )}
        <details className="agent-advanced"><summary>{t("agentAdvancedManifest")}</summary><pre><code>{JSON.stringify(manifest, null, 2)}</code></pre></details>
      </section>
      <section className="agent-form-section agent-danger-zone">
        <SectionTitle title={t("agentDangerZone")} hint={t("agentDangerZoneHint")} />
        {!archiveConfirm ? <button type="button" className="secondary-button danger-text" onClick={() => onArchiveConfirm(true)}><Trash2 size={14} />{t("agentArchive")}</button> : <div className="agent-danger-confirm"><CircleAlert size={18} /><div><strong>{t("agentArchiveConfirmTitle")}</strong><p>{t("agentArchiveConfirmHint")}</p></div><div><button type="button" className="secondary-button" onClick={() => onArchiveConfirm(false)}>{t("cancel")}</button><button type="button" className="danger-button" disabled={archivePending} onClick={onArchive}>{archivePending ? t("agentArchiving") : t("agentArchiveConfirm")}</button></div></div>}
      </section>
    </div>
  );
}

function CreateAgentDialog({ open, onOpenChange, form, error, pending, onSubmit, t }: { open: boolean; onOpenChange: (open: boolean) => void; form: ReturnType<typeof useForm<{ displayName: string; description: string; category: string; visibility: "PRIVATE" | "TEAM" | "TENANT" }>>; error: string; pending: boolean; onSubmit: () => void; t: Translate }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-create-dialog" aria-describedby="agent-create-description">
        <div className="dialog-header"><div><Dialog.Title>{t("newAgent")}</Dialog.Title><Dialog.Description id="agent-create-description">{t("agentCreateHint")}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div>
        <form className="agent-create-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
          {error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}
          <FormField label={t("agentName")} error={form.formState.errors.displayName?.message}><input autoFocus {...form.register("displayName")} /></FormField>
          <FormField label={t("description")}><textarea rows={3} {...form.register("description")} /></FormField>
          <div className="agent-form-grid"><FormField label={t("agentCategory")}><input {...form.register("category")} /></FormField><FormField label={t("agentVisibility")}><select {...form.register("visibility")}><option value="PRIVATE">{t("agentVisibilityPrivate")}</option><option value="TEAM">{t("agentVisibilityTeam")}</option><option value="TENANT">{t("agentVisibilityTenant")}</option></select></FormField></div>
          <div className="inline-form-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close><button type="submit" className="primary-button" disabled={pending}>{pending ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{pending ? t("agentCreating") : t("agentCreate")}</button></div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function TestAgentDialog({ open, onOpenChange, input, onInput, result, error, pending, onSubmit, t }: { open: boolean; onOpenChange: (open: boolean) => void; input: string; onInput: (value: string) => void; result: string; error: string; pending: boolean; onSubmit: () => void; t: Translate }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-test-dialog" aria-describedby="agent-test-description">
        <div className="dialog-header"><div><Dialog.Title>{t("agentTestDraft")}</Dialog.Title><Dialog.Description id="agent-test-description">{t("agentTestSandboxHint")}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div>
        <div className="agent-test-body"><div className="agent-policy-note"><ShieldCheck size={16} /><span>{t("agentTestSandboxNotice")}</span></div>{error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}{result ? <div className="agent-test-result"><span>{t("agentTestResponse")}</span><p>{result}</p></div> : null}<FormField label={t("agentTestMessage")}><textarea rows={6} value={input} onChange={(event) => onInput(event.target.value)} /></FormField><button type="button" className="primary-button" disabled={pending || !input.trim()} onClick={onSubmit}>{pending ? <LoaderCircle size={14} className="spin" /> : <TestTube2 size={14} />}{pending ? t("agentTesting") : t("agentSendTest")}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function UnsavedChangesDialog({ open, onOpenChange, onDiscard, t }: { open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void; t: Translate }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog agent-unsaved-dialog" aria-describedby="agent-unsaved-description">
        <div className="dialog-header"><div><Dialog.Title>{t("agentUnsavedTitle")}</Dialog.Title><Dialog.Description id="agent-unsaved-description">{t("agentUnsavedHint")}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div>
        <div className="inline-form-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("agentKeepEditing")}</button></Dialog.Close><button type="button" className="danger-button" onClick={onDiscard}>{t("agentDiscardChanges")}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function StepHeading({ step, t }: { step: AgentStep; t: Translate }) {
  const index = steps.findIndex((item) => item.id === step);
  return <div className="agent-step-heading"><span>{t("agentStepProgress").replace("{current}", String(index + 1)).replace("{total}", String(steps.length))}</span><h3>{t(`agentStep${capitalize(step)}Title`)}</h3><p>{t(`agentStep${capitalize(step)}Hint`)}</p></div>;
}

function SelectionSection({ title, hint, empty, items, selected, onToggle, t }: { title: string; hint: string; empty: string; items: Array<{ id: string; label: string; detail: string; risk?: boolean }>; selected: string[]; onToggle: (id: string, checked: boolean) => void; t: Translate }) {
  return <section className="agent-form-section"><SectionTitle title={title} hint={hint} /><div className="agent-selection-summary">{selected.length} {t("agentSelected")}</div>{items.length ? <div className="agent-check-grid">{items.map((item) => <CheckOption key={item.id} checked={selected.includes(item.id)} label={item.label} detail={item.detail} riskLabel={item.risk ? t("agentApprovalRequired") : undefined} onChange={(checked) => onToggle(item.id, checked)} />)}</div> : <div className="agent-inline-empty">{empty}</div>}</section>;
}

function EvaluationReport({ report, t }: { report: AgentEvaluationReport; t: Translate }) {
  return <section className="agent-form-section"><SectionTitle title={t("agentEvaluationReport")} hint={formatDate(report.evaluatedAt, t)} /><div className={`agent-score ${report.passed ? "is-passed" : "is-failed"}`}><strong>{Math.round(report.score * 100)}%</strong><span>{report.passed ? t("agentEvaluationPassed") : t("agentEvaluationFailed")}</span></div><div className="agent-suite-list">{report.suites.map((suite) => <details key={suite.suiteId}><summary><span>{suite.passed ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{suite.suiteId}</span><strong>{Math.round(suite.score * 100)}%</strong></summary><div>{suite.cases.map((testCase) => <div className="agent-case-row" key={testCase.caseId}><span>{testCase.passed ? <Check size={13} /> : <X size={13} />}{testCase.caseId}</span><small>{testCase.reason}</small></div>)}</div></details>)}</div></section>;
}

function StatusBadge({ agent, t }: { agent: AgentV2; t: Translate }) {
  const draft = Boolean(agent.latestDraft);
  return <span className={`agent-status-badge ${draft ? "is-draft" : "is-published"}`}><span />{draft ? t("agentDraftChanges") : t("agentPublishedState")}</span>;
}

function ReleaseCheck({ passed, label }: { passed: boolean; label: string }) {
  return <div className={passed ? "is-passed" : "is-pending"}>{passed ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}<span>{label}</span></div>;
}

function ChoiceButton({ checked, title, detail, onClick }: { checked: boolean; title: string; detail: string; onClick: () => void }) {
  return <button type="button" className={`agent-choice ${checked ? "is-selected" : ""}`} aria-pressed={checked} onClick={onClick}><span className="agent-choice-check">{checked ? <Check size={13} /> : null}</span><span><strong>{title}</strong><small>{detail}</small></span></button>;
}

function CheckOption({ checked, label, detail, riskLabel, onChange }: { checked: boolean; label: string; detail: string; riskLabel?: string; onChange: (checked: boolean) => void }) {
  return <label className="agent-check-option-v2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="agent-checkbox-mark">{checked ? <Check size={12} /> : null}</span><span><strong>{label}</strong><small>{detail}</small></span>{riskLabel ? <span className="agent-risk-label">{riskLabel}</span> : null}</label>;
}

function FormField({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`agent-form-field ${wide ? "is-wide" : ""}`}><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}{error ? <small className="form-error">{error}</small> : null}</label>;
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return <div className="agent-section-title"><h4>{title}</h4><span>{hint}</span></div>;
}

function ManagerState({ icon, text, action, onAction }: { icon: "loading" | "error" | "empty"; text: string; action?: string; onAction?: () => void }) {
  return <div className="manager-placeholder agent-manager-state">{icon === "loading" ? <LoaderCircle size={18} className="spin" /> : icon === "error" ? <CircleAlert size={18} /> : <Brain size={20} />}<span>{text}</span>{action && onAction ? <button type="button" className="secondary-button" onClick={onAction}>{action}</button> : null}</div>;
}

type FormStepProps = { form: ReturnType<typeof useForm<AgentFormData>>; t: Translate };

function setArrayValue<K extends "toolIds" | "skillIds" | "mcpIds" | "knowledgeBaseIds" | "memoryCategories" | "evaluationSuiteIds">(form: ReturnType<typeof useForm<AgentFormData>>, key: K, values: AgentFormData[K], id: AgentFormData[K][number], checked: boolean) {
  const next = checked ? [...values, id] : values.filter((value) => value !== id);
  form.setValue(key, next as never, { shouldDirty: true, shouldValidate: true });
}

function lines(value?: string[]) { return (value ?? []).join("\n"); }
function splitLines(value: string) { return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))]; }
function references(values: string[]) { return values.map((id) => ({ id, required: true })); }

function emptyForm(models: ModelProfile[], t?: Translate): AgentFormData {
  return {
    displayName: "", description: "", category: "", tagsText: "", visibility: "PRIVATE", status: "ACTIVE",
    role: "", mission: "", audience: "", responsibilitiesText: "", boundariesText: "", traitsText: "",
    defaultLanguage: t ? t("agentDefaultLanguage") : "zh-CN", toneText: t ? `${t("agentToneProfessional")}\n${t("agentToneClear")}` : "professional\nclear", responseDensity: "BALANCED", customInstructions: "", greeting: "", startersText: "",
    modelProfileId: models.find((model) => model.defaultProfile && model.enabled)?.id ?? models.find((model) => model.enabled)?.id ?? "",
    toolIds: [], skillIds: [], mcpIds: [], knowledgeBaseIds: [], memoryMode: "CONVERSATION", shortTermStrategy: "HYBRID", maxContextTokens: 24000,
    memoryCategories: [], memoryWriteMode: "EXPLICIT_ONLY", memoryRetrievalMode: "HYBRID", memoryTopK: 3, minRelevance: 0.72,
    approvalPreset: "CONSERVATIVE", autonomy: "ASSIST", planning: "IMPLICIT", maxSteps: 40, timeoutSeconds: 1800, failureStrategy: "ASK_USER",
    evaluationSuiteIds: ["role-boundary-smoke"], requiredBeforePublish: true, minimumPassRate: 0.9,
  };
}

function formFromAgent(agent: AgentV2, manifest: AgentManifestV2): AgentFormData {
  const communication = manifest.persona.communication ?? {};
  return {
    displayName: manifest.identity.displayName, description: manifest.identity.description, category: manifest.identity.category ?? "", tagsText: lines(manifest.identity.tags), visibility: agent.visibility, status: agent.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    role: manifest.persona.role, mission: manifest.persona.mission, audience: manifest.persona.audience ?? "", responsibilitiesText: lines(manifest.persona.responsibilities), boundariesText: lines(manifest.persona.boundaries), traitsText: lines(manifest.persona.traits),
    defaultLanguage: communication.defaultLanguage ?? "zh-CN", toneText: lines(communication.tone), responseDensity: communication.responseDensity ?? "BALANCED", customInstructions: communication.customInstructions ?? "", greeting: manifest.persona.greeting ?? "", startersText: lines(manifest.persona.conversationStarters),
    modelProfileId: manifest.capabilities.model.defaultProfileId, toolIds: manifest.capabilities.tools.map((item) => item.id), skillIds: manifest.capabilities.skills.map((item) => item.id), mcpIds: manifest.capabilities.mcpConnections.map((item) => item.id), knowledgeBaseIds: manifest.capabilities.knowledgeBases.map((item) => item.id),
    memoryMode: manifest.memory.mode, shortTermStrategy: manifest.memory.shortTerm.strategy, maxContextTokens: manifest.memory.shortTerm.maxContextTokens, memoryCategories: manifest.memory.longTerm.categories, memoryWriteMode: manifest.memory.longTerm.writeMode, memoryRetrievalMode: manifest.memory.longTerm.retrievalMode, memoryTopK: manifest.memory.longTerm.topK, minRelevance: manifest.memory.longTerm.minRelevance ?? 0.72,
    approvalPreset: manifest.safety.approvalPreset === "CUSTOM" ? "CONSERVATIVE" : manifest.safety.approvalPreset, autonomy: manifest.runtime.autonomy, planning: manifest.runtime.planning, maxSteps: manifest.runtime.maxSteps, timeoutSeconds: manifest.runtime.timeoutSeconds, failureStrategy: manifest.runtime.failureStrategy ?? "ASK_USER",
    evaluationSuiteIds: manifest.evaluation?.suiteIds ?? [], requiredBeforePublish: manifest.evaluation?.requiredBeforePublish ?? false, minimumPassRate: manifest.evaluation?.minimumPassRate ?? 0.9,
  };
}

function manifestFromForm(values: AgentFormData): AgentManifestV2 {
  const personalized = values.memoryMode === "PERSONALIZED";
  return {
    schemaVersion: 2,
    identity: { displayName: values.displayName.trim(), description: values.description.trim(), category: values.category.trim(), tags: splitLines(values.tagsText) },
    persona: { role: values.role.trim(), mission: values.mission.trim(), audience: values.audience.trim(), responsibilities: splitLines(values.responsibilitiesText), boundaries: splitLines(values.boundariesText), traits: splitLines(values.traitsText), communication: { defaultLanguage: values.defaultLanguage.trim(), tone: splitLines(values.toneText), responseDensity: values.responseDensity, customInstructions: values.customInstructions.trim() }, greeting: values.greeting.trim(), conversationStarters: splitLines(values.startersText), exampleDialogs: [] },
    capabilities: { model: { defaultProfileId: values.modelProfileId, fallbackProfileIds: [], selectionMode: "FIXED" }, tools: references(values.toolIds), skills: references(values.skillIds), mcpConnections: references(values.mcpIds), knowledgeBases: references(values.knowledgeBaseIds), collaborators: [] },
    memory: { mode: values.memoryMode, shortTerm: { strategy: values.shortTermStrategy, maxContextTokens: values.maxContextTokens }, longTerm: { enabled: personalized, categories: personalized ? values.memoryCategories : [], writeMode: values.memoryWriteMode, retrievalMode: values.memoryRetrievalMode, topK: values.memoryTopK, minRelevance: values.minRelevance, ttlDays: null, requireEvidence: true, sensitiveDataPolicy: "REJECT" } },
    runtime: { autonomy: values.autonomy, planning: values.planning, maxSteps: values.maxSteps, timeoutSeconds: values.timeoutSeconds, maxModelTokens: 64000, maxEstimatedCost: null, failureStrategy: values.failureStrategy },
    safety: { approvalPreset: values.approvalPreset, inputGuardrails: [], outputGuardrails: [] },
    presentation: { themeToken: "default", showPlanByDefault: values.planning === "VISIBLE", showMemoryUsage: values.memoryMode === "PERSONALIZED" },
    evaluation: { suiteIds: values.evaluationSuiteIds, requiredBeforePublish: values.requiredBeforePublish, minimumPassRate: values.minimumPassRate },
    extensions: {},
  };
}

function newManifest(values: { displayName: string; description: string; category: string }, models: ModelProfile[], t: Translate): AgentManifestV2 {
  const form = emptyForm(models, t);
  form.displayName = values.displayName.trim();
  form.description = values.description.trim();
  form.category = values.category.trim();
  form.role = values.displayName.trim();
  form.mission = values.description.trim() || t("agentDefaultMission").replace("{name}", values.displayName.trim());
  form.responsibilitiesText = t("agentDefaultResponsibility");
  form.boundariesText = t("agentDefaultBoundary");
  return manifestFromForm(form);
}

function errorMessage(error: unknown, fallback: string, t: Translate) {
  if (error instanceof StudioApiError) {
    if (error.code === "AGENT_EVALUATION_REQUIRED") return t("agentEvaluationRequired");
    if (error.message.startsWith("Missing model API key.")) return t("agentModelCredentialRequired");
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatDate(value: string, t: Translate) { return new Intl.DateTimeFormat(t("agentDefaultLanguage"), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
