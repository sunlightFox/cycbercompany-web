import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Children, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioApi } from "../lib/api";
import type { ClawHubSkill, Skill, SkillHubSkill } from "../types";

type ResourceQuery = { isLoading: boolean; isError: boolean; refetch: () => unknown };
type MarketplaceCategory = "all" | "development" | "data" | "search" | "automation" | "content" | "other";
type MarketplaceSort = "popular" | "newest" | "name";

const marketplaceCategories: MarketplaceCategory[] = ["all", "development", "data", "search", "automation", "content", "other"];

function marketplaceCategory(item: { name: string; description?: string; sourceType?: string }): MarketplaceCategory {
  const text = `${item.name} ${item.description ?? ""}`.toLowerCase();
  if (/code|dev|git|program|developer|开发|编码/.test(text)) return "development";
  if (/data|database|sql|excel|表格|数据/.test(text)) return "data";
  if (/search|web|browser|news|搜索|检索/.test(text)) return "search";
  if (/automat|workflow|自动|工作流|task|任务|agent|代理/.test(text)) return "automation";
  if (/image|video|audio|write|content|图像|视频|写作|内容/.test(text)) return "content";
  return "other";
}

function categoryLabel(category: MarketplaceCategory, t: (key: string) => string) {
  if (category === "all") return t("all");
  if (category === "development") return t("categoryDevelopment");
  if (category === "data") return t("categoryData");
  if (category === "search") return t("categorySearch");
  if (category === "automation") return t("categoryAutomation");
  if (category === "content") return t("categoryContent");
  return t("categoryOther");
}

