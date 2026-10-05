import { useApp } from '../context/AppContext'
import type { Application } from '../types'
import { duration, timeAgo } from '../workflow/dates'
import { awaitingSend, ctLabel, isMyTurn, pmLabel, toneFor } from '../workflow/workflow'
import { StatusBadge, TONE_STYLES, ToneBadge, useNextActionText } from './StatusBadge'
import { displayPhone } from './PhoneInput'
import { Button, Empty, cx } from './ui'

export type TableVariant = 'pm' | 'ct' | 'admin' | 'pe'

function UnreadDot({ show }: { show: boolean }) {
  return show ? <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" title="Unread update" /> : null
}

/** PM: the button at the end of a row for a candidate added by a PE — opens it to send, ask the PE, or reject. */
function SendButton({ app, className }: { app: Application; className?: string }) {
  const { openApp } = useApp()
  return (
    <Button
      className={cx('whitespace-nowrap px-2.5 py-1.5 text-xs', className)}
      onClick={(e) => {
        e.stopPropagation()
        openApp(app.id)
      }}
    >
      Send / Reject / Doubt →
    </Button>
  )
}

/** PM: what happened to a PE's candidate that no longer waits for the PM's decision. */
function sentText(a: Application) {
  if (a.stage === 'pe_query') return <span className="whitespace-nowrap text-xs font-medium text-amber-700">{a.peUnanswered ? 'Unanswered – with PE…' : 'Doubt with PE…'}</span>
  if (a.stage === 'closed_backout') return <span className="whitespace-nowrap text-xs font-medium text-slate-500">Candidate backout</span>
  if (!a.assignedClientTeam) return <span className="whitespace-nowrap text-xs font-medium text-slate-500">Rejected by PM</span>
  return <span className="whitespace-nowrap text-xs font-medium text-emerald-700">Sent to Client Team ✓</span>
}

/** A–Z by candidate name (then client and job). */
export const byCandidate = (a: Application, b: Application) =>
  a.candidateName.localeCompare(b.candidateName) || a.clientName.localeCompare(b.clientName) || a.jobTitle.localeCompare(b.jobTitle)
/** A–Z by client, then job opening, then candidate name (the Client Team's tables start with the client). */
export const byClientJobName = (a: Application, b: Application) =>
  a.clientName.localeCompare(b.clientName) || a.jobTitle.localeCompare(b.jobTitle) || a.candidateName.localeCompare(b.candidateName)

