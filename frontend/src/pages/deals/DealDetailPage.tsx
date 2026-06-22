import { useContext, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Star,
  UserRound,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, Field } from '@/components/deals/Panel';
import { InvestmentChip, PipelineBadge, SyndicationBadge } from '@/components/deals/StatusBadge';
import { TransitionDialog } from '@/components/deals/TransitionDialog';
import { EmptyState, ErrorState, Spinner } from '@/components/deals/States';
import { useDeal, useDealActivity, useDealDocuments } from '@/lib/api/deals';
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
import type { ActivityLogEntry, Deal, DealDocument, DocumentCategory } from '@/types/deal';

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useContext(AuthContext);
  const isStaff = Boolean(user?.is_staff);

  const dealQuery = useDeal(id);
  const documentsQuery = useDealDocuments(id);
  const activityQuery = useDealActivity(id, isStaff);
  const [openDialog, setOpenDialog] = useState<'pipeline' | 'syndication' | null>(null);

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
          <DocumentsPanel
            documents={documentsQuery.data ?? []}
            isLoading={documentsQuery.isLoading}
            isError={documentsQuery.isError}
          />
        </div>

        <aside className="animate-fade-up stagger-3 space-y-6">
          <SponsorPanel deal={deal} />
          <BrokerPanel deal={deal} />
          {isStaff ? (
            <ActivityPanel
              entries={activityQuery.data ?? []}
              isLoading={activityQuery.isLoading}
            />
          ) : null}
        </aside>
      </div>
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
          <h1 className="font-display mt-3 text-3xl font-medium tracking-tight text-[var(--ink)]">
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
        <Field label="Created">{formatDate(deal.created_at)}</Field>
      </dl>
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
          {properties.map(({ id, property, is_primary }) => (
            <li key={id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
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
              </div>
              <span className="shrink-0 text-xs text-[var(--slate)]">
                {PROPERTY_TYPE_LABELS[property.property_type]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DocumentsPanel({
  documents,
  isLoading,
  isError,
}: {
  documents: DealDocument[];
  isLoading: boolean;
  isError: boolean;
}) {
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
    <Panel title="Documents" count={documents.length}>
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
                    className="flex items-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-2"
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
                        {doc.expiry_date ? ` · expires ${formatDate(doc.expiry_date)}` : ''}
                      </p>
                    </div>
                    {doc.is_executed ? (
                      <Badge className="border-[var(--brass)]/40 bg-[var(--brass)]/12 text-[var(--ink)]">
                        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                        Executed
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
          </div>
        </div>
      )}
    </Panel>
  );
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
}: {
  entries: ActivityLogEntry[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Panel title="Activity">
        <p className="text-sm text-[var(--slate)]">Loading activity…</p>
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
