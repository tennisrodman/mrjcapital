import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { useSetQuoteAttachments } from '@/lib/api/quotes';
import { useUploadDocument } from '@/lib/api/documents';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import type { Quote, QuoteAttachmentSubcategory } from '@/types/quote';

const SUBCATEGORY_OPTIONS: Array<{ value: QuoteAttachmentSubcategory; label: string }> = [
  { value: 'term_sheet', label: 'Term sheet' },
  { value: 'loi', label: 'LOI' },
];

interface QuoteDocumentUploaderProps {
  dealId: string;
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuoteDocumentUploader({
  dealId,
  quote,
  open,
  onOpenChange,
}: QuoteDocumentUploaderProps) {
  const upload = useUploadDocument(dealId);
  const setAttachments = useSetQuoteAttachments(dealId);
  const [file, setFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [subcategory, setSubcategory] = useState<QuoteAttachmentSubcategory>('term_sheet');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setDocumentName('');
      setNameEdited(false);
      setSubcategory('term_sheet');
      setNotes('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (file && !nameEdited) {
      setDocumentName(file.name.replace(/\.[^.]+$/, ''));
    }
  }, [file, nameEdited]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    try {
      const document = await upload.mutateAsync({
        file,
        documentName: documentName.trim() || file.name,
        category: 'legal',
        subcategory,
        notes,
      });
      const documentIds = Array.from(new Set([...quote.attachments, document.id]));
      await setAttachments.mutateAsync({
        quoteId: quote.id,
        payload: { document_ids: documentIds },
      });
      onOpenChange(false);
    } catch (err) {
      const fields = fieldErrors(err);
      setError(fields ? Object.values(fields).flat().join(' ') : apiErrorMessage(err));
    }
  }

  const pending = upload.isPending || setAttachments.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                Attach term sheet / LOI
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Uploads are locked to the legal category. Choose term sheet or LOI, then attach to
                quote v{quote.version}.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </div>

          <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <FormField label="File" htmlFor="quote-document-file">
              <Input
                id="quote-document-file"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </FormField>

            <FormField label="Document name" htmlFor="quote-document-name">
              <Input
                id="quote-document-name"
                value={documentName}
                onChange={(event) => {
                  setNameEdited(true);
                  setDocumentName(event.target.value);
                }}
                placeholder="Term sheet"
              />
            </FormField>

            <FormField label="Category" htmlFor="quote-document-category">
              <Input id="quote-document-category" value="Legal" readOnly disabled />
            </FormField>

            <FormField label="Subcategory" htmlFor="quote-document-subcategory">
              <SelectNative
                id="quote-document-subcategory"
                value={subcategory}
                onChange={(event) =>
                  setSubcategory(event.target.value as QuoteAttachmentSubcategory)
                }
                options={SUBCATEGORY_OPTIONS}
              />
            </FormField>

            <FormField label="Notes" htmlFor="quote-document-notes">
              <Textarea
                id="quote-document-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Optional context for the team"
              />
            </FormField>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={pending}>
                <Upload className="h-4 w-4" strokeWidth={1.75} />
                {pending ? 'Uploading…' : 'Upload & attach'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
