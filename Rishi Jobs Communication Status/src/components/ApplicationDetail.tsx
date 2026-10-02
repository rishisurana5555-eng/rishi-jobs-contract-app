import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import type { Application, AvailabilityRound, Interview, TimelineEntry } from '../types'
import { fmtDateTime, fmtSlot, timeAgo } from '../workflow/dates'
import {
  awaitingPeAnswer,
  awaitingSend,
  beforeClientTeam,
  ctLabel,
  isClosed,
  isMyTurn,
  isWaiting,
  outcomeLabel,
  pmLabel,
  sideOf,
  toneFor,
  viewerLabel,
  WAIT_WHO,
  waitUntilFor,
} from '../workflow/workflow'
import { InterviewPanel } from './InterviewPanel'
import { displayPhone } from './PhoneInput'
import { CtDoubtPanel } from './CtDoubtPanel'
import { NoteInput } from './NoteInput'
import { BackoutControl, PeAnswerPanel, PmDecisionPanel } from './PmDecisionPanel'
import { StatusChangeControl } from './StatusChangeControl'
import { ToneBadge, useNextActionText } from './StatusBadge'
import { Stepper } from './Stepper'
import { TimelineFeed } from './TimelineFeed'
import { Spinner, cx } from './ui'

function Info({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('min-w-0', wide && 'col-span-full')}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={cx('text-sm text-slate-800', !wide && 'truncate')}>{children}</dd>
    </div>
  )
}

