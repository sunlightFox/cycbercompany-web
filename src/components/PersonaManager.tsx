import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CircleAlert,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { studioApi } from "../lib/api";
import type { UserPersona } from "../types";

type PersonaFormValues = {
  name: string;
  description: string;
  attributes: Array<{ key: string; value: string }>;
};

const personaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  attributes: z.array(z.object({ key: z.string().trim().min(1).max(80), value: z.string().trim().max(500) })).max(40),
});

const emptyPersona: PersonaFormValues = { name: "", description: "", attributes: [] };

export default function PersonaManager({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<UserPersona | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserPersona | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["personas"], queryFn: studioApi.listPersonas });
  const form = useForm<PersonaFormValues>({ defaultValues: emptyPersona });
  const fields = useFieldArray({ control: form.control, name: "attributes" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["personas"] });
  const fail = (failure: unknown) => {
    setNotice("");
    setError(failure instanceof Error && failure.message ? failure.message : t("personaActionFailed"));
  };
  const save = useMutation({
    mutationFn: (values: PersonaFormValues) => {
      const attributes = Object.fromEntries(values.attributes.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
      return editing
        ? studioApi.updatePersona(editing.id, { name: values.name.trim(), description: values.description.trim(), attributes, expectedRevision: editing.revision })
        : studioApi.createPersona({ name: values.name.trim(), description: values.description.trim(), attributes, defaultPersona: !query.data?.length });
    },
    onSuccess: () => {
      setEditorOpen(false);
      setEditing(null);
      setError("");
      setNotice(t("personaSaved"));
      refresh();
    },
    onError: fail,
  });
  const setDefault = useMutation({
    mutationFn: studioApi.setDefaultPersona,
    onSuccess: () => { setError(""); setNotice(t("personaDefaultSet")); refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: studioApi.deletePersona,
    onSuccess: () => { setDeleteTarget(null); setError(""); setNotice(t("personaDeleted")); refresh(); },
    onError: fail,
  });
  const openCreate = () => { setEditing(null); form.reset(emptyPersona); setError(""); setEditorOpen(true); };
  const openEdit = (persona: UserPersona) => {
    setEditing(persona);
    form.reset({ name: persona.name, description: persona.description, attributes: Object.entries(persona.attributes).map(([key, value]) => ({ key, value: String(value ?? "") })) });
    setError("");
    setEditorOpen(true);
  };
  const submit = form.handleSubmit((values) => {
    const parsed = personaSchema.safeParse(values);
    if (!parsed.success || parsed.data.attributes.some((item) => !item.value.trim())) { setError(t("personaFormInvalid")); return; }
    save.mutate(parsed.data);
  });
  const personas = query.data ?? [];

  return (
    <div className="persona-manager">
      <div className="persona-toolbar">
        <button type="button" className="primary-button" onClick={openCreate}><Plus size={15} />{t("personaAdd")}</button>
      </div>
      {notice ? <div className="manager-notice" role="status"><Check size={14} />{notice}</div> : null}
      {error ? <div className="manager-notice error" role="alert"><CircleAlert size={14} />{error}</div> : null}
      {query.isLoading ? <div className="manager-placeholder"><LoaderCircle size={18} className="spin" /><span>{t("loading")}</span></div> : query.isError ? <div className="manager-placeholder"><CircleAlert size={20} /><strong>{t("personaLoadFailed")}</strong><button type="button" className="secondary-button" onClick={() => query.refetch()}>{t("retry")}</button></div> : personas.length === 0 ? <div className="manager-placeholder"><UserRound size={22} /><strong>{t("personaEmpty")}</strong><span>{t("personaEmptyHint")}</span><button type="button" className="secondary-button" onClick={openCreate}>{t("personaAdd")}</button></div> : (
        <div className="persona-list">
          {personas.map((persona) => (
            <article className="persona-row" key={persona.id}>
              <div className="persona-avatar"><UserRound size={17} /></div>
              <div className="persona-copy"><div className="persona-title"><strong>{persona.name}</strong>{persona.defaultPersona ? <span className="persona-default">{t("personaDefault")}</span> : null}</div><p>{persona.description || t("personaNoDescription")}</p><small>{t("personaAttributeCount", { count: Object.keys(persona.attributes).length })}</small></div>
              <div className="persona-actions">
                {!persona.defaultPersona ? <button type="button" className="secondary-button" onClick={() => setDefault.mutate(persona.id)} disabled={setDefault.isPending}>{t("personaSetDefault")}</button> : null}
                <button type="button" className="icon-button" aria-label={t("personaEdit")} title={t("personaEdit")} onClick={() => openEdit(persona)}><Pencil size={15} /></button>
                <button type="button" className="icon-button danger-icon-button" aria-label={t("personaDelete")} title={t("personaDelete")} onClick={() => setDeleteTarget(persona)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog.Root open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditing(null); }}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog persona-editor-dialog" aria-describedby="persona-editor-description">
          <div className="dialog-header"><div><Dialog.Title>{editing ? t("personaEditTitle") : t("personaCreateTitle")}</Dialog.Title><Dialog.Description id="persona-editor-description">{t("personaEditorHint")}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div>
          <form className="persona-form" onSubmit={submit}>
            <label><span>{t("personaName")}</span><input {...form.register("name")} autoFocus /></label>
            <label><span>{t("personaDescription")}</span><textarea {...form.register("description")} rows={3} /></label>
            <fieldset><legend>{t("personaAttributes")}</legend><small>{t("personaAttributesHint")}</small>{fields.fields.map((field, index) => <div className="persona-attribute-row" key={field.id}><input aria-label={t("personaAttributeKey")} placeholder={t("personaAttributeKey")} {...form.register(`attributes.${index}.key`)} /><input aria-label={t("personaAttributeValue")} placeholder={t("personaAttributeValue")} {...form.register(`attributes.${index}.value`)} /><button type="button" className="icon-button" aria-label={t("personaRemoveAttribute")} title={t("personaRemoveAttribute")} onClick={() => fields.remove(index)}><X size={15} /></button></div>)}<button type="button" className="quiet-button" onClick={() => fields.append({ key: "", value: "" })} disabled={fields.fields.length >= 40}><Plus size={14} />{t("personaAddAttribute")}</button></fieldset>
            <div className="inline-form-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close><button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{editing ? t("save") : t("personaCreate")}</button></div>
          </form>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="utility-dialog persona-confirm-dialog"><div className="dialog-header"><div><Dialog.Title>{t("personaDeleteTitle")}</Dialog.Title><Dialog.Description>{t("personaDeleteHint", { name: deleteTarget?.name ?? "" })}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("close")} title={t("close")}><X size={17} /></button></Dialog.Close></div><div className="inline-form-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t("cancel")}</button></Dialog.Close><button type="button" className="danger-button" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}><Trash2 size={14} />{t("personaDelete")}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}