function sortMarketplaceItems<T extends { id?: string; name: string; stars?: number; downloads?: number }>(items: T[], sort: MarketplaceSort) {
  return [...items].sort((left, right) => sort === "name" ? left.name.localeCompare(right.name) : sort === "newest" ? String(right.id ?? "").localeCompare(String(left.id ?? "")) : (right.downloads ?? right.stars ?? 0) - (left.downloads ?? left.stars ?? 0));
}
export default function SkillsManager({
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
  const [searchSource, setSearchSource] = useState("skillhub");
  const [marketCategory, setMarketCategory] = useState<MarketplaceCategory>("all");
  const [marketSort, setMarketSort] = useState<MarketplaceSort>("popular");
  const [selectedSkillHubSkill, setSelectedSkillHubSkill] = useState<SkillHubSkill | null>(null);
  const [selectedClawHubSkill, setSelectedClawHubSkill] = useState<ClawHubSkill | null>(null);
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
  const marketplaceQuery = useQuery({
    queryKey: ["skill-marketplace", search],
    queryFn: () => studioApi.getSkillMarketplace({ query: search, limit: 30 }),
    enabled: section === "marketplace",
  });
  const installMutation = useMutation({
    mutationFn: studioApi.installSkillHubSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setNotice(t("completed"));
    },
  });
  const installClawHubMutation = useMutation({
    mutationFn: studioApi.installClawHubSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setNotice(t("completed"));
    },
  });
  const installingRepositorySkillId = installMutation.isPending
    ? installMutation.variables?.reference
    : undefined;
  const installingClawHubReference = installClawHubMutation.isPending
    ? installClawHubMutation.variables?.reference
    : undefined;
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
  const skillHubSkills = sortMarketplaceItems((marketplaceQuery.data?.skillHubSkills ?? []).filter((skill) => marketCategory === "all" || marketplaceCategory(skill) === marketCategory), marketSort);
  const clawHubSkills = sortMarketplaceItems((marketplaceQuery.data?.clawHubSkills ?? []).filter((skill) => marketCategory === "all" || marketplaceCategory(skill) === marketCategory), marketSort);
  const installedSources = new Set(installed.map((skill) => skill.sourceRepository));

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
          setNotice("");
          setSelectedSkillHubSkill(null);
          setSelectedClawHubSkill(null);
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
            pending={marketplaceQuery.isFetching}
            source={searchSource}
            onSourceChange={(src) => {
              setSearchSource(src);
              setMarketCategory("all");
              setSelectedSkillHubSkill(null);
              setSelectedClawHubSkill(null);
            }}
            onSubmit={() => {
              setNotice("");
              setSelectedSkillHubSkill(null);
              setSelectedClawHubSkill(null);
              void marketplaceQuery.refetch();
            }}
            t={t}
            category={marketCategory}
            onCategoryChange={setMarketCategory}
            sort={marketSort}
            onSortChange={setMarketSort}
          />
          {selectedSkillHubSkill ? (
            <SkillMarketplaceDetail
              skill={selectedSkillHubSkill}
              sourceLabel={t("searchSkillHub")}
              installed={installedSources.has(`skillhub/${selectedSkillHubSkill.reference}`)}
              installing={installingRepositorySkillId === selectedSkillHubSkill.reference}
              installError={installMutation.error}
              onBack={() => setSelectedSkillHubSkill(null)}
              onInstall={() => installMutation.mutate({ reference: selectedSkillHubSkill.reference, enabled: true, overwrite: false })}
              t={t}
            />
          ) : selectedClawHubSkill ? (
            <SkillMarketplaceDetail
              skill={selectedClawHubSkill}
              sourceLabel={t("searchClawHub")}
              installed={installedSources.has(`clawhub/${selectedClawHubSkill.reference}`)}
              installing={installingClawHubReference === selectedClawHubSkill.reference}
              installError={installClawHubMutation.error}
              reviewRequired={selectedClawHubSkill.suspicious}
              onBack={() => setSelectedClawHubSkill(null)}
              onInstall={() => installClawHubMutation.mutate({ reference: selectedClawHubSkill.reference, enabled: true, overwrite: false })}
              t={t}
            />
          ) : searchSource === "skillhub" ? (
            <SkillHubSkillResults
              skills={skillHubSkills}
              loading={marketplaceQuery.isLoading || marketplaceQuery.isFetching}
              error={marketplaceQuery.error}
              installed={installed}
              installing={installMutation.isPending}
              installingReference={installingRepositorySkillId}
              installError={installMutation.error}
              onRetry={() => void marketplaceQuery.refetch()}
              onInstall={(skill) => installMutation.mutate({ reference: skill.reference, enabled: true, overwrite: false })}
              onInspect={setSelectedSkillHubSkill}
              t={t}
            />
          ) : (
            <ClawHubSkillResults
              skills={clawHubSkills}
              loading={marketplaceQuery.isLoading || marketplaceQuery.isFetching}
              error={marketplaceQuery.error}
              installed={installed}
              installing={installClawHubMutation.isPending}
              installingReference={installingClawHubReference}
              installError={installClawHubMutation.error}
              onRetry={() => void marketplaceQuery.refetch()}
              onInstall={(skill) => installClawHubMutation.mutate({ reference: skill.reference, enabled: true, overwrite: false })}
              onInspect={setSelectedClawHubSkill}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ClawHubSkillResults({
  skills,
  loading,
  error,
  installed,
  installing,
  installingReference,
  installError,
  onRetry,
  onInstall,
  onInspect,
  t,
}: {
  skills: ClawHubSkill[];
  loading: boolean;
  error: unknown;
  installed: Skill[];
  installing: boolean;
  installingReference?: string;
  installError: unknown;
  onRetry: () => void;
  onInstall: (skill: ClawHubSkill) => void;
  onInspect: (skill: ClawHubSkill) => void;
  t: (key: string) => string;
}) {
  if (loading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loadingRepositories")}</span></div>;
  if (error) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{error instanceof Error ? error.message : t("repositoryLoadFailed")}</span><button type="button" className="secondary-button" onClick={onRetry}>{t("retryLoad")}</button></div>;
  const installedSources = new Set(installed.map((skill) => skill.sourceRepository));
  return skills.length ? (
    <div className="repository-grid">
      {installError ? <div className="manager-notice error"><CircleAlert size={14} />{installError instanceof Error ? installError.message : t("installFailed")}</div> : null}
      {skills.map((skill) => {
        const isInstalled = installedSources.has(`clawhub/${skill.reference}`);
        const isInstalling = installingReference === skill.reference;
        return <article
          className="marketplace-card is-clickable"
          key={skill.id}
          role="button"
          tabIndex={0}
          aria-label={`${t("viewDetails")} ${skill.name}`}
          onClick={() => onInspect(skill)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onInspect(skill);
            }
          }}
        >
          <div className="marketplace-card-icon" aria-hidden="true">
            <Sparkles size={20} />
          </div>
          <div className="repository-main">
            <div className="repository-title"><strong>{skill.name}</strong>{skill.official ? <span className="repository-stars">{t("official")}</span> : null}</div>
            <p>{skill.description || t("noDescription")}</p>
            <span className="repository-source">ClawHub · {skill.reference} · {skill.downloads.toLocaleString()} {t("downloads")}</span>
          </div>
          <div className="marketplace-card-meta">
            <span>{categoryLabel(marketplaceCategory(skill), t)}</span>
            {skill.suspicious ? <span>{t("reviewRequired")}</span> : null}
          </div>
          <div className="repository-actions">
            <a className="icon-button" href={skill.url} target="_blank" rel="noreferrer" aria-label={t("openRepository")} title={t("openRepository")} onClick={(event) => event.stopPropagation()}><ExternalLink size={15} /></a>
            <button type="button" className={isInstalled ? "secondary-button" : "primary-button"} disabled={isInstalled || installing || skill.suspicious} onClick={(event) => {
              event.stopPropagation();
              onInstall(skill);
            }}>
              {isInstalling ? <LoaderCircle size={14} className="spin" /> : <Package size={14} />}{isInstalled ? t("installed") : skill.suspicious ? t("reviewRequired") : t("install")}
            </button>
          </div>
        </article>;
      })}
    </div>
  ) : <div className="manager-placeholder compact">{t("noRepositories")}</div>;
}

function SkillHubSkillResults({
  skills,
  loading,
  error,
  installed,
  installing,
  installingReference,
  installError,
  onRetry,
  onInstall,
  onInspect,
  t,
}: {
  skills: SkillHubSkill[];
  loading: boolean;
  error: unknown;
  installed: Skill[];
  installing: boolean;
  installingReference?: string;
  installError: unknown;
  onRetry: () => void;
  onInstall: (skill: SkillHubSkill) => void;
  onInspect: (skill: SkillHubSkill) => void;
  t: (key: string) => string;
}) {
  if (loading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loadingRepositories")}</span></div>;
  if (error) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{error instanceof Error ? error.message : t("repositoryLoadFailed")}</span><button type="button" className="secondary-button" onClick={onRetry}>{t("retryLoad")}</button></div>;
  const installedSources = new Set(installed.map((skill) => skill.sourceRepository));
  return skills.length ? (
    <div className="repository-grid">
      {installError ? <div className="manager-notice error"><CircleAlert size={14} />{installError instanceof Error ? installError.message : t("installFailed")}</div> : null}
      {skills.map((skill) => {
        const isInstalled = installedSources.has(`skillhub/${skill.reference}`);
        const isInstalling = installingReference === skill.reference;
        return <article
          className="marketplace-card is-clickable"
          key={skill.id}
          role="button"
          tabIndex={0}
          aria-label={`${t("viewDetails")} ${skill.name}`}
          onClick={() => onInspect(skill)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onInspect(skill);
            }
          }}
        >
          <div className="marketplace-card-icon" aria-hidden="true">
            <Sparkles size={20} />
          </div>
          <div className="repository-main">
            <div className="repository-title"><strong>{skill.name}</strong>{skill.verified ? <span className="repository-stars">{t("verified")}</span> : null}</div>
            <p>{skill.description || t("noDescription")}</p>
            <span className="repository-source">SkillHub · {skill.reference} · {skill.downloads.toLocaleString()} {t("downloads")}</span>
          </div>
          <div className="marketplace-card-meta">
            <span>{categoryLabel(marketplaceCategory(skill), t)}</span>
            <span>{skill.downloads.toLocaleString()} {t("downloads")}</span>
          </div>
          <div className="repository-actions">
            <a className="icon-button" href={skill.url} target="_blank" rel="noreferrer" aria-label={t("openRepository")} title={t("openRepository")} onClick={(event) => event.stopPropagation()}><ExternalLink size={15} /></a>
            <button type="button" className={isInstalled ? "secondary-button" : "primary-button"} disabled={isInstalled || installing} onClick={(event) => {
              event.stopPropagation();
              onInstall(skill);
            }}>
              {isInstalled ? <Check size={14} /> : isInstalling ? <LoaderCircle size={14} className="spin" /> : <Package size={14} />}{isInstalled ? t("installed") : isInstalling ? t("loading") : t("install")}
            </button>
          </div>
        </article>;
      })}
    </div>
  ) : <div className="manager-placeholder compact">{t("noRepositories")}</div>;
}

