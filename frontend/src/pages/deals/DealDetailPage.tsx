import { useContext, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileSignature,
  FileText,
  Globe2,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ScanSearch,
  Star,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { DocumentUploadDialog } from '@/components/deals/DocumentUploadDialog';
import { DealContactsPanel } from '@/components/deals/DealContactsPanel';
import { NoteAttachments } from '@/components/deals/NoteAttachments';
import { AuthContext } from '@/context/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Panel, Field } from '@/components/deals/Panel';
import { InvestmentChip, PipelineBadge, SyndicationBadge } from '@/components/deals/StatusBadge';
import { TransitionDialog } from '@/components/deals/TransitionDialog';
import { StageHistoryPanel } from '@/components/deals/StageHistoryPanel';
import { EmptyState, ErrorState, Spinner } from '@/components/deals/States';
import { useClosingPackage } from '@/lib/api/closing';
import { useDeal, useDealActivity, useDealDocuments, useDealStageHistory } from '@/lib/api/deals';
import {
  formatFileSize,
  useDeleteDocument,
  useDownloadDocument,
  useUpdateDocumentMetadata,
} from '@/lib/api/documents';
import { useDealNotes, useCreateNote, useDeleteNote, useUpdateNote } from '@/lib/api/notes';
import { apiErrorMessage } from '@/lib/apiError';
import {
  DOCUMENT_CATEGORY_LABELS,
  INVESTMENT_CATEGORY_LABELS,
  PIPELINE_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  RELATIONSHIP_RATING_LABELS,
  SOURCE_CHANNEL_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '@/lib/dealChoices';
import type { ActivityLogEntry, Deal, DealDocument, DealNote, DocumentCategory } from '@/types/deal';

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useContext(AuthContext);
  const isStaff = Boolean(user?.is_staff);

  const dealQuery = useDeal(id);
  const documentsQuery = useDealDocuments(id);
  const stageHistoryQuery = useDealStageHistory(id);
  const activityQuery = useDealActivity(id, isStaff);
  const notesQuery = useDealNotes(id);
  const [openDialog, setOpenDialog] = useState<'pipeline' | 'syndication' | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  if (dealQuery.isLoading) return <Spinner label="Loading deal…" />;

  if (dealQuery.isError || !dealQuery.data) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState
          title="Deal unavailable"
          message="We couldn't find this deal. It may have been removed, or you may not have access to it."
          onRetry={() => void dealQuery.refetch()}
        />
      </div>
    );
  }

  const deal = dealQuery.data;

  return (
    <div className="space-y-6">
      <BackLink />
      <DealHeader
        deal={deal}
        onMoveStage={() => setOpenDialog('pipeline')}
        onSyndication={() => setOpenDialog('syndication')}
      />

      <TransitionDialog
        deal={deal}
        kind="pipeline"
        open={openDialog === 'pipeline'}
        onOpenChange={(open) => setOpenDialog(open ? 'pipeline' : null)}
      />
      <TransitionDialog
        deal={deal}
        kind="syndication"
        open={openDialog === 'syndication'}
        onOpenChange={(open) => setOpenDialog(open ? 'syndication' : null)}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="animate-fade-up stagger-2 space-y-6">
          <OverviewPanel deal={deal} />
          <PropertiesPanel deal={deal} />
          <DealContactsPanel dealId={deal.id} />
          <DocumentsPanel
            dealId={deal.id}
            documents={documentsQuery.data ?? []}
            isLoading={documentsQuery.isLoading}
            isError={documentsQuery.isError}
            onUpload={() => setUploadOpen(true)}
          />
        </div>

        <aside className="animate-fade-up stagger-3 space-y-6">
          <StageHistoryPanel
            events={stageHistoryQuery.data ?? []}
            isLoading={stageHistoryQuery.isLoading}
            isError={stageHistoryQuery.isError}
            onRetry={() => void stageHistoryQuery.refetch()}
          />
          <SponsorPanel deal={deal} />
          <BrokerPanel deal={deal} />
          <NotesPanel
            dealId={deal.id}
            notes={notesQuery.data ?? []}
            isLoading={notesQuery.isLoading}
            isError={notesQuery.isError}
            onRetry={() => void notesQuery.refetch()}
            documents={documentsQuery.data ?? []}
          />
          {isStaff ? (
              <ActivityPanel
                entries={activityQuery.data ?? []}
                isLoading={activityQuery.isLoading}
                isError={activityQuery.isError}
                onRetry={() => void activityQuery.refetch()}
              />
          ) : null}
        </aside>
      </div>

      <DocumentUploadDialog deal={deal} open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/deals"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--slate)] transition-colors hover:text-[var(--ink)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      All deals
    </Link>
  );
}

