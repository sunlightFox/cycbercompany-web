import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioApi } from "../lib/api";
import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeSettings,
  KnowledgeSettingsUpdate,
} from "../types";
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

export default function KnowledgeManager({
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

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  const button = <button className="icon-button" aria-label={label} type="button" onClick={onClick} disabled={disabled}>{children}</button>;
  return <Tooltip.Root><Tooltip.Trigger asChild>{button}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

function ConfirmDeleteButton({ name, description, busy = false, onConfirm }: { name: string; description: string; busy?: boolean; onConfirm: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (confirming) return <span className="row-delete-confirm" role="alert"><span><strong>{t("confirmDelete")}</strong><small>{description}</small></span><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={13} className="spin" /> : null}{t("delete")}</button><button type="button" className="text-button" disabled={busy} onClick={() => setConfirming(false)}>{t("cancel")}</button></span>;
  return <IconButton label={`${t("delete")} ${name}`} onClick={() => setConfirming(true)}><Trash2 size={14} /></IconButton>;
}

function InlineDangerConfirm({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return <div className="inline-danger-confirm"><CircleAlert size={16} /><div><strong>{title}</strong><p>{description}</p></div><div className="inline-form-actions"><button className="secondary-button" type="button" onClick={onCancel}>{t("cancel")}</button><button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : null}{confirmLabel}</button></div></div>;
}

function QueryResourceState({ query, children, t }: { query: ResourceQuery; children: ReactNode; t: (key: string) => string }) {
  if (query.isLoading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>;
  if (query.isError) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{t("loadFailed")}</span><button type="button" className="secondary-button" onClick={() => void query.refetch()}>{t("retryLoad")}</button></div>;
  return <div className="manager-list">{Children.count(children) ? children : <div className="manager-placeholder compact"><span>{t("emptyList")}</span></div>}</div>;
}

function ResourceRow({ icon, title, detail, status, trailing }: { icon: ReactNode; title: string; detail: string; status?: string; trailing: ReactNode }) {
  return <div className="manager-list-item"><span className="model-glyph">{icon}</span><div><strong>{title}</strong><span>{detail}</span></div>{status ? <span className="list-status">{status}</span> : null}{trailing}</div>;
}

function formatDuration(milliseconds: number) {
  return `${Math.max(0, Math.round(milliseconds / 1000))}`;
}