function SkillMarketplaceDetail({
  skill,
  sourceLabel,
  installed,
  installing,
  installError,
  reviewRequired = false,
  onBack,
  onInstall,
  t,
}: {
  skill: SkillHubSkill | ClawHubSkill;
  sourceLabel: string;
  installed: boolean;
  installing: boolean;
  installError: unknown;
  reviewRequired?: boolean;
  onBack: () => void;
  onInstall: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="marketplace-detail">
      <button type="button" className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={14} />
        {t("backToRepositories")}
      </button>
      <div className="marketplace-detail-heading">
        <div className="marketplace-card-icon" aria-hidden="true">
          <Sparkles size={20} />
        </div>
        <div>
          <h4>{skill.name}</h4>
          <p>{skill.description || t("noDescription")}</p>
        </div>
        <a href={skill.url} target="_blank" rel="noreferrer" className="source-link">
          <ExternalLink size={13} />
          {t("openRepository")}
        </a>
      </div>
      {installError ? (
        <div className="manager-notice error" role="alert">
          <CircleAlert size={14} />
          {installError instanceof Error ? installError.message : t("installFailed")}
        </div>
      ) : null}
      {reviewRequired ? (
        <div className="manager-notice error" role="alert">
          <CircleAlert size={14} />
          {t("reviewRequired")}
        </div>
      ) : null}
      <dl className="marketplace-detail-grid">
        <div>
          <dt>{t("searchSource")}</dt>
          <dd>{sourceLabel}</dd>
        </div>
        <div>
          <dt>{t("category")}</dt>
          <dd>{categoryLabel(marketplaceCategory(skill), t)}</dd>
        </div>
        <div>
          <dt>{t("reference")}</dt>
          <dd>{skill.reference}</dd>
        </div>
        <div>
          <dt>{t("popularity")}</dt>
          <dd>{skill.downloads.toLocaleString()} {t("downloads")}</dd>
        </div>
      </dl>
      <div className="marketplace-detail-actions">
        <button
          type="button"
          className={installed ? "secondary-button" : "primary-button"}
          disabled={installed || installing || reviewRequired}
          onClick={onInstall}
        >
          {installed ? <Check size={14} /> : installing ? <LoaderCircle size={14} className="spin" /> : <Package size={14} />}
          {installed ? t("installed") : installing ? t("loading") : t("quickInstall")}
        </button>
      </div>
    </div>
  );
}

