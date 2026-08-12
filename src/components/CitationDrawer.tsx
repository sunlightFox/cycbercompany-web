import * as Dialog from "@radix-ui/react-dialog";
import { FileText, X } from "lucide-react";
import { safeExternalUrl } from "../lib/safeExternalUrl";
import type { Citation } from "../types";

type Translator = (key: string) => string;

export default function CitationDrawer({
  citation,
  onClose,
  t,
}: {
  citation: Citation;
  onClose: () => void;
  t: Translator;
}) {
  const externalLocation = citation.type === "web" ? safeExternalUrl(citation.location) : undefined;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-scrim" />
        <Dialog.Content className="citation-drawer">
          <div className="drawer-header">
            <div>
              <small>{t("sources")}</small>
              <Dialog.Title asChild>
                <h2>{citation.title}</h2>
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
            {t("sources")}
          </Dialog.Description>
          <div className="drawer-body">
            <div className="source-type">
              <FileText size={15} />
              {citation.source}
            </div>
            <blockquote>{citation.quote}</blockquote>
            {citation.location ? (
              <p className="source-location">
                {t("location")}: {citation.location}
              </p>
            ) : null}
            {externalLocation ? (
              <a
                className="source-link"
                href={externalLocation}
                target="_blank"
                rel="noreferrer"
              >
                {externalLocation}
              </a>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
