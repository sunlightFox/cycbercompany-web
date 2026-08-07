import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileJson,
  Globe2,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Children, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioApi } from "../lib/api";
import type { McpConnection, McpRepository, McpTool, McpToolInvocation, SkillRepository } from "../types";

type ResourceQuery = { isLoading: boolean; isError: boolean; refetch: () => unknown };
type MarketplaceCategory = "all" | "development" | "data" | "search" | "automation" | "content" | "other";
type MarketplaceSort = "popular" | "newest" | "name";

const marketplaceCategories: MarketplaceCategory[] = [
  "all",
  "development",
  "data",
  "search",
  "automation",
  "content",
  "other",
];

function marketplaceCategory(item: { name: string; description?: string; sourceType?: string }): MarketplaceCategory {
  const text = `${item.name} ${item.description ?? ""}`.toLocaleLowerCase();
  if (/search|搜索|browser|浏览|crawl|爬|web|网页/.test(text)) return "search";
  if (/data|数据库|database|sql|excel|数据|notion/.test(text)) return "data";
  if (/automat|workflow|自动|工作流|task|任务|agent|代理/.test(text)) return "automation";
  if (/content|内容|write|写作|文档|markdown|image|图片/.test(text)) return "content";
  if (/code|开发|developer|github|git|debug|编程|api/.test(text)) return "development";
  return "other";
}

function categoryLabel(category: MarketplaceCategory, t: (key: string) => string) {
  if (category === "all") return t("categoryAll");
  if (category === "development") return t("categoryDevelopment");
  if (category === "data") return t("categoryData");
  if (category === "search") return t("categorySearch");
  if (category === "automation") return t("categoryAutomation");
  if (category === "content") return t("categoryContent");
  return t("categoryOther");
}