function DealHeader({
  deal,
  onMoveStage,
  onSyndication,
}: {
  deal: Deal;
  onMoveStage: () => void;
  onSyndication: () => void;
}) {
  const closingPackageQuery = useClosingPackage(deal.id);
  const showClosingLink =
    ['signed', 'closing'].includes(deal.pipeline_status) || Boolean(closingPackageQuery.data);

  return (
    <header className="animate-fade-up flex flex-col gap-5 border-b border-[var(--border)] pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PipelineBadge status={deal.pipeline_status} showStage />
            <SyndicationBadge status={deal.syndication_status} hideNotStarted />
            {deal.pipeline_status === 'on_hold' && deal.paused_from_status ? (
              <span className="text-xs text-[var(--slate)]">
                paused from {PIPELINE_STATUS_LABELS[deal.paused_from_status]}
              </span>
            ) : null}
          </div>
          <h1 className="font-display mt-3 break-words text-3xl font-medium text-[var(--ink)]">
            {deal.name}
          </h1>
          <div className="mt-2">
            <InvestmentChip type={deal.investment_type} category={deal.investment_category} />
          </div>
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[var(--slate)]">
            Requested
          </p>
          <p className="font-display mt-1 text-3xl font-medium tabular-nums text-[var(--ink)]">
            {formatCurrency(deal.requested_amount)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onMoveStage}>
          <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Move stage
        </Button>
        <Button type="button" variant="outline" onClick={onSyndication}>
          <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
          Syndication
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to={`/deals/${deal.id}/screening`}>
            <ScanSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
            Screening
          </Link>
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to={`/deals/${deal.id}/quotes`}>
            <FileSignature className="h-3.5 w-3.5" strokeWidth={1.75} />
            Quotes
          </Link>
        </Button>
        {showClosingLink ? (
          <Button type="button" variant="outline" asChild>
            <Link to={`/deals/${deal.id}/closing`}>
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
              Closing
            </Link>
          </Button>
        ) : null}
        <Button type="button" variant="outline" asChild>
          <Link to={`/deals/${deal.id}/edit`}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            Edit deal
          </Link>
        </Button>
      </div>
    </header>
  );
}

