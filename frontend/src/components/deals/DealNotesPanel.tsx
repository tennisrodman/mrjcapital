import { useState } from 'react';

import { NoteAttachments } from '@/components/deals/NoteAttachments';
import { Panel } from '@/components/deals/Panel';
import { ErrorState } from '@/components/deals/States';
import { Button } from '@/components/ui/button';
import { useDownloadDocument } from '@/lib/api/documents';
import { useCreateNote, useDeleteNote, useUpdateNote } from '@/lib/api/notes';
import { apiErrorMessage } from '@/lib/apiError';
import { formatDateTime } from '@/lib/dealChoices';
import type { DealDocument, DealNote } from '@/types/deal';

interface DealNotesPanelProps {
  dealId: string;
  notes: DealNote[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  documents: DealDocument[];
}

export function DealNotesPanel({
  dealId,
  notes,
  isLoading,
  isError,
  onRetry,
  documents,
}: DealNotesPanelProps) {
  const [body, setBody] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const createNote = useCreateNote(dealId);
  const deleteNote = useDeleteNote(dealId);
  const updateNote = useUpdateNote(dealId);
  const download = useDownloadDocument();

  const toggleDoc = (id: string) => {
    setSelectedDocs((current) =>
      current.includes(id) ? current.filter((docId) => docId !== id) : [...current, id],
    );
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    createNote.mutate(
      {
        deal: dealId,
        body: trimmed,
        attachments: selectedDocs.length > 0 ? selectedDocs : undefined,
      },
      {
        onSuccess: () => {
          setBody('');
          setSelectedDocs([]);
        },
      },
    );
  };

  return (
    <Panel title="Notes" count={notes.length}>
      <div className="space-y-3">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Add an internal note…"
          className="w-full resize-y rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--slate)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)]"
        />
        {documents.length > 0 ? (
          <details className="rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-2">
            <summary className="cursor-pointer text-xs text-[var(--slate)]">
              Attach documents
              {selectedDocs.length > 0 ? ` · ${selectedDocs.length} selected` : ''}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {documents.map((document) => (
                <li key={document.id}>
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={selectedDocs.includes(document.id)}
                      onChange={() => toggleDoc(document.id)}
                    />
                    <span className="truncate">
                      {document.document_name}
                      <span className="ml-1 text-xs text-[var(--slate)]">
                        v{document.version}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!body.trim() || createNote.isPending}
          >
            {createNote.isPending ? 'Adding…' : 'Add note'}
          </Button>
        </div>
        {createNote.isError ? (
          <p className="text-sm text-red-600">
            Couldn't add note: {apiErrorMessage(createNote.error)}
          </p>
        ) : null}
      </div>

      {deleteNote.isError ? (
        <p className="mt-3 text-sm text-red-600">
          Couldn't delete note: {apiErrorMessage(deleteNote.error)}
        </p>
      ) : null}
      {updateNote.isError ? (
        <p className="mt-3 text-sm text-red-600">
          Couldn't update note: {apiErrorMessage(updateNote.error)}
        </p>
      ) : null}
      {downloadError ? <p className="mt-3 text-sm text-red-600">{downloadError}</p> : null}

      {isLoading ? (
        <p className="mt-4 text-sm text-[var(--slate)]">Loading notes…</p>
      ) : isError ? (
        <div className="mt-4">
          <ErrorState
            title="Notes unavailable"
            message="Notes could not be loaded."
            onRetry={onRetry}
          />
        </div>
      ) : notes.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--slate)]">No notes on this deal yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-2"
            >
              {editingNoteId === note.id ? (
                <textarea
                  value={editingBody}
                  onChange={(event) => setEditingBody(event.target.value)}
                  rows={3}
                  aria-label="Edit note"
                  className="w-full resize-y rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)]"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{note.body}</p>
              )}
              <NoteAttachments
                attachmentIds={note.attachments}
                documents={documents}
                isDownloading={download.isPending}
                onDownload={(document) => {
                  setDownloadError(null);
                  download.mutate(document, {
                    onError: (error) =>
                      setDownloadError(
                        `Couldn't download ${document.document_name}: ${apiErrorMessage(error)}`,
                      ),
                  });
                }}
              />
              <div className="mt-1 flex items-center justify-between text-[0.7rem] text-[var(--slate)]/80">
                <span>
                  {note.author_username ?? 'Unknown'} · {formatDateTime(note.created_at)}
                  {note.updated_at !== note.created_at ? ' · edited' : ''}
                </span>
                {note.can_edit || note.can_delete ? (
                  <span className="flex items-center gap-1">
                    {editingNoteId === note.id ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingNoteId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!editingBody.trim() || updateNote.isPending}
                          onClick={() =>
                            updateNote.mutate(
                              { noteId: note.id, body: editingBody.trim() },
                              { onSuccess: () => setEditingNoteId(null) },
                            )
                          }
                        >
                          {updateNote.isPending ? 'Saving…' : 'Save'}
                        </Button>
                      </>
                    ) : note.can_edit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingNoteId(note.id);
                          setEditingBody(note.body);
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {note.can_delete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!window.confirm('Delete this note? This cannot be undone.')) return;
                          deleteNote.mutate(note.id);
                        }}
                        disabled={deleteNote.isPending}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