function Section({ title, children, highlight }: { title: string; children: ReactNode; highlight?: boolean }) {
  return (
    <section className={cx('rounded-xl border p-4', highlight ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white')}>
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </section>
  )
}

/** The revised CV; before the PM has revised it (a PE's candidate), the original CV. */
export function CvLink({ app, className, original }: { app: Application; className?: string; original?: boolean }) {
  const url = original ? app.originalCvUrl : app.revisedCvUrl || app.originalCvUrl
  if (!url) return <span className="text-slate-400">—</span>
  const isData = url.startsWith('data:')
  const isOriginal = original || !app.revisedCvUrl
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={isData ? ((isOriginal ? app.originalCvName : app.revisedCvName) ?? 'cv') : undefined}
      onClick={(e) => e.stopPropagation()}
      className={cx('font-medium text-brand-600 underline-offset-2 hover:underline', className)}
    >
      {isOriginal ? 'Original CV' : isData ? 'Download CV' : 'Open CV'}
    </a>
  )
}

/** Right-side panel with everything about one candidate submission. */
export function ApplicationDetail() {
  const { apps, appsLoaded, selectedId, openApp, backend, me, nameOf, names, now, perform, setDeletingCandidate } = useApp()
  const app = apps.find((a) => a.id === selectedId)
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null)
  const [rounds, setRounds] = useState<AvailabilityRound[]>([])
  const [interviews, setInterviews] = useState<Interview[]>([])
  const nextText = useNextActionText()

  useEffect(() => {
    if (!selectedId) return
    setTimeline(null)
    const u = [
      backend.listenTimeline(selectedId, setTimeline),
      backend.listenRounds(selectedId, setRounds),
      backend.listenInterviews(selectedId, setInterviews),
    ]
    return () => u.forEach((f) => f())
  }, [backend, selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openApp(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openApp])

  // Deleted (by someone else, or with its client): nothing left to show.
  const gone = appsLoaded && !!selectedId && !app
  useEffect(() => {
    if (!gone) return
    const t = setTimeout(() => openApp(null), 1500)
    return () => clearTimeout(t)
  }, [gone, openApp])

  if (!selectedId) return null
  const side = app ? sideOf(app, me.id) : null
  const myTurn = !!app && isMyTurn(app, me.id, now)

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/30" onMouseDown={() => openApp(null)}>
      <aside
        className="animate-drawer-in flex h-full w-full max-w-2xl flex-col bg-slate-50 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Candidate details"
      >
        {!app ? (
          gone ? <p className="p-6 text-sm text-slate-500">This candidate has been deleted.</p> : <Spinner />
        ) : (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-slate-900">{app.candidateName}</h2>
                <p className="truncate text-sm text-slate-500">
                  {app.candidateId} · {app.jobTitle} ({app.jobId}) at {app.clientName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setDeletingCandidate({ candidateId: app.candidateId, name: app.candidateName })}
                  className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  title="Delete this candidate everywhere, with all history"
                >
                  🗑 Delete candidate
                </button>
                <button onClick={() => openApp(null)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
                  ✕
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {me.role === 'PE' && app.assignedPE === me.id && (
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your status</div>
                      <ToneBadge tone={toneFor(app, me.id, now)}>{viewerLabel(app, me.id, me.role, now, names)}</ToneBadge>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">PM status{side === 'PM' && ' (you)'}</div>
                    <ToneBadge tone={side === 'PM' ? toneFor(app, me.id, now) : toneFor(app, app.assignedPM, now)}>{pmLabel(app, now, names)}</ToneBadge>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Client Team status{side === 'ClientTeam' && ' (you)'}
                    </div>
                    <ToneBadge tone={side === 'ClientTeam' ? toneFor(app, me.id, now) : toneFor(app, app.assignedClientTeam, now)}>{ctLabel(app, now, names)}</ToneBadge>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
                  <Info label="Next action">
                    <span className={cx(myTurn && 'font-semibold text-red-700')}>{nextText(app)}</span>
                  </Info>
                  <Info label="Last updated">{timeAgo(app.lastUpdatedAt, now)}</Info>
                  <Info label="Last updated by">{app.lastUpdatedBy === me.id ? 'You' : app.lastUpdatedByName}</Info>
                  <Info label="Contact">
                    <a href={`tel:${app.candidateContactNumber.replace(/\s/g, '')}`} className="text-brand-600 hover:underline">
                      {displayPhone(app.candidateContactNumber)}
                    </a>
                  </Info>
                  {app.candidateAltContactNumber && (
                    <Info label="Second contact">
                      <a href={`tel:${app.candidateAltContactNumber.replace(/\s/g, '')}`} className="text-brand-600 hover:underline">
                        {displayPhone(app.candidateAltContactNumber)}
                      </a>
                    </Info>
                  )}
                  <Info label="Revised CV">{app.revisedCvUrl ? <CvLink app={app} /> : <span className="text-slate-400">Not revised yet</span>}</Info>
                  {app.originalCvUrl && (
                    <Info label="Original CV">
                      <CvLink app={app} original />
                    </Info>
                  )}
                  {app.candidateEmail && (
                    <Info label="Email">
                      <a href={`mailto:${app.candidateEmail}`} className="text-brand-600 hover:underline">
                        {app.candidateEmail}
                      </a>
                    </Info>
                  )}
                  {app.currentSalary && <Info label="Current salary">{app.currentSalary} LPA</Info>}
                  {app.expectedSalary && <Info label="Expected salary">{app.expectedSalary} LPA</Info>}
                  {app.noticePeriod && <Info label="Notice period">{app.noticePeriod}</Info>}
                  <Info label="Client">
                    {app.clientName} <span className="text-slate-400">({app.clientId})</span>
                  </Info>
                  <Info label="PM">{nameOf(app.assignedPM)}</Info>
                  <Info label="Client Team">{nameOf(app.assignedClientTeam)}</Info>
                  <Info label="PE">{nameOf(app.assignedPE)}</Info>
                  {app.scheduledInterviewAt && <Info label="Interview">{fmtDateTime(app.scheduledInterviewAt)}</Info>}
                  {/* Older records only; available dates are now written in the messages (see the timeline). */}
                  {app.latestCandidateDates.length > 0 && <Info label="Candidate dates" wide>{app.latestCandidateDates.map(fmtSlot).join(', ')}</Info>}
                  {app.availabilityNote && (
                    <Info label="Candidate availability (note from PE)" wide>
                      <span className="whitespace-pre-wrap">{app.availabilityNote}</span>
                    </Info>
                  )}
                  {app.recruiterNote && (
                    <Info label="Recruiter note" wide>
                      <span className="whitespace-pre-wrap">{app.recruiterNote}</span>
                    </Info>
                  )}
                </dl>
                <div className="border-t border-slate-100 pt-4">
                  <Stepper app={app} rounds={rounds} />
                </div>
              </section>

              {isClosed(app.stage) && (
                <section
                  className={cx(
                    'rounded-xl border p-4 text-sm',
                    app.stage === 'closed_placed' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-100 text-slate-700',
                  )}
                >
                  <b>{app.stage === 'closed_placed' ? '🎉 ' : ''}{outcomeLabel(app)}</b> — {timeAgo(app.stageSince, now)} by{' '}
                  {app.lastUpdatedBy === me.id ? 'you' : app.lastUpdatedByName}. Messages can still be added.
                  {app.stage === 'closed_backout' && app.backoutReason && (
                    <div className="mt-1 whitespace-pre-wrap">
                      <span className="font-semibold">Reason:</span> {app.backoutReason}
                    </div>
                  )}
                </section>
              )}

              {!isClosed(app.stage) &&
                (['PM', 'ClientTeam'] as const).map((s) => {
                  const until = waitUntilFor(app, s)
                  if (!until) return null
                  const who = WAIT_WHO[s].toLowerCase()
                  const owner = s === side ? 'your' : `${nameOf(s === 'PM' ? app.assignedPM : app.assignedClientTeam)}’s`
                  return isWaiting(app, s, now) ? (
                    <section key={s} className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                      ⏸ The {who} asked to wait till <b>{fmtDateTime(until)}</b> — {owner} reminders are paused until then.
                    </section>
                  ) : (
                    <section key={s} className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                      ⏰ The waiting time the {who} asked for ended at <b>{fmtDateTime(until)}</b> — follow up with the {who} and update the status.
                    </section>
                  )
                })}

              {awaitingPeAnswer(app, me.id) && (
                <Section title={`⚠ ${nameOf(app.assignedPM)} raised a doubt – please answer`} highlight>
                  <PeAnswerPanel app={app} />
                </Section>
              )}

              {side === 'PM' && app.stage === 'pe_query' && (
                <Section title="Waiting for the PE">
                  <p className="text-sm text-slate-600">
                    You raised a doubt with {nameOf(app.assignedPE)}. The candidate comes back to you when they answer.
                  </p>
                </Section>
              )}

              {/* A doubt from the Client Team: first thing the PM sees while it is open. */}
              {(app.ctDoubt || app.lastCtDoubt || (side === 'ClientTeam' && !isClosed(app.stage) && !beforeClientTeam(app.stage))) && (
                <Section
                  title={
                    side === 'PM' && app.ctDoubt && !isClosed(app.stage)
                      ? `⚠ ${app.ctDoubt.byName} raised a doubt – please answer`
                      : side === 'ClientTeam'
                        ? `Doubt for ${nameOf(app.assignedPM)}`
                        : 'Doubt from the Client Team'
                  }
                  highlight={side === 'PM' && !!app.ctDoubt && !isClosed(app.stage)}
                >
                  <CtDoubtPanel app={app} side={side} />
                </Section>
              )}

              {awaitingSend(app, me.id) ? (
                <Section title="⚠ Your action is required" highlight>
                  <PmDecisionPanel app={app} />
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <NoteInput appId={app.id} />
                  </div>
                </Section>
              ) : (
                side &&
                !isClosed(app.stage) &&
                !beforeClientTeam(app.stage) && (
                  <Section title={myTurn ? '⚠ Your action is required' : 'Update status'} highlight={myTurn}>
                    <StatusChangeControl app={app} />
                  </Section>
                )
              )}

              {!isClosed(app.stage) && (side === 'PM' || (me.role === 'PE' && app.assignedPE === me.id)) && (
                <Section title="Candidate backout">
                  <BackoutControl app={app} />
                </Section>
              )}

              {side && isClosed(app.stage) && (
                <Section title="Add a message">
                  <NoteInput appId={app.id} />
                </Section>
              )}

              <Section title="Availability & interviews">
                <InterviewPanel
                  rounds={rounds}
                  interviews={interviews}
                  now={now}
                  side={side}
                  onSaveDebrief={(interviewId, debrief) => perform(app.id, { kind: 'save_debrief', interviewId, debrief })}
                />
              </Section>

              <Section title="Timeline / history">{timeline ? <TimelineFeed entries={timeline} /> : <Spinner />}</Section>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
