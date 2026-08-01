import { ArrowLeft, Check, CircleAlert, Copy, HardDrive, LoaderCircle, Pencil, PlugZap, RefreshCw, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { Children, type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioApi } from "../lib/api";
import type { NodeConnection, NodeRegistrationToken, NodeTool, NodeToolApproval, RotateNodeSecretResult } from "../types";
export default function NodeManager({
  nodes,
  nodesQuery,
  approvalsQuery,
  t,
}: {
  nodes: NodeConnection[];
  nodesQuery: ResourceQuery;
  approvalsQuery: ResourceQuery & { data?: NodeToolApproval[] };
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"nodes" | "approvals">("nodes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registration, setRegistration] =
    useState<NodeRegistrationToken | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCredentialRotation, setConfirmCredentialRotation] =
    useState(false);
  const [rotatedCredentials, setRotatedCredentials] =
    useState<RotateNodeSecretResult | null>(null);
  const [copiedCredential, setCopiedCredential] = useState(false);
  const detailsQuery = useQuery({
    queryKey: ["node", selectedId],
    queryFn: () => studioApi.getNode(selectedId!),
    enabled: Boolean(selectedId),
  });
  const registerNode = useMutation({
    mutationFn: () => studioApi.createNodeRegistrationToken(),
    onSuccess: (value) => {
      setRegistration(value);
      setCopiedCommand(false);
    },
  });
  const updateNode = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { name?: string; enabled?: boolean };
    }) => studioApi.updateNode(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", variables.id] });
    },
  });
  const updateTool = useMutation({
    mutationFn: ({
      nodeId,
      toolName,
      payload,
    }: {
      nodeId: string;
      toolName: string;
      payload: { enabled?: boolean; requiresApproval?: boolean };
    }) => studioApi.updateNodeTool(nodeId, toolName, payload),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: ["node", variables.nodeId] }),
  });
  const removeNode = useMutation({
    mutationFn: studioApi.deleteNode,
    onSuccess: () => {
      setSelectedId(null);
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const rotateCredentials = useMutation({
    mutationFn: studioApi.rotateNodeCredentials,
    onSuccess: (result) => {
      setRotatedCredentials(result);
      setCopiedCredential(false);
      setConfirmCredentialRotation(false);
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", result.nodeId] });
    },
  });
  const decideApproval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      studioApi.decideNodeToolApproval(id, approved),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["node-tool-approvals"] }),
  });
  // The managed local executor is an implementation detail, not a user-managed node.
  const registeredNodes = nodes.filter((node) => node.kind !== "MANAGED_LOCAL");
  const selectedNode = registeredNodes.find((node) => node.id === selectedId);
  const pendingApprovals = (approvalsQuery.data ?? []).filter(
    (approval) => approval.status?.toUpperCase() === "PENDING",
  );
  const nodeTools = detailsQuery.data?.tools ?? [];
  const systemTools = nodeTools.filter((tool) => tool.name.startsWith("system."));
  const systemAccessAvailable = (detailsQuery.data?.node.features ?? selectedNode?.features ?? [])
    .includes("system-access.v1");
  const systemAccessEnabled = systemTools.length > 0 && systemTools.every((tool) => tool.enabled);
  const setSystemAccess = (enabled: boolean) => {
    if (!selectedNode || !systemAccessAvailable || !systemTools.length) return;
    Promise.all(systemTools.map((tool) =>
      studioApi.updateNodeTool(selectedNode.id, tool.name, { enabled, requiresApproval: true }),
    )).then(() => queryClient.invalidateQueries({ queryKey: ["node", selectedNode.id] }));
  };
  const copyCommand = async () => {
    if (!registration) return;
    try {
      await navigator.clipboard?.writeText(registration.usageHint);
      setCopiedCommand(true);
    } catch {
      setCopiedCommand(false);
    }
  };
  const copyRotatedCredential = async () => {
    if (!rotatedCredentials) return;
    try {
      await navigator.clipboard?.writeText(rotatedCredentials.nodeSecret);
      setCopiedCredential(true);
    } catch {
      setCopiedCredential(false);
    }
  };

  if (selectedNode)
    return (
      <div className="node-detail">
        <button
          type="button"
          className="text-button back-button"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft size={14} />
          {t("nodes")}
        </button>
        <div className="node-detail-heading">
          <div>
            <div className="node-title-row">
              <h4>{detailsQuery.data?.node.name ?? selectedNode.name}</h4>
              <span className="list-status">
                <span
                  className="status-dot"
                  data-online={
                    detailsQuery.data?.node.status?.toUpperCase() === "ONLINE"
                  }
                />
                {statusLabel(
                  detailsQuery.data?.node.status ?? selectedNode.status,
                  t,
                )}
              </span>
            </div>
            <p>
              {detailsQuery.data?.node.hostname ??
                selectedNode.hostname ??
                t("unknownHost")}
            </p>
          </div>
          <div className="knowledge-detail-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setEditingName((current) => !current);
                setNameDraft(detailsQuery.data?.node.name ?? selectedNode.name);
              }}
            >
              <Pencil size={14} />
              {t("editName")}
            </button>
            <button
              className="secondary-button danger-button"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              {t("delete")}
            </button>
          </div>
        </div>
        {editingName ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameDraft.trim()) {
                updateNode.mutate({
                  id: selectedNode.id,
                  payload: { name: nameDraft.trim() },
                });
                setEditingName(false);
              }
            }}
          >
            <label>
              {t("editName")}
              <input
                value={nameDraft}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <div className="inline-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditingName(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!nameDraft.trim() || updateNode.isPending}
              >
                {t("saveName")}
              </button>
            </div>
          </form>
        ) : null}
        {confirmDelete ? (
          <div className="node-danger-confirm">
            <CircleAlert size={16} />
            <div>
              <strong>{t("confirmDeleteNode")}</strong>
              <p>{t("deleteNodeHint")}</p>
            </div>
            <div className="inline-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirmDelete(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={removeNode.isPending}
                onClick={() => removeNode.mutate(selectedNode.id)}
              >
                {t("deleteNode")}
              </button>
            </div>
          </div>
        ) : null}
        <section className="node-credentials" aria-label={t("nodeCredentials")}>
          <div className="knowledge-documents-heading">
            <div>
              <strong>{t("nodeCredentials")}</strong>
              <span>{t("nodeCredentialsHint")}</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setConfirmCredentialRotation(true);
                setRotatedCredentials(null);
              }}
            >
              <RefreshCw size={14} />
              {t("rotateNodeCredentials")}
            </button>
          </div>
          {confirmCredentialRotation ? (
            <div className="node-danger-confirm">
              <CircleAlert size={16} />
              <div>
                <strong>{t("confirmRotateNodeCredentials")}</strong>
                <p>{t("rotateNodeCredentialsHint")}</p>
              </div>
              <div className="inline-form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setConfirmCredentialRotation(false)}
                >
                  {t("cancel")}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={rotateCredentials.isPending}
                  onClick={() => rotateCredentials.mutate(selectedNode.id)}
                >
                  {rotateCredentials.isPending ? <LoaderCircle size={14} className="spin" /> : null}
                  {t("rotateNodeCredentials")}
                </button>
              </div>
            </div>
          ) : null}
          {rotateCredentials.isError ? (
            <p className="form-error">{t("loadFailed")}</p>
          ) : null}
          {rotatedCredentials ? (
            <div className="node-command node-rotated-secret">
              <div>
                <span>{t("nodeSecret")}</span>
                <strong>{formatTimestamp(rotatedCredentials.rotatedAt)}</strong>
              </div>
              <p>{t("nodeSecretOneTimeHint")}</p>
              <code>{rotatedCredentials.nodeSecret}</code>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyRotatedCredential()}
              >
                <Copy size={14} />
                {copiedCredential ? t("commandCopied") : t("copyCommand")}
              </button>
            </div>
          ) : null}
        </section>
        <div className="node-meta-grid">
          <NodeMeta
            label={t("lastSeen")}
            value={formatTimestamp(
              detailsQuery.data?.node.lastSeenAt ?? selectedNode.lastSeenAt,
            )}
          />
          <NodeMeta
            label={t("nodeVersion")}
            value={
              detailsQuery.data?.node.clientVersion ??
              selectedNode.clientVersion ??
              "-"
            }
          />
          <NodeMeta
            label={t("nodeArchitecture")}
            value={
              [
                detailsQuery.data?.node.osName ?? selectedNode.osName,
                detailsQuery.data?.node.osArch ?? selectedNode.osArch,
              ]
                .filter(Boolean)
                .join(" · ") || "-"
            }
          />
        </div>
        <section className="node-access-control" aria-label={t("hostAccess")}>
          <div>
            <strong>{t("hostAccess")}</strong>
            <span>{systemAccessAvailable ? t("hostAccessEnabledHint") : t("hostAccessUnavailableHint")}</span>
          </div>
          <ToggleButton
            checked={systemAccessEnabled}
            disabled={!systemAccessAvailable || !systemTools.length || updateTool.isPending}
            onChange={setSystemAccess}
            label={t("hostAccess")}
          />
        </section>
        <div className="knowledge-documents-heading">
          <div>
            <strong>{t("nodeTools")}</strong>
            <span>
              {detailsQuery.isLoading
                ? t("loading")
                : `${detailsQuery.data?.tools.length ?? 0}`}
            </span>
          </div>
        </div>
        {detailsQuery.isError ? (
          <div className="manager-placeholder compact">
            <CircleAlert size={16} />
            <span>{t("loadFailed")}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void detailsQuery.refetch()}
            >
              {t("retryLoad")}
            </button>
          </div>
        ) : detailsQuery.isLoading ? (
          <div className="manager-placeholder compact">
            <LoaderCircle size={18} className="spin" />
            <span>{t("loading")}</span>
          </div>
        ) : detailsQuery.data?.tools.length ? (
          <div className="node-tool-list">
            {detailsQuery.data.tools.map((tool) => (
              <NodeToolPolicyRow
                key={tool.id}
                tool={tool}
                busy={updateTool.isPending}
                onChange={(payload) =>
                  updateTool.mutate({
                    nodeId: selectedNode.id,
                    toolName: tool.name,
                    payload,
                  })
                }
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="manager-placeholder compact">
            <Wrench size={16} />
            <span>{t("noNodeTools")}</span>
          </div>
        )}
      </div>
    );

  return (
    <div className="node-manager">
      <div className="manager-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "nodes"}
          className={section === "nodes" ? "is-active" : ""}
          onClick={() => setSection("nodes")}
        >
          <HardDrive size={13} />
          {t("nodes")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "approvals"}
          className={section === "approvals" ? "is-active" : ""}
          onClick={() => setSection("approvals")}
        >
          <ShieldCheck size={13} />
          {t("nodeApprovals")}
          {pendingApprovals.length ? (
            <span className="tab-count">{pendingApprovals.length}</span>
          ) : null}
        </button>
      </div>
      {section === "nodes" ? (
        <>
          <div className="node-onboarding">
            <div>
              <strong>{t("nodeConnectTitle")}</strong>
              <p>{t("nodeConnectHint")}</p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={registerNode.isPending}
              onClick={() => registerNode.mutate()}
            >
              {registerNode.isPending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <PlugZap size={14} />
              )}
              {registration ? t("generateAgain") : t("addNode")}
            </button>
          </div>
          {registration ? (
            <div className="node-command">
              <div>
                <span>{t("nodeTokenExpires")}</span>
                <strong>{formatTimestamp(registration.expiresAt)}</strong>
              </div>
              <code>{registration.usageHint}</code>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyCommand()}
              >
                <Copy size={14} />
                {copiedCommand ? t("commandCopied") : t("copyCommand")}
              </button>
            </div>
          ) : null}
          <QueryResourceState query={nodesQuery} t={t}>
            {registeredNodes.map((node) => (
              <ResourceRow
                key={node.id}
                icon={<HardDrive size={15} />}
                title={node.name}
                detail={`${node.hostname ?? t("unknownHost")} · ${node.osName ?? "-"}`}
                status={statusLabel(node.status, t)}
                trailing={
                  <span className="row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setSelectedId(node.id);
                        setEditingName(false);
                        setConfirmDelete(false);
                        setConfirmCredentialRotation(false);
                        setRotatedCredentials(null);
                        setNameDraft(node.name);
                      }}
                    >
                      {t("manageNode")}
                    </button>
                    <ToggleButton
                      checked={node.enabled}
                      onChange={(enabled) =>
                        updateNode.mutate({ id: node.id, payload: { enabled } })
                      }
                      label={node.enabled ? t("disable") : t("enable")}
                    />
                  </span>
                }
              />
            ))}
          </QueryResourceState>
        </>
      ) : (
        <QueryResourceState query={approvalsQuery} t={t}>
          {pendingApprovals.length ? (
            pendingApprovals.map((approval) => (
              <NodeApprovalRow
                key={approval.id}
                approval={approval}
                busy={decideApproval.isPending}
                onDecision={(approved) =>
                  decideApproval.mutate({ id: approval.id, approved })
                }
                t={t}
              />
            ))
          ) : (
            <div className="manager-placeholder compact">
              <ShieldCheck size={16} />
              <span>{t("noPendingApprovals")}</span>
            </div>
          )}
        </QueryResourceState>
      )}
    </div>
  );
}

function NodeMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="node-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeToolPolicyRow({
  tool,
  busy,
  onChange,
  t,
}: {
  tool: NodeTool;
  busy: boolean;
  onChange: (payload: {
    enabled?: boolean;
    requiresApproval?: boolean;
  }) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="node-tool-row">
      <span className="model-glyph">
        <Wrench size={15} />
      </span>
      <div>
        <div className="node-tool-title">
          <strong>{tool.name}</strong>
          {tool.riskLevel ? (
            <span className="risk-mark">{tool.riskLevel}</span>
          ) : null}
        </div>
        <span>{tool.description || "-"}</span>
      </div>
      <div className="node-tool-controls">
        <label>
          <span>{t("toolEnabled")}</span>
          <ToggleButton
            checked={tool.enabled}
            onChange={(enabled) => onChange({ enabled })}
            label={tool.enabled ? t("disable") : t("enable")}
          />
        </label>
        <label>
          <span>{t("approvalRequired")}</span>
          <ToggleButton
            checked={tool.requiresApproval}
            onChange={(requiresApproval) => onChange({ requiresApproval })}
            label={t("approvalRequired")}
          />
        </label>
        {busy ? <LoaderCircle size={14} className="spin" /> : null}
      </div>
    </div>
  );
}

function NodeApprovalRow({
  approval,
  busy,
  onDecision,
  t,
}: {
  approval: NodeToolApproval;
  busy: boolean;
  onDecision: (approved: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="node-approval-row">
      <div className="node-approval-heading">
        <div>
          <strong>{approval.toolName}</strong>
          <span>{approval.nodeId}</span>
        </div>
        <span className="list-status">
          {formatTimestamp(approval.createdAt)}
        </span>
      </div>
      {approval.argumentsJson ? (
        <div className="node-approval-arguments">
          <span>{t("approvalArguments")}</span>
          <code>{approval.argumentsJson}</code>
        </div>
      ) : null}
      <div className="node-approval-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => onDecision(false)}
        >
          {t("reject")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => onDecision(true)}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          {t("approve")}
        </button>
      </div>
    </div>
  );
}

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}


