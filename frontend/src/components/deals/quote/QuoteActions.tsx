import {
  Ban,
  CheckCircle2,
  Clock,
  FilePlus2,
  MessageSquareReply,
  Save,
  Send,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Quote } from '@/types/quote';

const TERMINAL_STATUSES = new Set(['executed', 'expired', 'withdrawn']);

interface QuoteActionsProps {
  quote: Quote | undefined;
  dirty: boolean;
  saving?: boolean;
  busy?: boolean;
  canCreateNextVersion?: boolean;
  onSave: () => void;
  onSend: () => void;
  onCounter: () => void;
  onExecute: () => void;
  onWithdraw: () => void;
  onExpire: () => void;
  onCreateNextVersion?: () => void;
}

export function QuoteActions({
  quote,
  dirty,
  saving = false,
  busy = false,
  canCreateNextVersion = false,
  onSave,
  onSend,
  onCounter,
  onExecute,
  onWithdraw,
  onExpire,
  onCreateNextVersion,
}: QuoteActionsProps) {
  if (!quote || !quote.is_current) {
    return (
      <p className="text-sm text-[var(--slate)]">
        Workflow actions apply only to the current quote version.
      </p>
    );
  }

  const status = quote.status;
  const isTerminal = TERMINAL_STATUSES.has(status);
  const canSave = status === 'draft';
  const canSend = status === 'draft';
  const canCounter = status === 'sent' || status === 'countered';
  const canExecute = status === 'sent' || status === 'countered';
  const canWithdraw = status === 'draft' || status === 'sent' || status === 'countered';
  const canExpire = status === 'sent' || status === 'countered';
  const hasAttachments = quote.attachments.length > 0;
  const executeBlocked = canExecute && !hasAttachments;
  const disabled = busy || saving;
  const showCreateNext = isTerminal && canCreateNextVersion && Boolean(onCreateNextVersion);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canSave ? (
          <Button type="button" disabled={disabled || !dirty} onClick={onSave}>
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}

        {canSend ? (
          <Button type="button" variant="brass" disabled={disabled || dirty} onClick={onSend}>
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
            Send
          </Button>
        ) : null}

        {canCounter ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={onCounter}>
            <MessageSquareReply className="h-3.5 w-3.5" strokeWidth={1.75} />
            Counter
          </Button>
        ) : null}

        {canExecute ? (
          <Button
            type="button"
            variant="brass"
            disabled={disabled || executeBlocked}
            onClick={onExecute}
          >
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Execute
          </Button>
        ) : null}

        {canWithdraw ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={onWithdraw}>
            <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
            Withdraw
          </Button>
        ) : null}

        {canExpire ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={onExpire}>
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            Expire
          </Button>
        ) : null}

        {showCreateNext ? (
          <Button type="button" variant="brass" disabled={disabled} onClick={onCreateNextVersion}>
            <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            New version
          </Button>
        ) : null}
      </div>

      {canSend && dirty ? (
        <p className="text-xs text-[var(--slate)]">Save changes before sending.</p>
      ) : null}
      {executeBlocked ? (
        <p className="text-xs text-[var(--slate)]">
          Attach a ready legal term sheet or LOI before executing.
        </p>
      ) : null}
      {isTerminal ? (
        <p className="text-xs text-[var(--slate)]">
          {showCreateNext
            ? 'This quote is terminal. Start a new version to continue quoting on this deal.'
            : 'This quote is terminal. Move the deal back to Quoting or Negotiating to open a new version.'}
        </p>
      ) : null}
    </div>
  );
}
