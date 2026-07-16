import workflowContracts from '@shared/workflow_contracts.json';

import type { PipelineStatus, SyndicationStatus } from '@/types/deal';

export const DOCUMENT_UPLOAD_CONTRACT = workflowContracts.document_upload;

export const DEMO_ACTIVE_PIPELINE_EXCLUDED_STATUSES = workflowContracts.lifecycle
  .active_pipeline_excluded_statuses as PipelineStatus[];

export const DEMO_PIPELINE_TRANSITIONS = workflowContracts.lifecycle
  .pipeline_transitions as Record<PipelineStatus, PipelineStatus[]>;

export const DEMO_SYNDICATION_TRANSITIONS = workflowContracts.lifecycle
  .syndication_transitions as Record<SyndicationStatus, SyndicationStatus[]>;
