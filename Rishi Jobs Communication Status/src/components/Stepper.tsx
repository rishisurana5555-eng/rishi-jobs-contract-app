import type { Application, AvailabilityRound } from '../types'
import { isClosed, outcomeLabel, stepIndex, stepsDone, STEPS } from '../workflow/workflow'
import { cx } from './ui'

/** CV to Client Team → CV to client → Interview → Debrief → Outcome, with round and reschedule markers. */
export function Stepper({ app, rounds }: { app: Application; rounds: AvailabilityRound[] }) {
  const closed = isClosed(app.stage)
  // Closed: only the steps it really went through are ticked (a candidate rejected by the PM never reached the Client Team).
  const current = closed ? stepsDone(app) : stepIndex(app.stage)
  const loops = rounds.filter((r) => r.interviewRound === app.currentInterviewRound && r.attemptNumber > 1).length
  return (
    <div>
      <ol className="flex items-start">
        {STEPS.map((label, i) => {
          const isOutcome = i === 4 && closed
          const isDone = i < current || isOutcome
          const isNow = i === current && !closed
          const name = isOutcome ? outcomeLabel(app).replace(/^Candidate /, '').replace(/^./, (c) => c.toUpperCase()) : i === 4 ? 'Placed / Rejected' : label
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && (
                <span className={cx('absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2', i <= current ? 'bg-brand-700' : 'bg-slate-200')} />
              )}
              <span
                className={cx(
                  'relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  i === 4 && app.stage === 'closed_placed' && 'bg-emerald-600 text-white',
                  isOutcome && app.stage !== 'closed_placed' && 'bg-slate-500 text-white',
                  !isOutcome && isDone && 'bg-brand-700 text-white',
                  isNow && 'bg-white text-brand-800 ring-2 ring-brand-700',
                  !isDone && !isNow && 'bg-slate-200 text-slate-500',
                )}
              >
                {isOutcome && app.stage !== 'closed_placed' ? '✕' : isDone ? '✓' : i + 1}
              </span>
              <span className={cx('mt-1 px-0.5 text-[11px] leading-tight', isNow ? 'font-semibold text-brand-800' : 'text-slate-500')}>{name}</span>
              {i === 2 && loops > 0 && (
                <span className="mt-0.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title="Date mismatches / reschedules this round">
                  ↻ {loops}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {app.currentInterviewRound > 1 && (
        <p className="mt-2 text-center text-xs font-medium text-brand-700">Interview round {app.currentInterviewRound}</p>
      )}
    </div>
  )
}