/** Every list of candidates is shown alphabetically: by the table's first column. */
export function ApplicationTable({ apps: unsorted, variant, empty = 'Nothing here.' }: { apps: Application[]; variant: TableVariant; empty?: string }) {
  const { me, openApp, nameOf, names, now } = useApp()
  const nextText = useNextActionText()
  if (!unsorted.length) return <Empty>{empty}</Empty>
  const apps = [...unsorted].sort(variant === 'ct' ? byClientJobName : byCandidate)

  const admin = variant === 'admin'
  const pe = variant === 'pe'
  // The Client Team: client (with the job title) first, then the candidate, status, round, PM; no contact or CV.
  const ct = variant === 'ct'
  // PMs always get an "Action" column at the end: the Send button while a PE's candidate waits, otherwise "Sent".
  const actionCol = variant === 'pm'
  const heads = ct
    ? ['Client / Job', 'Candidate', 'Status', 'Round', 'PM', 'Next action', 'Last updated']
    : admin
    ? ['Candidate', 'Client / Job', 'PE', 'Client Team', 'PM status', 'Client Team status', 'Next action', 'In this status', 'Last updated']
    : [
        'Candidate',
        'Contact',
        // No CV column (it opens from the candidate's details); the client shows its job title.
        // A PE always works under the same PM: no PM column.
        'Client / Job',
        ...(variant === 'pm' ? ['PE'] : []),
        ...(pe ? ['Client Team'] : []),
        'Round',
        'Status',
        'Next action',
        'Last updated',
        ...(actionCol ? ['Action'] : []),
      ]

  return (
    <>
      {/* desktop */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {heads.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {apps.map((a) => {
              const tone = toneFor(a, me.id)
              const unread = a.unreadFor.includes(me.id)
              return (
                <tr
                  key={a.id}
                  onClick={() => openApp(a.id)}
                  className={cx('cursor-pointer border-l-4 align-top hover:bg-brand-50/50', TONE_STYLES[tone].row, unread && 'bg-red-50/30')}
                >
                  {ct && (
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">{a.clientName}</div>
                      <div className="text-xs text-slate-500">{a.jobTitle}</div>
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <UnreadDot show={unread} />
                      <span className={cx('font-medium text-slate-900', unread && 'font-bold')}>{a.candidateName}</span>
                    </div>
                    <div className="text-xs text-slate-400">{a.candidateId}</div>
                  </td>
                  {ct ? (
                    <>
                      <td className="max-w-60 px-3 py-2.5">
                        <StatusBadge app={a} />
                      </td>
                      <td className="px-3 py-2.5 text-center">{a.currentInterviewRound}</td>
                      <td className="px-3 py-2.5">{nameOf(a.assignedPM)}</td>
                      <td className={cx('px-3 py-2.5', isMyTurn(a, me.id, now) && 'font-semibold text-red-700')}>{nextText(a)}</td>
                    </>
                  ) : admin ? (
                    <>
                      <td className="px-3 py-2.5">
                        <div>{a.clientName}</div>
                        <div className="text-xs text-slate-400">{a.jobTitle}</div>
                      </td>
                      <td className="px-3 py-2.5">{nameOf(a.assignedPE)}</td>
                      <td className="px-3 py-2.5">{nameOf(a.assignedClientTeam)}</td>
                      <td className="max-w-52 px-3 py-2.5">
                        <ToneBadge tone={toneFor(a, a.assignedPM)}>{pmLabel(a, undefined, names)}</ToneBadge>
                      </td>
                      <td className="max-w-52 px-3 py-2.5">
                        <ToneBadge tone={toneFor(a, a.assignedClientTeam)}>{ctLabel(a, undefined, names)}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5">{nextText(a)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium">{duration(now - a.stageSince)}</td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{displayPhone(a.candidateContactNumber)}</td>
                      <td className="px-3 py-2.5">
                        <div>{a.clientName}</div>
                        <div className="text-xs text-slate-400">{a.jobTitle}</div>
                      </td>
                      {variant === 'pm' && <td className="px-3 py-2.5">{nameOf(a.assignedPE)}</td>}
                      {pe && <td className="px-3 py-2.5">{nameOf(a.assignedClientTeam)}</td>}
                      <td className="px-3 py-2.5 text-center">{a.currentInterviewRound}</td>
                      <td className="max-w-60 px-3 py-2.5">
                        <StatusBadge app={a} />
                      </td>
                      <td className={cx('px-3 py-2.5', isMyTurn(a, me.id, now) && 'font-semibold text-red-700')}>{nextText(a)}</td>
                    </>
                  )}
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                    <div>{timeAgo(a.lastUpdatedAt, now)}</div>
                    <div className="text-slate-400">by {a.lastUpdatedBy === me.id ? 'you' : a.lastUpdatedByName}</div>
                  </td>
                  {actionCol && (
                    <td className="px-3 py-2.5">
                      {awaitingSend(a, me.id) ? <SendButton app={a} /> : sentText(a)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* mobile */}
      <ul className="space-y-2 md:hidden">
        {apps.map((a) => {
          const unread = a.unreadFor.includes(me.id)
          return (
            <li
              key={a.id}
              onClick={() => openApp(a.id)}
              className={cx('cursor-pointer rounded-xl border border-l-4 border-slate-200 bg-white p-3 shadow-sm', TONE_STYLES[toneFor(a, me.id)].row)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <UnreadDot show={unread} />
                    <span className="truncate font-semibold">{a.candidateName}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {a.candidateId} · {a.clientName} · {a.jobTitle}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.lastUpdatedAt, now)}</span>
              </div>
              <div className="mt-2">
                {admin ? (
                  <div className="flex flex-col items-start gap-1">
                    <ToneBadge tone={toneFor(a, a.assignedPM)}>PM: {pmLabel(a, undefined, names)}</ToneBadge>
                    <ToneBadge tone={toneFor(a, a.assignedClientTeam)}>CT: {ctLabel(a, undefined, names)}</ToneBadge>
                  </div>
                ) : (
                  <StatusBadge app={a} />
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>
                  Next: <b className={cx(isMyTurn(a, me.id, now) && 'text-red-700')}>{nextText(a)}</b>
                </span>
                {a.currentInterviewRound > 1 && <span>Round {a.currentInterviewRound}</span>}
                {!admin && !ct && <span>{displayPhone(a.candidateContactNumber)}</span>}
              </div>
              {variant === 'pm' && awaitingSend(a, me.id) && <SendButton app={a} className="mt-2 w-full" />}
            </li>
          )
        })}
      </ul>
    </>
  )
}
