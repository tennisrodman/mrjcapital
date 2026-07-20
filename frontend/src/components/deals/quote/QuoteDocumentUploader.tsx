import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { useDealDocuments } from '@/lib/api/deals';
import { useSetQuoteAttachments } from '@/lib/api/quotes';
import { useUploadDocument } from '@/lib/api/documents';
import { formErrorMessage } from '@/lib/apiError';
import type { DealDocument } from '@/types/deal';
import type { Quote, QuoteAttachmentSubcategory } from '@/types/quote';

const SUBCATEGORY_OPTIONS: Array<{ value: QuoteAttachmentSubcategory; label: string }> = [
  { value: 'term_sheet', label: 'Term sheet' },
  { value: 'loi', label: 'LOI' },
];

type Mode = 'upload' | 'existing';

interface QuoteDocumentUploaderProps {
  dealId: string;
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isEligibleQuoteDocument(doc: DealDocument): boolean {
  return (
    doc.category === 'legal' &&
    (doc.subcategory === 'term_sheet' || doc.subcategory === 'loi') &&
    doc.storage_status === 'ready'
  );
}

export function QuoteDocumentUploader({
  dealId,
  quote,
  open,
  onOpenChange,
}: QuoteDocumentUploaderProps) {
  const documentsQuery = useDealDocuments(dealId);
  const upload = useUploadDocument(dealId);
  const setAttachments = useSetQuoteAttachments(dealId);
  const [mode, setMode] = useState<Mode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [subcategory, setSubcategory] = useState<QuoteAttachmentSubcategory>('term_sheet');
  const [notes, setNotes] = useState('');
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const eligibleExisting = useMemo(() => {
    const docs = documentsQuery.data ?? [];
    const attached = new Set(quote.attachments);
    return docs.filter((doc) => isEligibleQuoteDocument(doc) && !attached.has(doc.id));
  }, [documentsQuery.data, quote.attachments]);

  useEffect(() => {
    if (open) {
      setMode('upload');
      setFile(null);
      setDocumentName('');
      setNameEdited(false);
      setSubcategory('term_sheet');
      setNotes('');
      setSelectedExistingId('');
      setError(null);
      setInfo(null);
    }
  }, [open]);

  useEffect(() => {
    if (file && !nameEdited) {
      setDocumentName(file.name.replace(/\.[^.]+$/, ''));
    }
  }, [file, nameEdited]);

  async function attachDocumentIds(documentIds: string[]) {
    await setAttachments.mutateAsync({
      quoteId: quote.id,
      payload: { document_ids: documentIds },
    });
  }

  async function handleUploadSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    setInfo(null);
    let uploaded: DealDocument | null = null;
    try {
      uploaded = await upload.mutateAsync({
        file,
        documentName: documentName.trim() || file.name,
        category: 'legal',
        subcategory,
        notes,
      });
      const documentIds = Array.from(new Set([...quote.attachments, uploaded.id]));
      await attachDocumentIds(documentIds);
      onOpenChange(false);
    } catch (err) {
      const message = formErrorMessage(err, 'Could not upload and attach document.');
      if (uploaded) {
        setMode('existing');
        setSelectedExistingId(uploaded.id);
        setInfo(
          `${uploaded.document_name} uploaded successfully but was not attached. Select it below and attach, or cancel and retry later — the document remains on the deal.`,
        );
        setError(message);
      } else {
        setError(message);
      }
    }
  }

  async function handleExistingSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedExistingId) {
      setError('Select an eligible document to attach.');
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const documentIds = Array.from(new Set([...quote.attachments, selectedExistingId]));
      await attachDocumentIds(documentIds);
      onOpenChange(false);
    } catch (err) {
      setError(formErrorMessage(err, 'Could not attach document.'));
    }
  }

  const pending = upload.isPending || setAttachments.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--ink)]/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                Attach term sheet / LOI
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Attach ready legal documents to quote v{quote.version}. Upload a new file or reuse one
                already on this deal.
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

          <div
            className="mt-4 inline-flex rounded-sm border border-[var(--border)] p-0.5 text-xs font-semibold"
            role="tablist"
            aria-label="Attachment source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'upload'}
              className={
                mode === 'upload'
                  ? 'rounded-sm bg-[var(--ink)] px-3 py-1.5 text-[var(--paper)]'
                  : 'rounded-sm px-3 py-1.5 text-[var(--slate)] hover:text-[var(--ink)]'
              }
              onClick={() => {
                setMode('upload');
                setError(null);
              }}
            >
              Upload new
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'existing'}
              className={
                mode === 'existing'
                  ? 'rounded-sm bg-[var(--ink)] px-3 py-1.5 text-[var(--paper)]'
                  : 'rounded-sm px-3 py-1.5 text-[var(--slate)] hover:text-[var(--ink)]'
              }
              onClick={() => {
                setMode('existing');
                setError(null);
              }}
            >
              Attach existing
            </button>
          </div>

          {info ? <p className="mt-3 text-sm text-[var(--ink-muted)]">{info}</p> : null}

          {mode === 'upload' ? (
            <form className="mt-4 space-y-4" onSubmit={(event) => void handleUploadSubmit(event)}>
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
                  {pending ? 'Working…' : 'Upload & attach'}
                </Button>
              </div>
            </form>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={(event) => void handleExistingSubmit(event)}>
              <FormField label="Eligible document" htmlFor="quote-existing-document">
                <SelectNative
                  id="quote-existing-document"
                  value={selectedExistingId}
                  onChange={(event) => setSelectedExistingId(event.target.value)}
                  options={[
                    { value: '', label: documentsQuery.isLoading ? 'Loading…' : 'Select a document' },
                    ...eligibleExisting.map((doc) => ({
                      value: doc.id,
                      label: `${doc.document_name} · ${doc.subcategory === 'loi' ? 'LOI' : 'Term sheet'} · ready`,
                    })),
                  ]}
                />
              </FormField>
              {!documentsQuery.isLoading && documentsQuery.isError ? (
                <p className="text-sm text-red-600">
                  Could not load eligible documents.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void documentsQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              {!documentsQuery.isLoading && !documentsQuery.isError && eligibleExisting.length === 0 ? (
                <p className="text-sm text-[var(--slate)]">
                  No unattached ready legal term sheets or LOIs on this deal. Upload a new file
                  instead.
                </p>
              ) : null}

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={pending || !selectedExistingId}>
                  <Link2 className="h-4 w-4" strokeWidth={1.75} />
                  {pending ? 'Attaching…' : 'Attach'}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