type ResourceQuery = {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

function QueryResourceState({ query, children, t }: { query: ResourceQuery; children: ReactNode; t: (key: string) => string }) {
  if (query.isLoading) return <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div>;
  if (query.isError) return <div className="manager-placeholder"><CircleAlert size={18} /><span>{t("loadFailed")}</span><button type="button" className="secondary-button" onClick={() => void query.refetch()}>{t("retryLoad")}</button></div>;
  return <div className="manager-list">{Children.count(children) ? children : <div className="manager-placeholder compact"><span>{t("emptyList")}</span></div>}</div>;
}

function ResourceRow({ icon, title, detail, status, trailing }: { icon: ReactNode; title: string; detail: string; status?: string; trailing: ReactNode }) {
  return <div className="manager-list-item"><span className="model-glyph">{icon}</span><div><strong>{title}</strong><span>{detail}</span></div>{status ? <span className="list-status">{status}</span> : null}{trailing}</div>;
}

function ToggleButton({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle-button ${checked ? "is-on" : ""}`} aria-pressed={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

function statusLabel(status: string | undefined, t: (key: string) => string) {
  if (!status) return t("offline");
  const normalized = status.toLowerCase();
  if (normalized.includes("connected") || normalized.includes("online") || normalized.includes("ready") || normalized.includes("configured")) return t("connectedStatus");
  if (normalized.includes("degraded") || normalized.includes("error")) return t("degradedStatus");
  return t("disconnectedStatus");
}
