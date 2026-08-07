import { ArrowLeft, Check, CircleAlert, Copy, Download, HardDrive, LoaderCircle, Pencil, Play, PlugZap, RefreshCw, ShieldCheck, Trash2, Unplug, Wrench } from "lucide-react";
import { Children, type ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioApi } from "../lib/api";
import type { ExecutionMode, NodeConnection, NodeDetail, NodeRegistrationToken, NodeTool, NodeToolApproval, RotateNodeSecretResult } from "../types";
export default function NodeManager({
  nodes,
  nodesQuery,
  approvalsQuery,
  executionMode,
  t,
}: {
  nodes: NodeConnection[];
  nodesQuery: ResourceQuery;
  approvalsQuery: ResourceQuery & { data?: NodeToolApproval[] };
  executionMode: ExecutionMode;
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
  const personalLocal = executionMode === "PERSONAL_LOCAL";
  const managedLocalExecutorAvailable = executionMode !== "NODES_ONLY";
  const managedLocalExecutor = nodes.find((node) => node.kind === "MANAGED_LOCAL");
  const detailsQuery = useQuery({
    queryKey: ["node", selectedId],
    queryFn: () => studioApi.getNode(selectedId!),
    enabled: Boolean(selectedId),
  });
  const localExecutorQuery = useQuery({
    queryKey: ["managed-local-executor", managedLocalExecutor?.id],
    queryFn: () => studioApi.getNode(managedLocalExecutor!.id),
    enabled: Boolean(managedLocalExecutor),
  });
  const localExecutorLauncherQuery = useQuery({
    queryKey: ["local-executor-launcher"],
    queryFn: studioApi.getLocalExecutorLauncherHealth,
    enabled: managedLocalExecutorAvailable,
    retry: 0,
    refetchInterval: 10_000,
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["node", variables.nodeId] });
      queryClient.invalidateQueries({
        queryKey: ["managed-local-executor", variables.nodeId],
      });
    },
  });
  const updateSystemAccess = useMutation({
    mutationFn: ({ nodeId, enabled }: { nodeId: string; enabled: boolean }) =>
      studioApi.setNodeSystemAccess(nodeId, enabled),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", variables.nodeId] });
    },
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
  const disconnectNode = useMutation({
    mutationFn: studioApi.disconnectNode,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["node", result.id] });
      queryClient.invalidateQueries({ queryKey: ["managed-local-executor", result.id] });
    },
  });
  const startLocalExecutor = useMutation({
    mutationFn: async (workspace: string) => {
      await studioApi.startLocalExecutor(workspace);

      // The launcher acknowledges before the Java process has registered and
      // opened its WebSocket. Keep the button in its loading state and publish
      // each observed node snapshot until the executor is genuinely usable.
      const nextNodes = await studioApi.waitForManagedLocalExecutorOnline();
      queryClient.setQueryData(["nodes"], nextNodes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      queryClient.invalidateQueries({ queryKey: ["local-executor-launcher"] });
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
  const systemAccessEnabled = systemTools.length > 0
    && systemTools.every((tool) => tool.enabled && !tool.requiresApproval);
  const localExecutorLauncherChecking = localExecutorLauncherQuery.isPending && managedLocalExecutorAvailable;
  const localExecutorLauncherAvailable = localExecutorLauncherQuery.data?.reachable ?? false;
  const setSystemAccess = (enabled: boolean) => {
    if (!selectedNode || !systemAccessAvailable || !systemTools.length) return;
    updateSystemAccess.mutate({ nodeId: selectedNode.id, enabled });
  };
  const copyCommand = async () => {
    if (!registration) return;
    try {
      await navigator.clipboard?.writeText(nodeRegistrationCommand(registration.registrationToken));
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
            disabled={!systemAccessAvailable || !systemTools.length || updateTool.isPending || updateSystemAccess.isPending}
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

  if (personalLocal)
    return (
      <div className="node-manager">
        <ManagedLocalExecutorStatus
          node={managedLocalExecutor}
          details={localExecutorQuery.data}
          toolsLoading={localExecutorQuery.isLoading}
          updatingTools={updateTool.isPending}
          disconnecting={disconnectNode.isPending}
          starting={startLocalExecutor.isPending}
          startError={startLocalExecutor.error instanceof Error ? startLocalExecutor.error.message : null}
          available={managedLocalExecutorAvailable}
          launcherChecking={localExecutorLauncherChecking}
          launcherAvailable={localExecutorLauncherAvailable}
          launcherWorkspace={localExecutorLauncherQuery.data?.workspace}
          onDisconnect={() => {
            if (!managedLocalExecutor) return;
            disconnectNode.mutate(managedLocalExecutor.id);
          }}
          onUpdateTool={(toolName, payload) => {
            if (!managedLocalExecutor) return;
            updateTool.mutate({
              nodeId: managedLocalExecutor.id,
              toolName,
              payload,
            });
          }}
          onStart={(workspace) => startLocalExecutor.mutate(workspace)}
          t={t}
        />
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
          <ManagedLocalExecutorStatus
            node={managedLocalExecutor}
            details={localExecutorQuery.data}
            toolsLoading={localExecutorQuery.isLoading}
            updatingTools={updateTool.isPending}
            disconnecting={disconnectNode.isPending}
            starting={startLocalExecutor.isPending}
            startError={startLocalExecutor.error instanceof Error ? startLocalExecutor.error.message : null}
            available={managedLocalExecutorAvailable}
            launcherChecking={localExecutorLauncherChecking}
            launcherAvailable={localExecutorLauncherAvailable}
            launcherWorkspace={localExecutorLauncherQuery.data?.workspace}
            onDisconnect={() => {
              if (!managedLocalExecutor) return;
              disconnectNode.mutate(managedLocalExecutor.id);
            }}
            onUpdateTool={(toolName, payload) => {
              if (!managedLocalExecutor) return;
              updateTool.mutate({
                nodeId: managedLocalExecutor.id,
                toolName,
                payload,
              });
            }}
            onStart={(workspace) => startLocalExecutor.mutate(workspace)}
            t={t}
          />
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
              <code>{nodeRegistrationCommand(registration.registrationToken)}</code>
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

function ManagedLocalExecutorStatus({
  node,
  details,
  toolsLoading,
  updatingTools,
  disconnecting,
  starting,
  startError,
  available,
  launcherChecking,
  launcherAvailable,
  launcherWorkspace,
  onDisconnect,
  onStart,
  onUpdateTool,
  t,
}: {
  node?: NodeConnection;
  details?: NodeDetail;
  toolsLoading: boolean;
  updatingTools: boolean;
  disconnecting: boolean;
  starting: boolean;
  startError: string | null;
  available: boolean;
  launcherChecking: boolean;
  launcherAvailable: boolean;
  launcherWorkspace?: string;
  onDisconnect: () => void;
  onStart: (workspace: string) => void;
  onUpdateTool: (toolName: string, payload: {
    enabled?: boolean;
    requiresApproval?: boolean;
  }) => void;
  t: (key: string) => string;
}) {
  const [workspace, setWorkspace] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!launcherWorkspace?.trim()) return;
    setWorkspace((current) => current.trim() ? current : launcherWorkspace);
  }, [launcherWorkspace]);
  const online = Boolean(available && node?.enabled && node.status?.toUpperCase() === "ONLINE");
  const status = !available
    ? t("localExecutorUnavailable")
    : !node
    ? t("localExecutorUnprovisioned")
    : !node.enabled
      ? t("disabled")
      : statusLabel(node.status, t);
  const command = localExecutorStartCommand(workspace);
  const companionDownloadUrl = windowsCompanionDownloadUrl();
  const installerAvailable = Boolean(companionDownloadUrl && !launcherChecking && !launcherAvailable);
  const workspaceConfigured = Boolean(workspace.trim());
  const systemTools = (details?.tools ?? []).filter((tool) =>
    tool.name.startsWith("system."),
  );
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="managed-local-executor" aria-label={t("localExecutor")}>
      <span className="managed-local-executor-icon" aria-hidden="true">
        <HardDrive size={16} />
      </span>
      <div className="managed-local-executor-copy">
        <div className="managed-local-executor-heading">
          <div>
            <strong>{t("localExecutor")}</strong>
            <p>{!available ? t("localExecutorUnavailableHint") : node ? t("localExecutorConnectedHint") : t("localExecutorHint")}</p>
          </div>
          <div className="managed-local-executor-actions">
            <span className="list-status">
              <span className="status-dot" data-online={online} />
              {status}
            </span>
            {online ? (
              <button
                className="secondary-button danger-button"
                type="button"
                disabled={disconnecting}
                onClick={onDisconnect}
              >
                {disconnecting ? <LoaderCircle size={14} className="spin" /> : <Unplug size={14} />}
                {t("disconnectNode")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="managed-local-executor-meta">
          <LocalExecutorMeta label={t("lastSeen")} value={node ? formatTimestamp(node.lastSeenAt) : "-"} />
          <LocalExecutorMeta label={t("nodeVersion")} value={node?.clientVersion || "-"} />
          <LocalExecutorMeta label={t("nodeArchitecture")} value={[node?.osName, node?.osArch].filter(Boolean).join(" · ") || "-"} />
          <LocalExecutorMeta
            label={t("localExecutorTools")}
            value={toolsLoading ? t("loading") : details ? String(details.tools.length) : "-"}
          />
        </div>
        {online && systemTools.length ? (
          <>
            <div className="knowledge-documents-heading">
              <div>
                <strong>{t("localExecutorCapabilities")}</strong>
                <span>{systemTools.length}</span>
              </div>
            </div>
            <div className="node-tool-list">
              {systemTools.map((tool) => (
                <NodeToolPolicyRow
                  key={tool.id}
                  tool={tool}
                  busy={updatingTools}
                  onChange={(payload) => onUpdateTool(tool.name, payload)}
                  t={t}
                />
              ))}
            </div>
          </>
        ) : null}
        {!online && available ? (
          <div className="local-executor-launch">
            <div>
              <strong>{t("localExecutorStartTitle")}</strong>
              <p>{launcherAvailable ? t("localExecutorOneClickHint") : installerAvailable ? t("localExecutorInstallHint") : t("localExecutorStartHint")}</p>
            </div>
            {!installerAvailable ? <label>
              {t("localExecutorWorkspace")}
              <input
                value={workspace}
                onChange={(event) => {
                  setWorkspace(event.target.value);
                  setCopied(false);
                }}
                placeholder={t("localExecutorWorkspacePlaceholder")}
              />
            </label> : null}
            {installerAvailable && companionDownloadUrl ? (
              <div className="local-executor-install-actions">
                <a className="primary-button" href={companionDownloadUrl} download>
                  <Download size={14} />
                  {t("localExecutorDownloadWindows")}
                </a>
              </div>
            ) : workspaceConfigured && !launcherChecking && !launcherAvailable ? (
              <div className="node-command local-executor-command">
                <code>{command}</code>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void copyCommand()}
                >
                  <Copy size={14} />
                  {copied ? t("commandCopied") : t("localExecutorCopyStartCommand")}
                </button>
              </div>
            ) : !workspaceConfigured ? (
              <p className="local-executor-workspace-hint">{t("localExecutorWorkspaceHint")}</p>
            ) : null}
            {!installerAvailable && !launcherChecking && !launcherAvailable ? (
              <p className="local-executor-start-error">
                <CircleAlert size={14} />
                {t("localExecutorLauncherUnavailable")}
              </p>
            ) : null}
            {launcherChecking || launcherAvailable ? <div className="local-executor-launch-actions">
              <button
                className="primary-button"
                type="button"
                disabled={
                  starting ||
                  launcherChecking ||
                  !launcherAvailable ||
                  !workspaceConfigured
                }
                onClick={() => onStart(workspace)}
                aria-busy={starting}
              >
                {starting ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                {starting ? t("localExecutorStarting") : t("localExecutorStart")}
              </button>
            </div> : null}
            {startError ? (
              <div className="local-executor-start-error">
                <CircleAlert size={14} />
                <span>{startError}</span>
                <button
                  className="connection-retry"
                  type="button"
                  disabled={starting || !launcherAvailable || !workspaceConfigured}
                  onClick={() => onStart(workspace)}
                >
                  {t("retry")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function windowsCompanionDownloadUrl() {
  if (!navigator.userAgent.includes("Windows")) return null;
  const configured = import.meta.env.VITE_WINDOWS_COMPANION_DOWNLOAD_URL;
  if (typeof configured !== "string" || !configured.trim()) return null;
  try {
    const url = new URL(configured.trim(), window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function localExecutorStartCommand(workspace: string) {
  const configuredServer = import.meta.env.VITE_NODE_SERVER_URL;
  const configuredApiRoot = import.meta.env.VITE_API_BASE_URL;
  const developmentProxyTarget = import.meta.env.VITE_DEV_PROXY_TARGET;
  const server = typeof configuredServer === "string" && /^https?:\/\//i.test(configuredServer)
    ? configuredServer.replace(/\/+$/, "")
    : typeof configuredApiRoot === "string" && /^https?:\/\//i.test(configuredApiRoot)
    ? new URL(configuredApiRoot).origin
    : import.meta.env.DEV && typeof developmentProxyTarget === "string" && /^https?:\/\//i.test(developmentProxyTarget)
    ? developmentProxyTarget.replace(/\/+$/, "")
    : window.location.origin;
  const workspaceArgument = workspace.trim()
    ? ` --workspace "${workspace.trim().replaceAll('"', '\\"')}"`
    : "";
  const argumentsValue = `start-local --server ${server}${workspaceArgument}`;
  if (navigator.userAgent.includes("Windows")) {
    return `.\\gradlew.bat :agent-studio-node-java:run '--args=${argumentsValue.replaceAll("'", "''")}'`;
  }
  return `./gradlew :agent-studio-node-java:run --args='${argumentsValue.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function nodeRegistrationCommand(token: string) {
  const configuredApiRoot = import.meta.env.VITE_API_BASE_URL;
  const server = typeof configuredApiRoot === "string" && /^https?:\/\//i.test(configuredApiRoot)
    ? new URL(configuredApiRoot).origin
    : window.location.origin;
  const escapedToken = token.replaceAll("'", "'\\\"'\\\"'");
  if (navigator.userAgent.includes("Windows")) {
    const scriptUrl = `${server}/node-bootstrap.ps1`;
    const escapedPowerShellToken = token.replaceAll("'", "''");
    return `curl.exe -fsSL "${scriptUrl}" -o agent-studio-node-bootstrap.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\agent-studio-node-bootstrap.ps1 -Server "${server}" -Token '${escapedPowerShellToken}'`;
  }
  const scriptUrl = `${server}/node-bootstrap.sh`;
  return `curl -fsSL '${scriptUrl}' -o agent-studio-node-bootstrap.sh && sh agent-studio-node-bootstrap.sh --server '${server}' --token '${escapedToken}'`;
}

function LocalExecutorMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
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