function ManagerSubTabs({ value, onChange, t }: { value: string; onChange: (value: string) => void; t: (key: string) => string }) {
  return <div className="manager-subtabs" role="tablist"><button type="button" role="tab" aria-selected={value === "installed"} className={value === "installed" ? "is-active" : ""} onClick={() => onChange("installed")}>{t("installed")}</button><button type="button" role="tab" aria-selected={value === "marketplace"} className={value === "marketplace" ? "is-active" : ""} onClick={() => onChange("marketplace")}>{t("marketplace")}</button></div>;
}

function RepositorySearch({ value, onChange, onSubmit, pending, source, onSourceChange, t, category, onCategoryChange, sort, onSortChange }: { value: string; onChange: (value: string) => void; onSubmit: () => void; pending: boolean; source: string; onSourceChange: (source: string) => void; t: (key: string) => string; category?: MarketplaceCategory; onCategoryChange?: (category: MarketplaceCategory) => void; sort?: MarketplaceSort; onSortChange?: (sort: MarketplaceSort) => void }) {
  return <div className="marketplace-controls"><form className="repository-search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><Search size={15} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("repositorySearchPlaceholder")} aria-label={t("repositorySearchPlaceholder")} /><select className="source-select" value={source} onChange={(event) => onSourceChange(event.target.value)} aria-label={t("searchSource")}><option value="skillhub">{t("searchSkillHub")}</option><option value="clawhub">{t("searchClawHub")}</option></select>{onSortChange ? <select className="source-select" value={sort} onChange={(event) => onSortChange(event.target.value as MarketplaceSort)} aria-label={t("sortBy")}><option value="popular">{t("sortPopular")}</option><option value="newest">{t("sortNewest")}</option><option value="name">{t("sortName")}</option></select> : null}<button type="submit" className="secondary-button" disabled={pending}>{pending ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{t("search")}</button></form>{onCategoryChange ? <nav className="marketplace-category-nav" aria-label={t("category")}>{marketplaceCategories.map((item) => <button key={item} type="button" className={category === item ? "is-active" : ""} aria-pressed={category === item} onClick={() => onCategoryChange(item)}>{categoryLabel(item, t)}</button>)}</nav> : null}</div>;
}

function QueryResourceState({ query, children, t }: { query: ResourceQuery; children: ReactNode; t: (key: string) => string }) {
  if (query.isLoading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>;
  if (query.isError) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{t("loadFailed")}</span><button type="button" className="secondary-button" onClick={() => void query.refetch()}>{t("retryLoad")}</button></div>;
  return <div className="manager-list">{Children.count(children) ? children : <div className="manager-placeholder compact"><span>{t("emptyList")}</span></div>}</div>;
}

function ResourceRow({ icon, title, detail, status, trailing }: { icon: ReactNode; title: string; detail: string; status?: string; trailing: ReactNode }) { return <div className="manager-list-item"><span className="model-glyph">{icon}</span><div><strong>{title}</strong><span>{detail}</span></div>{status ? <span className="list-status">{status}</span> : null}{trailing}</div>; }
function ToggleButton({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} aria-pressed={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>; }
function InlineDangerConfirm({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) { const { t } = useTranslation(); return <div className="inline-danger-confirm"><CircleAlert size={16} /><div><strong>{title}</strong><p>{description}</p></div><div className="inline-form-actions"><button className="secondary-button" type="button" onClick={onCancel}>{t("cancel")}</button><button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : null}{confirmLabel}</button></div></div>; }
