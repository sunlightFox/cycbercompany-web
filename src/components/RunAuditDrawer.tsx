import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CircleAlert,
  Download,
  History,
  LoaderCircle,
  Package,
  PlugZap,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import type {
  Artifact,
  CodingRunEvidence,
  CodingRunQuality,
  RunAudit,
} from "../types";

type Translator = (key: string) => string;

export default function RunAuditDrawer({
  evidence,
  quality,
  audit,
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
                    : t("deliveryEvidence")}
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
                  <span>{t("toolCalls")}</span>
                  <strong>{evidence?.toolCalls ?? 0}</strong>
                  <span>{t("browserVerification")}</span>
                  <strong>
                    {evidence?.browserVerified ? t("verified") : t("notVerified")}
                  </strong>
                  <span>{t("artifacts")}</span>
                  <strong>{artifacts?.length ?? 0}</strong>
                  <span>{t("auditTimeline")}</span>
                  <strong>{audit?.timeline.length ?? 0}</strong>
                </div>
                {audit?.snapshot ? (
                  <section className="audit-section">
                    <h3>{t("auditSnapshot")}</h3>
                    <dl className="audit-snapshot">
                      <div>
                        <dt>{t("auditAgent")}</dt>
                        <dd>
                          {audit.snapshot.agentId} v{audit.snapshot.agentPromptVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("auditModel")}</dt>
                        <dd>{audit.snapshot.modelName}</dd>
                      </div>
                      <div>
                        <dt>{t("auditNode")}</dt>
                        <dd>{audit.snapshot.nodeId ?? t("noExecutionNode")}</dd>
                      </div>
                      <div>
                        <dt>{t("auditScope")}</dt>
                        <dd>{audit.snapshot.workingDirectory || "."}</dd>
                      </div>
                    </dl>
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

function AuditTimelineIcon({ kind }: { kind: string }) {
  if (kind === "tool") return <Wrench size={14} />;
  if (kind === "node-tool") return <TerminalSquare size={14} />;
  if (kind === "mcp") return <PlugZap size={14} />;
  if (kind === "approval") return <ShieldCheck size={14} />;
  if (kind === "artifact") return <Package size={14} />;
  return <History size={14} />;
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
