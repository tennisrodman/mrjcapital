import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { useUploadDocument } from '@/lib/api/documents';
import { formErrorMessage } from '@/lib/apiError';
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/dealChoices';
import type { Deal, DocumentCategory } from '@/types/deal';

const CATEGORY_OPTIONS = Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface DocumentUploadDialogProps {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentUploadDialog({ deal, open, onOpenChange }: DocumentUploadDialogProps) {
  const upload = useUploadDocument(deal.id);
  const [file, setFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>('offering_memo');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setDocumentName('');
      setNameEdited(false);
      setCategory('offering_memo');
      setNotes('');
      setError(null);
    }
  }, [open]);

  // Derive the name from the selected file until the user edits it themselves,
  // so swapping the chosen file updates the name instead of keeping the old one.
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
      await upload.mutateAsync({
        file,
        documentName: documentName.trim() || file.name,
        category,
        notes,
      });
      onOpenChange(false);
    } catch (err) {
      setError(formErrorMessage(err, 'Could not upload document.'));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--ink)]/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                Upload document
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Add a file to {deal.name}. Matching name and category creates a new version.
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
            <FormField label="File" htmlFor="document-file">
              <Input
                id="document-file"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </FormField>

            <FormField label="Document name" htmlFor="document-name">
              <Input
                id="document-name"
                value={documentName}
                onChange={(event) => {
                  setNameEdited(true);
                  setDocumentName(event.target.value);
                }}
                placeholder="Offering memo"
              />
            </FormField>

            <FormField label="Category" htmlFor="document-category">
              <SelectNative
                id="document-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as DocumentCategory)}
                options={CATEGORY_OPTIONS}
              />
            </FormField>

            <FormField label="Notes" htmlFor="document-notes">
              <Textarea
                id="document-notes"
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
              <Button type="submit" disabled={upload.isPending}>
                <Upload className="h-4 w-4" strokeWidth={1.75} />
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
