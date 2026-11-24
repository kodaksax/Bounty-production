/**
 * The five steps of a job, the same for the person who posted it and the
 * person doing it. Both stage mappers (poster-stage-copy.ts and
 * hunter-stage-copy.ts) take their step number and name from here, so the two
 * sides can never show different steps for the same moment.
 */
export type JobStep = 1 | 2 | 3 | 4 | 5;

export const JOB_STEP = { posted: 1, choosing: 2, working: 3, reviewing: 4, finished: 5 } as const;

const STEP_NAMES: Record<JobStep, string> = {
  1: 'Posted',
  2: 'Choosing help',
  3: 'Work underway',
  4: 'Reviewing the work',
  5: 'Finished',
};

/** "Step 3 of 5 · Work underway"; the person doing it sees "Doing the work". */
export function stepLine(step: JobStep, side: 'posted' | 'doing' = 'posted'): string {
  return stepDetail(step, step === JOB_STEP.working && side === 'doing' ? 'Doing the work' : STEP_NAMES[step]);
}

/** A step with something more specific to say: "Step 2 of 5 · Person 1 of 3". */
export function stepDetail(step: JobStep, detail: string): string {
  return `Step ${step} of 5 · ${detail}`;
}
