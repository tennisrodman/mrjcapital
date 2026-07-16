import type { PipelineStatus } from '@/types/deal';
import { DEMO_PIPELINE_TRANSITIONS } from './workflowContracts';

export const PIPELINE_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> =
  DEMO_PIPELINE_TRANSITIONS;