function OverviewPanel({ deal }: { deal: Deal }) {
  return (
    <Panel title="Overview">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Field label="Category">{INVESTMENT_CATEGORY_LABELS[deal.investment_category]}</Field>
        <Field label="Source">{SOURCE_CHANNEL_LABELS[deal.source_channel]}</Field>
        <Field label="Sourced">{formatDate(deal.source_date)}</Field>
        <Field label="Fund">{deal.fund_detail?.name ?? 'Unassigned'}</Field>
        <Field label="Analyst">{deal.assigned_analyst_detail?.username ?? 'Unassigned'}</Field>
        <Field label="Stage age">{deal.days_in_current_stage} days</Field>
        <Field label="Stage entered">{formatDateTime(deal.current_stage_entered_at)}</Field>
        <Field label="Created">{formatDate(deal.created_at)}</Field>
        <Field label="Purpose">{deal.purpose || '—'}</Field>
        <Field label="Profile">{deal.profile || '—'}</Field>
        <Field label="Estimated value">
          {typeof deal.estimated_value === 'string' ? formatCurrency(deal.estimated_value) : '—'}
        </Field>
        <Field label="Renovation budget">
          {typeof deal.renovation_budget === 'string' ? formatCurrency(deal.renovation_budget) : '—'}
        </Field>
      </dl>
      {deal.description ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[var(--slate)]">
            Description
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-muted)]">
            {deal.description}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function PropertiesPanel({ deal }: { deal: Deal }) {
  const properties = deal.properties;
  return (
    <Panel title="Properties" count={properties.length}>
      {properties.length === 0 ? (
        <p className="text-sm text-[var(--slate)]">No properties linked to this deal.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {properties.map(({ id, property, is_primary }) => {
            const facts = propertyFacts(property);
            return (
              <li key={id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--paper)] text-[var(--brass)]">
                  <MapPin className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-[var(--ink)]">{property.address}</p>
                    {is_primary ? (
                      <Badge className="border-[var(--brass)]/40 bg-[var(--brass)]/12 text-[var(--ink)]">
                        <Star className="h-3 w-3 fill-current" strokeWidth={0} />
                        Primary
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--slate)]">
                    {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
                  </p>
                  {facts.length > 0 ? (
                    <p className="mt-1 text-xs text-[var(--slate)]">{facts.join(' · ')}</p>
                  ) : null}
                </div>
                <span className="max-w-full shrink-0 break-words text-xs text-[var(--slate)]">
                  {PROPERTY_TYPE_LABELS[property.property_type]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function DocumentsPanel({
  dealId,
  documents,
  isLoading,
  isError,
  onUpload,
}: {
  dealId: string;
  documents: DealDocument[];
  isLoading: boolean;
  isError: boolean;
  onUpload: () => void;
}) {
  const download = useDownloadDocument();
  const updateDocument = useUpdateDocumentMetadata(dealId);
  const deleteDocument = useDeleteDocument(dealId);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const grouped = useMemo(() => {
    const map = new Map<DocumentCategory, DealDocument[]>();
    for (const doc of documents) {
      const list = map.get(doc.category) ?? [];
      list.push(doc);
      map.set(doc.category, list);
    }
    return [...map.entries()];
  }, [documents]);

  return (
    <Panel
      title="Documents"
      count={documents.length}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onUpload}>
          <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
          Upload
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-[var(--slate)]">Loading documents…</p>
      ) : isError ? (
        <p className="text-sm text-[var(--slate)]">Documents couldn't be loaded right now.</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-[var(--slate)]">No documents on file for this deal yet.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([category, docs]) => (
            <div key={category}>
              <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[var(--slate)]">
                {DOCUMENT_CATEGORY_LABELS[category]}
              </p>
              <ul className="mt-2 space-y-2">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-[var(--slate)]" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">
                        {doc.document_name}
                        <span className="ml-1.5 text-xs font-normal text-[var(--slate)]">
                          v{doc.version}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--slate)]">
                        {doc.file_type?.toUpperCase() || 'FILE'}
                        {doc.file_size_bytes ? ` · ${formatFileSize(doc.file_size_bytes)}` : ''}
                        {doc.expiry_date ? ` · expires ${formatDate(doc.expiry_date)}` : ''}
                      </p>
                      {!doc.can_delete && doc.delete_block_reason ? (
                        <p className="mt-0.5 text-xs text-[var(--slate)]">
                          {doc.delete_block_reason}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={download.isPending}
                      onClick={() => {
                        setDownloadError(null);
                        download.mutate(doc, {
                          onError: (err) =>
                            setDownloadError(
                              `Couldn't download ${doc.document_name}: ${apiErrorMessage(err)}`,
                            ),
                        });
                      }}
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Download
                    </Button>
                    {doc.can_edit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(editingId === doc.id ? null : doc.id);
                          setSubcategory(doc.subcategory ?? '');
                          setExpiryDate(doc.expiry_date ?? '');
                          setNotes(doc.notes ?? '');
                        }}
                        aria-label={`Edit ${doc.document_name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleteDocument.isPending || !doc.can_delete}
                      title={doc.delete_block_reason || undefined}
                      onClick={() => {
                        if (!window.confirm(`Delete ${doc.document_name}? This cannot be undone.`)) return;
                        setDownloadError(null);
                        deleteDocument.mutate(doc.id, {
                          onError: (error) => setDownloadError(apiErrorMessage(error, 'Could not delete document.')),
                        });
                      }}
                      aria-label={
                        doc.can_delete
                          ? `Delete ${doc.document_name}`
                          : `Cannot delete ${doc.document_name}: ${doc.delete_block_reason}`
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                    {doc.is_executed ? (
                      <Badge className="border-[var(--brass)]/40 bg-[var(--brass)]/12 text-[var(--ink)]">
                        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                        Executed
                      </Badge>
                    ) : null}
                    {editingId === doc.id ? (
                      <div className="grid w-full gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
                        <FormField label="Subcategory" htmlFor={`doc-subcategory-${doc.id}`} hint="Optional">
                          <Input id={`doc-subcategory-${doc.id}`} value={subcategory} onChange={(event) => setSubcategory(event.target.value)} />
                        </FormField>
                        <FormField label="Expiry date" htmlFor={`doc-expiry-${doc.id}`} hint="Optional">
                          <Input id={`doc-expiry-${doc.id}`} type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
                        </FormField>
                        <FormField label="Notes" htmlFor={`doc-notes-${doc.id}`} className="sm:col-span-2">
                          <Textarea id={`doc-notes-${doc.id}`} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
                        </FormField>
                        <div className="flex justify-end gap-2 sm:col-span-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={updateDocument.isPending}
                            onClick={() => updateDocument.mutate(
                              {
                                documentId: doc.id,
                                payload: {
                                  subcategory: subcategory.trim(),
                                  expiry_date: expiryDate || null,
                                  notes: notes.trim(),
                                },
                              },
                              {
                                onSuccess: () => setEditingId(null),
                                onError: (error) => setDownloadError(apiErrorMessage(error, 'Could not update document.')),
                              },
                            )}
                          >
                            {updateDocument.isPending ? 'Saving…' : 'Save metadata'}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {downloadError ? <p className="text-sm text-red-600">{downloadError}</p> : null}
        </div>
      )}
    </Panel>
  );
}

function SponsorPanel({ deal }: { deal: Deal }) {
  const sponsor = deal.sponsor_detail;
  return (
    <Panel title="Sponsor">
      {!sponsor ? (
        <p className="text-sm text-[var(--slate)]">Sponsor details are unavailable.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--paper)] text-[var(--brass)]">
              <Building2 className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-[var(--ink)]">{sponsor.entity_name}</p>
              <p className="text-xs uppercase tracking-wide text-[var(--slate)]">
                {sponsor.entity_type}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--slate)]">Relationship</span>
            <Badge className="border-[var(--border)] bg-[var(--paper)] text-[var(--ink-muted)]">
              {RELATIONSHIP_RATING_LABELS[sponsor.relationship_rating]}
            </Badge>
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-3 text-sm">
            <ContactRow icon={UserRound} value={sponsor.primary_contact_name} />
            <ContactRow icon={Mail} value={sponsor.primary_contact_email} href={`mailto:${sponsor.primary_contact_email}`} />
            {sponsor.primary_contact_phone ? (
              <ContactRow icon={Phone} value={sponsor.primary_contact_phone} />
            ) : null}
            {sponsor.website ? (
              <ContactRow icon={Globe2} value={sponsor.website} href={sponsor.website} />
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
            <Field label="Experience">
              {typeof sponsor.years_experience === 'number' ? `${sponsor.years_experience} years` : '—'}
            </Field>
            <Field label="Completed projects">
              {typeof sponsor.completed_projects === 'number'
                ? sponsor.completed_projects.toLocaleString()
                : '—'}
            </Field>
            <Field label="Bankruptcy history">
              {typeof sponsor.bankruptcy_history === 'boolean'
                ? sponsor.bankruptcy_history
                  ? 'Yes'
                  : 'No'
                : 'Unknown'}
            </Field>
          </dl>
        </div>
      )}
    </Panel>
  );
}

function propertyFacts(property: Deal['properties'][number]['property']): string[] {
  return [
    property.subtype,
    typeof property.units === 'number' ? `${property.units.toLocaleString()} units` : '',
    typeof property.rentable_square_feet === 'number'
      ? `${property.rentable_square_feet.toLocaleString()} rentable sf`
      : '',
    typeof property.year_built === 'number' ? `Built ${property.year_built}` : '',
    typeof property.year_renovated === 'number' ? `Renovated ${property.year_renovated}` : '',
    property.county ? `${property.county} County` : '',
    property.msa,
  ].filter((fact): fact is string => Boolean(fact));
}

function BrokerPanel({ deal }: { deal: Deal }) {
  const broker = deal.broker_detail;
  if (!broker) {
    return (
      <Panel title="Broker">
        <p className="text-sm text-[var(--slate)]">No broker on this deal — sourced directly.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Broker">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--paper)] text-[var(--brass)]">
            <Landmark className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-[var(--ink)]">{broker.company_name}</p>
            <p className="text-sm text-[var(--slate)]">{broker.contact_name}</p>
          </div>
        </div>
        <div className="space-y-2 border-t border-[var(--border)] pt-3 text-sm">
          <ContactRow icon={Mail} value={broker.email} href={`mailto:${broker.email}`} />
          {broker.phone ? <ContactRow icon={Phone} value={broker.phone} /> : null}
        </div>
      </div>
    </Panel>
  );
}

function ContactRow({
  icon: Icon,
  value,
  href,
}: {
  icon: typeof Mail;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[var(--ink-muted)]">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--slate)]" strokeWidth={1.75} />
      {href ? (
        <a href={href} className="truncate underline-offset-4 hover:text-[var(--brass)] hover:underline">
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  );
}

function ActivityPanel({
  entries,
  isLoading,
  isError,
  onRetry,
}: {
  entries: ActivityLogEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <Panel title="Activity">
        <p className="text-sm text-[var(--slate)]">Loading activity…</p>
      </Panel>
    );
  }
  if (isError) {
    return (
      <Panel title="Activity">
        <ErrorState
          title="Activity unavailable"
          message="The audit timeline could not be loaded."
          onRetry={onRetry}
        />
      </Panel>
    );
  }
  if (entries.length === 0) {
    return (
      <Panel title="Activity">
        <EmptyState
          icon={Clock}
          title="No activity yet"
          message="Stage changes and document uploads will show up here."
        />
      </Panel>
    );
  }
  return (
    <Panel title="Activity" count={entries.length}>
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-[var(--border)]">
        {entries.map((entry) => (
          <li key={entry.id} className="relative pl-5">
            <span
              className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-[var(--paper-elevated)] bg-[var(--brass)]"
              aria-hidden
            />
            <p className="text-sm text-[var(--ink)]">{entry.description}</p>
            {entry.reason ? (
              <p className="mt-0.5 text-xs italic text-[var(--slate)]">“{entry.reason}”</p>
            ) : null}
            <p className="mt-1 flex items-center gap-1 text-[0.7rem] text-[var(--slate)]/80">
              <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
              {formatDateTime(entry.performed_at)}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function NotesPanel({
  dealId,
  notes,
  isLoading,
  isError,
  onRetry,
  documents,
}: {
  dealId: string;
  notes: DealNote[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  documents: DealDocument[];
}) {
  const [body, setBody] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const createNote = useCreateNote(dealId);
  const deleteNote = useDeleteNote(dealId);
  const updateNote = useUpdateNote(dealId);
  const download = useDownloadDocument();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

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
              {documents.map((doc) => (
                <li key={doc.id}>
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={selectedDocs.includes(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                    />
                    <span className="truncate">
                      {doc.document_name}
                      <span className="ml-1 text-xs text-[var(--slate)]">v{doc.version}</span>
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