function sortMarketplaceItems<T extends { id?: string; name: string; stars?: number; downloads?: number }>(items: T[], sort: MarketplaceSort) {
  return [...items].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "newest") return (b.id ?? "").localeCompare(a.id ?? "");
    return ((b.stars ?? 0) + (b.downloads ?? 0)) - ((a.stars ?? 0) + (a.downloads ?? 0));
  });
}

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
  t,
  mcpMarketOnly = false,
  category = "all",
  onCategoryChange,
  sort = "popular",
  onSortChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  source: string;
  onSourceChange: (source: string) => void;
  t: (key: string) => string;
  mcpMarketOnly?: boolean;
  category?: MarketplaceCategory;
  onCategoryChange?: (category: MarketplaceCategory) => void;
  sort?: MarketplaceSort;
  onSortChange?: (sort: MarketplaceSort) => void;
}) {
  return (
    <div className="marketplace-controls">
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
          {mcpMarketOnly ? (
            <option value="mcpmarket">{t("mcpMarket")}</option>
          ) : (
            <>
              <option value="skillhub">{t("searchSkillHub")}</option>
              <option value="clawhub">{t("searchClawHub")}</option>
            </>
          )}
        </select>
        {onSortChange ? (
          <select className="source-select" value={sort} onChange={(event) => onSortChange(event.target.value as MarketplaceSort)} aria-label={t("sortBy")}>
            <option value="popular">{t("sortPopular")}</option>
            <option value="newest">{t("sortNewest")}</option>
            <option value="name">{t("sortName")}</option>
          </select>
        ) : null}
        <button type="submit" className="secondary-button" disabled={pending}>
          {pending ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Search size={14} />
          )}
          {t("search")}
        </button>
      </form>
      {onCategoryChange ? (
        <nav className="marketplace-category-nav" aria-label={t("category")}>
          {marketplaceCategories.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? "is-active" : ""}
              aria-pressed={category === item}
              onClick={() => onCategoryChange(item)}
            >
              {categoryLabel(item, t)}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function RepositoryRow({
  repository,
  onInspect,
  onAction,
  actionLabel,
  actionDisabled = false,
  actionBusy = false,
  t,
}: {
  repository: SkillRepository | McpRepository;
  onInspect?: () => void;
  onAction?: () => void;
  actionLabel: string | ((repository: SkillRepository | McpRepository) => string);
  actionDisabled?: boolean;
  actionBusy?: boolean;
  t: (key: string) => string;
}) {
  const source =
    repository.sourceType === "MCPMARKET"
      ? t("mcpMarket")
      : repository.sourceType === "MCP_REGISTRY"
        ? t("mcpRegistry")
        : repository.sourceType === "CURATED"
          ? t("curatedSource")
          : t("githubSearch");
  const installable =
    !("installType" in repository) ||
    !repository.installType ||
    repository.installType === "NPM" ||
    repository.installType === "REMOTE";
  const handleInspect = () => {
    if (onInspect) onInspect();
  };
  return (
    <article
      className={`marketplace-card ${onInspect ? "is-clickable" : ""}`}
      role={onInspect ? "button" : undefined}
      tabIndex={onInspect ? 0 : undefined}
      aria-label={onInspect ? `${t("viewDetails")} ${repository.name}` : undefined}
      onClick={handleInspect}
      onKeyDown={(event) => {
        if (!onInspect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleInspect();
        }
      }}
    >
      <div className="marketplace-card-icon" aria-hidden="true">
        {"installType" in repository ? <Globe2 size={20} /> : <Sparkles size={20} />}
      </div>
      <div className="repository-main">
        <div className="repository-title">
          <strong>{repository.name}</strong>
          <span className="repository-stars">
            {categoryLabel(marketplaceCategory(repository), t)}
          </span>
        </div>
        <p>{repository.description || t("noDescription")}</p>
        <span className="repository-source">
          {source} · {repository.defaultBranch}
        </span>
      </div>
      <div className="marketplace-card-meta">
        {repository.stars > 0 ? (
          <span>{repository.stars.toLocaleString()} {t("stars")}</span>
        ) : null}
        {"installType" in repository && repository.installType ? (
          <span>{repository.installType === "REMOTE" ? t("mcpEndpoint") : repository.installType}</span>
        ) : null}
      </div>
      <div className="repository-actions">
        <a
          className="icon-button"
          href={repository.url}
          target="_blank"
          rel="noreferrer"
          aria-label={t("openRepository")}
          title={t("openRepository")}
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink size={15} />
        </a>
        {onInspect ? (
          <button
            type="button"
            className={installable ? "primary-button" : "secondary-button"}
            disabled={actionDisabled || actionBusy}
            onClick={(event) => {
              event.stopPropagation();
              if (onAction) onAction();
              else onInspect();
            }}
          >
            {actionBusy ? <LoaderCircle size={14} className="spin" /> : installable ? <Package size={14} /> : null}
            {typeof actionLabel === "function" ? actionLabel(repository) : actionLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RepositoryResults({
  repositories,
  loading,
  error,
  onRetry,
  onInspect,
  onAction,
  actionLabel,
  actionDisabled,
  actionBusy,
  t,
}: {
  repositories: Array<SkillRepository | McpRepository>;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onInspect?: (repository: any) => void;
  onAction?: (repository: any) => void;
  actionLabel: string | ((repository: SkillRepository | McpRepository) => string);
  actionDisabled?: boolean | ((repository: SkillRepository | McpRepository) => boolean);
  actionBusy?: boolean | ((repository: SkillRepository | McpRepository) => boolean);
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
            (!("installType" in repository) || repository.installType !== "REPOSITORY" || "url" in repository)
              ? () => onInspect(repository)
              : undefined
          }
          actionLabel={actionLabel}
          onAction={onAction ? () => onAction(repository) : undefined}
          actionDisabled={
            typeof actionDisabled === "function"
              ? actionDisabled(repository)
              : Boolean(actionDisabled)
          }
          actionBusy={
            typeof actionBusy === "function"
              ? actionBusy(repository)
              : Boolean(actionBusy)
          }
          t={t}
        />
      ))}
    </div>
  ) : (
    <div className="manager-placeholder compact">{t("noRepositories")}</div>
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

export default function McpManager({
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
  const [searchSource, setSearchSource] = useState("mcpmarket");
  const [marketCategory, setMarketCategory] = useState<MarketplaceCategory>("all");
  const [marketSort, setMarketSort] = useState<MarketplaceSort>("popular");
  const [visibleRepositoryCount, setVisibleRepositoryCount] = useState(24);
  const [selectedRepo, setSelectedRepo] = useState<McpRepository | null>(null);
  const [notice, setNotice] = useState("");
  const [verificationTargetId, setVerificationTargetId] = useState<string | null>(
    null,
  );
  const [editorFor, setEditorFor] = useState<McpConnection | null | undefined>(
    undefined,
  );
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");
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
    mutationFn: (repository: McpRepository) => studioApi.installMcpRepository({
      repositoryId: repository.id,
      id: repository.id,
      name: repository.name,
      description: repository.description,
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
  const repositories = sortMarketplaceItems(
    (searchMutation.data ?? curatedQuery.data ?? [])
      .filter((repo) => repo.sourceType === "MCPMARKET")
      .filter((repo) => marketCategory === "all" || marketplaceCategory(repo) === marketCategory),
    marketSort,
  );
  const jsonImportMutation = useMutation({
    mutationFn: (json: string) =>
      studioApi.importMcpJson({
        json,
        overwrite: Boolean(editorFor),
        refreshTools: true,
      }),
    onSuccess: async (connections) => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      setEditorFor(undefined);
      setJsonMode(false);
      const connection = connections[0];
      setNotice(connection?.tools?.length ? t("completed") : t("mcpAddedNeedsRefresh"));
      setVerificationTargetId(connection?.tools?.length ? null : connection?.id ?? null);
    },
  });
  const openEditor = (connection: McpConnection | null) => {
    setJsonMode(false);
    setJsonError("");
    setJsonDraft(
      connection
        ? JSON.stringify(
            {
              id: connection.id,
              name: connection.name,
              description: connection.description ?? "",
              transportType: connection.transportType ?? "STDIO",
              command: connection.command ?? "",
              args: connection.args ?? [],
              endpoint: connection.endpoint ?? "",
              env: Object.fromEntries((connection.envKeys ?? []).map((key) => [key, ""])),
            },
            null,
            2,
          )
        : "",
    );
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
  const openJsonImport = () => {
    setJsonMode(true);
    setJsonError("");
    setJsonDraft(`{
  "mcpServers": {
    "weather": {
      "name": "Weather MCP",
      "description": "Weather tools",
      "command": "npx",
      "args": ["-y", "@h1deya/mcp-server-weather"],
      "env": {}
    }
  }
}`);
    setEditorFor(null);
  };
  const submitJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("mcpJsonObjectRequired"));
      }
      setJsonError("");
      jsonImportMutation.mutate(jsonDraft);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t("mcpJsonInvalid"));
    }
  };
  const transportType = form.watch("transportType");
  const selectedRepoInstallable = Boolean(
    selectedRepo &&
      selectedRepo.installType !== "REPOSITORY" &&
      (selectedRepo.installType === "REMOTE"
        ? selectedRepo.endpoint
        : selectedRepo.npmPackage || selectedRepo.installType === "NPM"),
  );

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
          onSubmit={(event) => {
            event.preventDefault();
            if (jsonMode) {
              submitJson();
            } else {
              void form.handleSubmit((values) =>
                saveMutation.mutate({ target: editorFor, values }),
              )();
            }
          }}
        >
          <div className="mcp-editor-mode">
            <button
              type="button"
              className={!jsonMode ? "secondary-button is-active" : "secondary-button"}
              onClick={() => setJsonMode(false)}
            >
              {t("mcpFormMode")}
            </button>
            <button
              type="button"
              className={jsonMode ? "secondary-button is-active" : "secondary-button"}
              onClick={() => setJsonMode(true)}
            >
              <FileJson size={14} />
              {t("mcpJsonMode")}
            </button>
          </div>
          {jsonMode ? (
            <label className="mcp-json-field">
              {t("mcpJsonLabel")}
              <textarea
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                rows={18}
                spellCheck={false}
                placeholder='{"mcpServers":{"weather":{"command":"npx","args":["-y","@h1deya/mcp-server-weather"]}}}'
              />
              <small className="form-note">{t("mcpJsonHint")}</small>
            </label>
          ) : (
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
          )}
          {editorFor && !jsonMode ? (
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
          {jsonError ? <p className="form-error">{jsonError}</p> : null}
          {saveMutation.isError || jsonImportMutation.isError ? (
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
              disabled={saveMutation.isPending || jsonImportMutation.isPending}
            >
              {saveMutation.isPending || jsonImportMutation.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              {jsonMode ? t("mcpImportJson") : t("save")}
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
            <button
              type="button"
              className="secondary-button"
              onClick={openJsonImport}
            >
              <FileJson size={14} />
              {t("mcpImportJson")}
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
                    ? `${t("enabled")} · ${statusLabel(connection.status, t)}`
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
              setMarketCategory("all");
            }}
            onSubmit={() => {
              setNotice("");
              searchMutation.mutate({
                query: search.trim() || undefined,
                limit: 30,
              });
              setVisibleRepositoryCount(24);
            }}
            t={t}
            mcpMarketOnly
            category={marketCategory}
            onCategoryChange={setMarketCategory}
            sort={marketSort}
            onSortChange={setMarketSort}
          />
          {selectedRepo ? (
            <div className="marketplace-detail mcp-install-panel">
              <button
                type="button"
                className="text-button back-button"
                onClick={() => setSelectedRepo(null)}
              >
                <ArrowLeft size={14} />
                {t("backToRepositories")}
              </button>
              <div className="marketplace-detail-heading">
                <div className="marketplace-card-icon" aria-hidden="true">
                  <Globe2 size={20} />
                </div>
                <div>
                  <h4>{selectedRepo.name}</h4>
                  <p>{selectedRepo.description || t("noDescription")}</p>
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
              <dl className="marketplace-detail-grid">
                <div>
                  <dt>{t("searchSource")}</dt>
                  <dd>{t("mcpMarket")}</dd>
                </div>
                <div>
                  <dt>{t("category")}</dt>
                  <dd>{categoryLabel(marketplaceCategory(selectedRepo), t)}</dd>
                </div>
                <div>
                  <dt>{t("installType")}</dt>
                  <dd>{selectedRepo.installType ?? t("viewRepository")}</dd>
                </div>
                <div>
                  <dt>{t("stars")}</dt>
                  <dd>{selectedRepo.stars.toLocaleString()}</dd>
                </div>
              </dl>
              {selectedRepoInstallable ? (
                <div className="mcp-install-summary">
                  <span>{selectedRepo.installType === "REMOTE" ? t("mcpEndpoint") : t("npmPackage")}</span>
                  <code>{selectedRepo.installType === "REMOTE" ? selectedRepo.endpoint : selectedRepo.npmPackage}</code>
                </div>
              ) : (
                <div className="manager-notice warning">
                  <CircleAlert size={14} />
                  {t("mcpRepositoryOnlyHint")}
                </div>
              )}
              {selectedRepoInstallable && installMutation.isError ? (
                <p className="form-error">
                  {installMutation.error instanceof Error
                    ? installMutation.error.message
                    : t("installFailed")}
                </p>
              ) : null}
              {selectedRepoInstallable ? (
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
              ) : null}
            </div>
          ) : (
            <>
              <RepositoryResults
                repositories={repositories.slice(0, visibleRepositoryCount)}
                loading={curatedQuery.isLoading || searchMutation.isPending}
                error={curatedQuery.isError || searchMutation.isError}
                onRetry={() => void curatedQuery.refetch()}
                onInspect={(repository) => setSelectedRepo(repository)}
                onAction={(repository) => {
                  if ("installType" in repository && repository.installType === "REPOSITORY") {
                    setSelectedRepo(repository);
                    return;
                  }
                  installMutation.mutate(repository as McpRepository);
                }}
                actionDisabled={(repository) =>
                  installMutation.isPending &&
                  installMutation.variables?.id !== repository.id
                }
                actionBusy={(repository) =>
                  installMutation.isPending &&
                  installMutation.variables?.id === repository.id
                }
                actionLabel={(repository) =>
                  "installType" in repository && repository.installType === "REMOTE"
                    ? t("addMcp")
                    : "installType" in repository && repository.installType === "REPOSITORY"
                      ? t("viewRepository")
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

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean }) { const button = <button className="icon-button" aria-label={label} type="button" onClick={onClick} disabled={disabled}>{children}</button>; return <Tooltip.Root><Tooltip.Trigger asChild>{button}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>; }
function InlineDangerConfirm({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) { const { t } = useTranslation(); return <div className="inline-danger-confirm"><CircleAlert size={16} /><div><strong>{title}</strong><p>{description}</p></div><div className="inline-form-actions"><button className="secondary-button" type="button" onClick={onCancel}>{t("cancel")}</button><button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : null}{confirmLabel}</button></div></div>; }
function QueryResourceState({ query, children, t }: { query: ResourceQuery; children: ReactNode; t: (key: string) => string }) { if (query.isLoading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>; if (query.isError) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{t("loadFailed")}</span><button type="button" className="secondary-button" onClick={() => void query.refetch()}>{t("retryLoad")}</button></div>; return <div className="manager-list">{Children.count(children) ? children : <div className="manager-placeholder compact"><span>{t("emptyList")}</span></div>}</div>; }
function ResourceRow({ icon, title, detail, status, trailing }: { icon: ReactNode; title: string; detail: string; status?: string; trailing: ReactNode }) { return <div className="manager-list-item"><span className="model-glyph">{icon}</span><div><strong>{title}</strong><span>{detail}</span></div>{status ? <span className="list-status">{status}</span> : null}{trailing}</div>; }
function ToggleButton({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) { return <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} aria-pressed={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>; }
function displayMcpDescription(value: string | undefined, fallback: string) { const text = value?.trim() ?? ""; if (!text) return fallback; const suspiciousCount = (text.match(/[?锛燂拷]/g) ?? []).length; return suspiciousCount >= 2 && suspiciousCount / text.length >= 0.12 ? fallback : text; }
function formatTimestamp(value?: string) { if (!value) return "-"; const timestamp = new Date(value); return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString(); }
function statusLabel(status: string | undefined, t: (key: string) => string) { if (!status) return t("offline"); const normalized = status.toLowerCase(); if (normalized.includes("connected") || normalized.includes("online") || normalized.includes("ready") || normalized.includes("configured")) return t("connectedStatus"); if (normalized.includes("degraded") || normalized.includes("error")) return t("degradedStatus"); return t("disconnectedStatus"); }
