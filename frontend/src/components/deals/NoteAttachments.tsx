import { Download, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DealDocument } from '@/types/deal';

interface NoteAttachmentsProps {
  attachmentIds: string[];
  documents: DealDocument[];
  isDownloading?: boolean;
  onDownload: (document: DealDocument) => void;
}

export function NoteAttachments({
  attachmentIds,
  documents,
  isDownloading = false,
  onDownload,
}: NoteAttachmentsProps) {
  if (attachmentIds.length === 0) return null;

  const documentsById = new Map(documents.map((document) => [document.id, document]));

  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Note attachments">
      {attachmentIds.map((attachmentId) => {
        const document = documentsById.get(attachmentId);
        if (!document) {
          return (
            <li
              key={attachmentId}
              className="rounded-sm border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--slate)]"
            >
              Attachment unavailable
            </li>
          );
        }

        return (
          <li key={attachmentId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={() => onDownload(document)}
              aria-label={`Download ${document.document_name}, version ${document.version}`}
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="max-w-52 truncate">{document.document_name}</span>
              <span className="text-[0.65rem] text-[var(--slate)]">v{document.version}</span>
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
