import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Pencil,
  Plus,
  PlugZap,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioApi } from "../lib/api";
import type { ModelCapability, ModelPreset, ModelProfile, ModelTestResult } from "../types";
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

export default function ModelManager({
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

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const button = (
    <button className="icon-button" aria-label={label} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
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
        <button className="secondary-button" type="button" onClick={onCancel}>{t("cancel")}</button>
        <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>
          {busy ? <LoaderCircle size={14} className="spin" /> : null}
          {confirmLabel}
        </button>
      </div>
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
    <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} aria-pressed={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
