import type { PipelineStatus } from '@/types/deal';

export const PIPELINE_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  sourced: ['screening', 'on_hold', 'dead'],
  screening: ['quoting', 'on_hold', 'dead'],
  quoting: ['negotiating', 'on_hold', 'dead'],
  negotiating: ['signed', 'quoting', 'on_hold', 'dead'],
  signed: ['closing', 'quoting', 'on_hold', 'dead'],
  closing: ['closed', 'negotiating', 'quoting', 'on_hold', 'dead'],
  closed: ['servicing'],
  servicing: ['exited'],
  on_hold: [],
  dead: [],
  exited: [],
};
