import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CircleAlert,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  History,
  LoaderCircle,
  Package,
  PlugZap,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { safeExternalUrl } from "../lib/safeExternalUrl";
import type {
  Artifact,
  CodingRunEvidence,
  CodingRunQuality,
  RunAudit,
  RunWorkflow,
} from "../types";

type Translator = (key: string) => string;

export default function RunAuditDrawer({
  evidence,
  quality,
  audit,
  workflow,
  artifacts,
  loading,
  error,
  onDownload,
  onClose,
  t,
}: {
  evidence?: CodingRunEvidence;
  quality?: CodingRunQuality;
  audit?: RunAudit;
  workflow?: RunWorkflow;
  artifacts?: Artifact[];
  loading: boolean;
  error: boolean;
  onDownload: (artifact: Artifact) => void;
  onClose: () => void;
  t: Translator;
}) {
  const auditLists = [
    [t("changedFiles"), evidence?.changedFiles ?? []],
    [t("verificationTools"), evidence?.verificationTools ?? []],
    [t("commandVerifications"), evidence?.commandVerifications ?? []],
    [t("failedTools"), evidence?.failedTools ?? []],
  ] as const;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-scrim" />
        <Dialog.Content className="citation-drawer audit-drawer">
          <div className="drawer-header">
            <div>
              <small>{t("runAudit")}</small>
              <Dialog.Title asChild>
                <h2>
                  {quality
                    ? `${quality.score}/100 ${quality.grade}`
                    : t("runDetails")}
                </h2>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                className="icon-button"
                type="button"
                aria-label={t("close")}
                title={t("close")}
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="visually-hidden">
            {t("runAudit")}
          </Dialog.Description>
          <div className="drawer-body audit-body">
            {loading ? (
              <div className="audit-state">
                <LoaderCircle size={15} className="spin" /> {t("loading")}
              </div>
            ) : null}
            {error ? (
              <div className="audit-state">
                <CircleAlert size={15} /> {t("loadFailed")}
              </div>
            ) : null}
            {!loading && !error ? (
              <>
                <div className="audit-summary">
                  <span><Clock3 size={14} /> {t("runTotalDuration")}</span>
                  <strong>{formatDuration(audit?.timing.totalMs)}</strong>
                  <span><Cpu size={14} /> {t("modelCalls")}</span>
                  <strong>{audit?.usage.modelCalls ?? 0}</strong>
                  <span>{t("tokenUsage")}</span>
                  <strong>
                    {audit?.usage.providerReportedCalls
                      ? formatNumber(audit.usage.totalTokens)
                      : t("usageUnavailable")}
                  </strong>
                  <span>{t("toolCalls")}</span>
                  <strong>{audit?.summary.tools ?? evidence?.toolCalls ?? 0}</strong>
                </div>
                {audit?.usage.providerReportedCalls ? (
                  <p className="audit-usage-detail">
                    {t("inputTokens")}: {formatNumber(audit.usage.promptTokens)} · {t("outputTokens")}: {formatNumber(audit.usage.completionTokens)} · {t("modelLatency")}: {formatDuration(audit.usage.modelLatencyMs)}
                  </p>
                ) : null}
                {workflow ? (
                  <section className="audit-section">
                    <h3>{t("workflowStatus")}</h3>
                    <dl className="audit-snapshot">
                      <div>
                        <dt>{t("workflowPhase")}</dt>
                        <dd>{workflow.phase}</dd>
                      </div>
                      <div>
                        <dt>{t("workflowGoal")}</dt>
                        <dd>{workflow.goal || "-"}</dd>
                      </div>
                      <div>
                        <dt>{t("workflowTools")}</dt>
                        <dd>{workflow.completedToolCalls} / {workflow.failedToolCalls}</dd>
                      </div>
                      <div>
                        <dt>{t("workflowLastTool")}</dt>
                        <dd>{workflow.lastToolName ?? "-"}</dd>
                      </div>
                    </dl>
                    <WorkflowPlan planJson={workflow.planJson} t={t} />
                    {workflow.lastError ? <p className="audit-error">{workflow.lastError}</p> : null}
                  </section>
                ) : null}
                {audit?.snapshot ? (
                  <section className="audit-section">
                    <h3>{t("auditSnapshot")}</h3>
                    <dl className="audit-snapshot">
                      <div>
                        <dt>{t("auditAgent")}</dt>
                        <dd>
                          {audit.snapshot.agentId}
                          {audit.snapshot.agentVersionId ? ` · ${audit.snapshot.agentVersionId}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("auditModel")}</dt>
                        <dd>{audit.snapshot.modelProfileId}</dd>
                      </div>
                      <div>
                        <dt>{t("auditNode")}</dt>
                        <dd>{audit.snapshot.nodeId ?? t("noExecutionNode")}</dd>
                      </div>
                      <div>
                        <dt>{t("auditScope")}</dt>
                        <dd>{audit.snapshot.workingDirectory || "."}</dd>
                      </div>
                      <div>
                        <dt>{t("auditPersona")}</dt>
                        <dd>{audit.snapshot.personaName ?? audit.snapshot.personaId ?? t("auditNoPersona")}</dd>
                      </div>
                      <div>
                        <dt>{t("auditRecalledMemory")}</dt>
                        <dd>{formatRecalledMemory(audit.snapshot.recalledMemoryCount, audit.snapshot.recalledMemoryTypes, t)}</dd>
                      </div>
                    </dl>
                  </section>
                ) : null}
                {audit?.snapshot ? (
                  <section className="audit-section">
                    <h3>{t("auditCapabilities")}</h3>
                    <div className="audit-capability-grid">
                      <AuditCapabilityList label={t("auditTools")} values={audit.snapshot.allowedTools ?? []} empty={t("auditNone")} />
                      <AuditCapabilityList label={t("auditSkills")} values={audit.snapshot.skillIds ?? []} empty={t("auditNone")} />
                      <AuditCapabilityList label={t("auditMcpConnections")} values={audit.snapshot.mcpConnectionIds ?? []} empty={t("auditNone")} />
                      <AuditCapabilityList label={t("auditKnowledgeBases")} values={audit.snapshot.knowledgeBaseIds ?? []} empty={t("auditNone")} />
                    </div>
                  </section>
                ) : null}
                {audit?.timeline.length ? (
                  <section className="audit-section">
                    <h3>{t("auditTimeline")}</h3>
                    <ol className="audit-timeline">
                      {audit.timeline.map((entry) => (
                        <li
                          className={`is-${entry.status.toLowerCase()}`}
                          key={entry.id}
                        >
                          <span className="audit-timeline-icon">
                            <AuditTimelineIcon kind={entry.kind} />
                          </span>
                          <div>
                            <strong>{entry.title}</strong>
                            {entry.detail ? <small>{entry.detail}</small> : null}
                          </div>
                          <time dateTime={entry.occurredAt}>
                            {formatAuditTime(entry.occurredAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                {audit?.citations.length ? (
                  <section className="audit-section">
                    <h3>{t("auditCitedSources")}</h3>
                    <ul className="audit-citation-list">
                      {audit.citations.map((citation) => {
                        const externalLocation = citation.type === "web"
                          ? safeExternalUrl(citation.location)
                          : undefined;
                        return (
                          <li key={citation.id}>
                            <div>
                              <strong>{citation.title}</strong>
                              <small>{citation.source}</small>
                              {citation.quote ? <p>{citation.quote}</p> : null}
                              {externalLocation ? (
                                <a href={externalLocation} target="_blank" rel="noreferrer">
                                  <ExternalLink size={13} />{externalLocation}
                                </a>
                              ) : citation.location ? <span>{citation.location}</span> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
                {auditLists.map(([label, entries]) =>
                  entries.length ? (
                    <section className="audit-section" key={label}>
                      <h3>{label}</h3>
                      <ul>
                        {entries.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )}
                {quality?.checks.length ? (
                  <section className="audit-section">
                    <h3>{t("qualityChecks")}</h3>
                    <ul className="quality-checks">
                      {quality.checks.map((check) => (
                        <li className={check.passed ? "" : "is-failed"} key={check.name}>
                          <span>
                            {check.passed ? (
                              <Check size={14} />
                            ) : (
                              <CircleAlert size={14} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {check.name} {check.earnedPoints}/{check.maximumPoints}
                            </strong>
                            <small>{check.explanation}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {quality?.recommendations.length ? (
                  <section className="audit-section">
                    <h3>{t("recommendations")}</h3>
                    <ul>
                      {quality.recommendations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {artifacts?.length ? (
                  <section className="audit-section">
                    <h3>{t("artifacts")}</h3>
                    <ul className="artifact-list">
                      {artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <button type="button" onClick={() => onDownload(artifact)}>
                            <Download size={14} />
                            <span>{artifact.filename}</span>
                            <small>
                              {artifact.artifactType} - {formatByteSize(artifact.sizeBytes)}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {!evidence?.changedFiles.length && !quality?.checks.length ? (
                  <div className="audit-state">{t("auditNoEvidence")}</div>
                ) : null}
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkflowPlan({ planJson, t }: { planJson: string; t: Translator }) {
  let steps: Array<{ step?: string; status?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(planJson);
    if (Array.isArray(parsed)) {
      steps = parsed.filter(
        (item): item is { step?: string; status?: string } => Boolean(item && typeof item === "object"),
      );
    }
  } catch {
    steps = [];
  }
  const visibleSteps = steps.filter((item) => item.step);
  if (!visibleSteps.length) return null;
  return (
    <div className="workflow-plan">
      <strong>{t("workflowPlan")}</strong>
      <ol>
        {visibleSteps.map((item) => (
          <li key={item.step} className={`is-${item.status ?? "pending"}`}>
            <span>{item.step}</span>
            <small>{item.status ?? "pending"}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AuditCapabilityList({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div className="audit-capability-group">
      <span>{label}</span>
      {values.length ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <small>{empty}</small>}
    </div>
  );
}

function AuditTimelineIcon({ kind }: { kind: string }) {
  if (kind === "model") return <Cpu size={14} />;
  if (kind === "tool") return <Wrench size={14} />;
  if (kind === "node-tool") return <TerminalSquare size={14} />;
  if (kind === "mcp") return <PlugZap size={14} />;
  if (kind === "approval") return <ShieldCheck size={14} />;
  if (kind === "artifact") return <Package size={14} />;
  return <History size={14} />;
}

function formatDuration(value?: number) {
  if (value === undefined || value < 0) return "-";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatRecalledMemory(count: number, types: string[], t: Translator) {
  if (!count) return t("auditNoRecalledMemory");
  const translatedTypes = types.map((type) => t(`memoryType${type}`)).join(", ");
  return t("auditMemorySummary")
    .replace("{count}", String(count))
    .replace("{types}", translatedTypes || t("unknown"));
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatByteSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
