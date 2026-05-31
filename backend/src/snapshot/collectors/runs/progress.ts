import { type RunLane, type RunStage } from 'gas-city-dashboard-shared';

import {
  reviewRoundForIssues,
  stepIssues,
  type RunIssue,
} from '../phaseMapping.js';

export function runProgress(
  stages: RunStage[],
  activeStageIndex: number,
  activeStepId: string | null,
  issues: RunIssue[],
): RunLane['progress'] {
  const stage = runStagePosition(stages, activeStageIndex);
  if (activeStepId !== null) {
    return {
      status: 'active_step',
      stepId: activeStepId,
      stage,
      attempt: runStepAttempt(issues, activeStepId),
    };
  }

  if (stage.status === 'available') {
    return {
      status: 'stage_only',
      stage,
      error: 'active run step unavailable',
    };
  }

  return { status: 'unavailable', error: 'run progress unavailable' };
}

export function runStagePosition(
  stages: RunStage[],
  activeStageIndex: number,
): Extract<RunLane['progress'], { status: 'active_step' }>['stage'] {
  const stage = stages[activeStageIndex];
  return stage === undefined
    ? { status: 'unavailable', error: 'active run stage unavailable' }
    : {
        status: 'available',
        index: activeStageIndex,
        key: stage.key,
        label: stage.label,
      };
}

export function runStepAttempt(
  issues: RunIssue[],
  stepId: string,
): Extract<RunLane['progress'], { status: 'active_step' }>['attempt'] {
  const value = reviewRoundForIssues(stepIssues(issues, stepId));
  return value === null
    ? { status: 'unavailable', error: 'run step attempt unavailable' }
    : { status: 'available', value };
}
