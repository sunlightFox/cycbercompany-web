import { Bot, Check, CheckCircle2, CircleAlert, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Agent, ModelProfile, Skill, Tool } from "../types";
import { studioApi } from "../lib/api";

const agentIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

const agentFormSchema = z.object({
  id: z.string().trim().regex(agentIdPattern),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  systemPrompt: z.string().trim().min(1).max(12000),
  defaultModelProfileId: z.string(),
  toolAllowList: z.array(z.string()),
  defaultSkillIds: z.array(z.string()),
  enabled: z.boolean(),
});

type AgentFormData = z.infer<typeof agentFormSchema>;

const emptyAgentForm: AgentFormData = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  defaultModelProfileId: "",
  toolAllowList: [],
  defaultSkillIds: [],
  enabled: true,
};

export function AgentManager({
  agents,
  models,
  skills,
  tools,
  query,
  t,
}: {
  agents: Agent[];
  models: ModelProfile[];
  skills: Skill[];
  tools: Tool[];
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [expandedToolGroups, setExpandedToolGroups] = useState<Record<string, boolean>>({ "built-in": true });
  const form = useForm<AgentFormData>({ defaultValues: emptyAgentForm });
  const selectedTools = form.watch("toolAllowList") ?? [];
  const selectedSkills = form.watch("defaultSkillIds") ?? [];
  const normalizedToolSearch = toolSearch.trim().toLowerCase();
  const visibleTools = tools.filter((tool) => {
    if (!normalizedToolSearch) return true;
    return `${tool.name} ${tool.description}`.toLowerCase().includes(normalizedToolSearch);
  });
  const toolGroups = [
    {
      id: "built-in",
      label: t("agentTools"),
      tools: visibleTools.filter((tool) => !isExternalToolName(tool.name) && !tool.name.startsWith("skill.")),
    },
    {
      id: "integrations",
      label: t("mcpTools"),
      tools: visibleTools.filter((tool) => isExternalToolName(tool.name)),
    },
    {
      id: "skills",
      label: t("skills"),
      tools: visibleTools.filter((tool) => tool.name.startsWith("skill.")),
    },
  ].filter((group) => group.tools.length);

  const saveMutation = useMutation({
    mutationFn: (values: AgentFormData) => {
      const policy = {
        defaultModelProfileId: values.defaultModelProfileId || null,
        toolAllowList: values.toolAllowList,
        defaultSkillIds: values.defaultSkillIds,
        enabled: values.enabled,
      };
      return editingAgent
        ? studioApi.updateAgent(editingAgent.id, {
            name: values.name,
            description: values.description,
            systemPrompt: values.systemPrompt,
            ...policy,
          })
        : studioApi.createAgent({
            id: values.id,
            name: values.name,
            description: values.description,
            systemPrompt: values.systemPrompt,
            ...policy,
          });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      setEditorOpen(false);
      setEditingAgent(null);
      setSaveError("");
      setNotice(t("agentSaved"));
    },
    onError: (error) => {
      setSaveError(error instanceof Error ? error.message : t("agentSaveFailed"));
    },
  });

  const openEditor = (agent?: Agent) => {
    setEditingAgent(agent ?? null);
    form.reset(
      agent
        ? {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            systemPrompt: agent.systemPrompt,
            defaultModelProfileId: agent.defaultModelProfileId ?? "",
            toolAllowList: agent.toolAllowList ?? [],
            defaultSkillIds: agent.defaultSkillIds ?? [],
            enabled: agent.enabled,
          }
        : {
            ...emptyAgentForm,
            toolAllowList: tools
              .filter((tool) => !tool.requiresApproval && !tool.name.startsWith("skill.") && !isExternalToolName(tool.name))
              .map((tool) => tool.name),
          },
    );
    setNotice("");
    setSaveError("");
    setEditorOpen(true);
  };

  const submit = form.handleSubmit((values) => {
    const parsed = agentFormSchema.safeParse(values);
    if (!parsed.success) {
      setSaveError(t("agentSaveFailed"));
      return;
    }
    saveMutation.mutate(parsed.data);
  });

  const fieldError = (name: keyof AgentFormData) =>
    form.formState.errors[name]?.message;
  const toggleTool = (name: string, checked: boolean) => {
    form.setValue(
      "toolAllowList",
      checked ? [...selectedTools, name] : selectedTools.filter((item) => item !== name),
      { shouldDirty: true },
    );
  };
  const toggleSkill = (id: string, checked: boolean) => {
    form.setValue(
      "defaultSkillIds",
      checked ? [...selectedSkills, id] : selectedSkills.filter((item) => item !== id),
      { shouldDirty: true },
    );
  };

  if (query.isLoading) {
    return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>;
  }

  if (query.isError) {
    return (
      <div className="manager-placeholder">
        <CircleAlert size={18} />
        <span>{t("loadFailed")}</span>
        <button type="button" className="secondary-button" onClick={() => void query.refetch()}>{t("retryLoad")}</button>
      </div>
    );
  }

  return (
    <div className="agent-manager">
      <div className="agent-toolbar">
        <span>{agents.length ? `${agents.length} ${t("agents")}` : t("emptyList")}</span>
        <button type="button" className="primary-button" onClick={() => openEditor()}>
          <Plus size={14} />
          {t("newAgent")}
        </button>
      </div>
      {notice ? <div className="manager-notice success"><CheckCircle2 size={14} />{notice}</div> : null}
      {saveError ? <div className="manager-notice error"><CircleAlert size={14} />{saveError}</div> : null}
      {agents.length ? (
        <div className="manager-list">
          {agents.map((agent) => (
            <div className="manager-list-item" key={agent.id}>
              <span className="model-glyph"><Bot size={15} /></span>
              <div>
                <strong>{agent.name}</strong>
                <span>{agent.description || t("noDescription")}</span>
              </div>
              <span className="list-status"><span className="status-dot" data-online={agent.enabled} />{agent.enabled ? t("online") : t("disabled")}</span>
              <button type="button" className="text-button" onClick={() => openEditor(agent)}>{t("editAgent")}</button>
            </div>
          ))}
        </div>
      ) : <div className="manager-placeholder compact"><span>{t("emptyList")}</span></div>}
      {editorOpen ? (
        <section className="agent-editor" aria-label={editingAgent ? t("editAgent") : t("newAgent")}>
          <div className="agent-editor-header">
            <div>
              <h4>{editingAgent ? t("editAgent") : t("newAgent")}</h4>
              <p>{t("agentConfiguration")}</p>
            </div>
            <button type="button" className="icon-button" aria-label={t("close")} title={t("close")} onClick={() => setEditorOpen(false)}><X size={16} /></button>
          </div>
          <form className="agent-editor-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            {!editingAgent ? (
              <label>
                {t("agentId")}
                <input {...form.register("id")} autoFocus />
                <small className="form-note">{t("agentIdHint")}</small>
                {fieldError("id") ? <small className="form-error">{fieldError("id")}</small> : null}
              </label>
            ) : null}
            <label>
              {t("agentName")}
              <input {...form.register("name")} autoFocus={Boolean(editingAgent)} />
              {fieldError("name") ? <small className="form-error">{fieldError("name")}</small> : null}
            </label>
            <label>
              {t("description")}
              <textarea {...form.register("description")} rows={2} />
              {fieldError("description") ? <small className="form-error">{fieldError("description")}</small> : null}
            </label>
            <label>
              {t("agentPersona")}
              <textarea {...form.register("systemPrompt")} rows={8} />
              <small className="form-note">{t("agentPersonaHint")}</small>
              {fieldError("systemPrompt") ? <small className="form-error">{fieldError("systemPrompt")}</small> : null}
            </label>
            <div className="agent-policy-grid">
              <label>
                {t("agentDefaultModel")}
                <select {...form.register("defaultModelProfileId")}>
                  <option value="">{t("agentUseGlobalModel")}</option>
                  {models.filter((model) => model.enabled).map((model) => (
                    <option value={model.id} key={model.id}>{model.modelName} · {model.id}</option>
                  ))}
                </select>
              </label>
              <label className="agent-enabled-option">
                <span>{t("agentEnabled")}</span>
                <span className="agent-toggle-row">
                  <input type="checkbox" {...form.register("enabled")} />
                  <span>{form.watch("enabled") ? t("enabled") : t("disabled")}</span>
                </span>
              </label>
            </div>
            <fieldset className="agent-policy-fieldset">
              <legend>{t("agentTools")}</legend>
              {tools.length ? (
                <>
                  <label className="agent-tool-search">
                    <Search size={14} aria-hidden="true" />
                    <span className="visually-hidden">{t("search")}</span>
                    <input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder={t("search")} aria-label={t("search")} />
                  </label>
                  <p className="form-note agent-policy-count">{selectedTools.length} / {tools.length}</p>
                  {toolGroups.length ? toolGroups.map((group, index) => (
                    <details
                      className="agent-tool-group"
                      key={group.id}
                      open={expandedToolGroups[group.id] ?? index === 0}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setExpandedToolGroups((current) => ({ ...current, [group.id]: open }));
                      }}
                    >
                      <summary><strong>{group.label}</strong><span>{group.tools.filter((tool) => selectedTools.includes(tool.name)).length} / {group.tools.length}</span></summary>
                      <div className="agent-check-list">
                        {group.tools.map((tool) => (
                          <label className="agent-check-option" key={tool.name}>
                            <input type="checkbox" checked={selectedTools.includes(tool.name)} onChange={(event) => toggleTool(tool.name, event.target.checked)} />
                            <span><strong>{tool.name}</strong><small>{tool.description || "-"}</small></span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )) : <p className="form-note">{t("agentNoTools")}</p>}
                </>
              ) : <p className="form-note">{t("agentNoTools")}</p>}
            </fieldset>
            <fieldset className="agent-policy-fieldset">
              <legend>{t("agentSkills")}</legend>
              {skills.filter((skill) => skill.enabled).length ? (
                <div className="agent-check-list">
                  {skills.filter((skill) => skill.enabled).map((skill) => (
                    <label className="agent-check-option" key={skill.id}>
                      <input type="checkbox" checked={selectedSkills.includes(skill.id)} onChange={(event) => toggleSkill(skill.id, event.target.checked)} />
                      <span><strong>{skill.name}</strong><small>{skill.description || skill.id}</small></span>
                    </label>
                  ))}
                </div>
              ) : <p className="form-note">{t("agentNoSkills")}</p>}
            </fieldset>
            <div className="inline-form-actions">
              <button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>{t("cancel")}</button>
              <button type="submit" className="primary-button" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                {saveMutation.isPending ? t("agentSaving") : t("agentSave")}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function isExternalToolName(name: string) {
  return name.startsWith("mcp:") || name.startsWith("mcp_") || name.startsWith("node:") || name.startsWith("node_");
}
