import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Empty, Field, Input, Select, Spinner, Spin, cx } from '../components/ui'
import { BarChart, ColumnChart, FunnelChart, SERIES_COLORS } from '../components/Charts'
import { useApp } from '../context/AppContext'
import {
  addedItems,
  clientReport,
  defaultUnit,
  PERIOD_LABELS,
  periodRange,
  pipeline,
  teamReport,
  toCsv,
  trend,
  UNIT_LABELS,
  type PeriodKey,
  type ReportData,
  type Unit,
} from '../reports/metrics'
import type { AppUser, TimelineEntry } from '../types'
import { fmtDateTime } from '../workflow/dates'

type HistoryRow = TimelineEntry & { appId: string }

/** Every submission's history, loaded the first time a report needs it and kept while the app is open (Refresh reloads it). */
let timelineCache: { entries: HistoryRow[]; at: number } | null = null

function useAllTimeline() {
  const { backend } = useApp()
  const [entries, setEntries] = useState<HistoryRow[] | null>(timelineCache?.entries ?? null)
  const [loadedAt, setLoadedAt] = useState<number | null>(timelineCache?.at ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    backend
      .loadAllTimeline()
      .then((list) => {
        timelineCache = { entries: list, at: Date.now() }
        setEntries(list)
        setLoadedAt(timelineCache.at)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [backend])
  /** Loads it unless it is already here (or on its way). */
  const ensure = useCallback(() => {
    if (!timelineCache && !loading) load()
  }, [load, loading])
  return { entries, loadedAt, loading, error, refresh: load, ensure }
}

type ReportKey = 'team' | 'trend' | 'pipeline' | 'added' | 'clients'

const REPORTS: [ReportKey, string, string][] = [
  ['team', 'Work done by the team', 'PEs, PMs and Client Team: candidates added, sent, interviews, placed…'],
  ['trend', 'New candidates & placements chart', 'By day, week or month'],
  ['pipeline', 'Pipeline', 'How far the period’s submissions got'],
  ['added', 'Clients & job openings added', 'What was added, by whom and when'],
  ['clients', 'Client-wise summary', 'Submissions, interviews, placed and rejected per client'],
]

type TeamRole = 'all' | 'PE' | 'PM' | 'ClientTeam'
const TEAM_ROLES: [TeamRole, string][] = [
  ['all', 'Everyone'],
  ['PE', 'PEs only'],
  ['PM', 'PMs only'],
  ['ClientTeam', 'Client Team only'],
]

interface Settings {
  reports: ReportKey[]
  periodKey: PeriodKey
  custom: { from: string; to: string }
  clientId: string
  role: TeamRole
  person: string
  unit: Unit
}

const roleShort = (u: AppUser) => (u.role === 'ClientTeam' ? 'Client Team' : u.role)

/**
 * Admin / Super Admin: pick the reports and filters, then Generate. Nothing is worked out (and the
 * work history is not loaded) until then, so the page stays quick however many records there are.
 */
export function ReportsPage() {
  const { apps, appsLoaded, users, clients, jobs, candidates } = useApp()
  const history = useAllTimeline()
  const [draft, setDraft] = useState<Settings>({
    reports: [],
    periodKey: 'this_month',
    custom: { from: '', to: '' },
    clientId: '',
    role: 'all',
    person: '',
    unit: 'day',
  })
  const [shown, setShown] = useState<(Settings & { at: number }) | null>(null)
  // How the reports are shown; changes straight away, without generating again.
  const [view, setView] = useState<View>('both')
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }))

  const pickPeriod = (periodKey: PeriodKey) =>
    set({ periodKey, ...(periodKey !== 'custom' ? { unit: defaultUnit(periodRange(periodKey, Date.now()), Date.now()) } : {}) })
  const pickCustom = (custom: Settings['custom']) => set({ custom, unit: defaultUnit(periodRange('custom', Date.now(), custom), Date.now()) })
  const has = (k: ReportKey) => draft.reports.includes(k)
  const toggle = (k: ReportKey) => set({ reports: has(k) ? draft.reports.filter((x) => x !== k) : [...draft.reports, k] })

  const generate = () => {
    // The PE table doesn't need the work history; PMs and the Client Team do.
    const onlyPes = draft.role === 'PE' || users.find((u) => u.id === draft.person)?.role === 'PE'
    if (has('team') && !onlyPes) history.ensure()
    setShown({ ...draft, at: Date.now() })
  }
  const changed = !!shown && JSON.stringify({ ...shown, at: 0 }) !== JSON.stringify({ ...draft, at: 0 })

  const people = users
    .filter((u) => (draft.role === 'all' ? u.role === 'PE' || u.role === 'PM' || u.role === 'ClientTeam' : u.role === draft.role))
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))

  if (!appsLoaded) return <Spinner />
  const customBad = draft.periodKey === 'custom' && !!draft.custom.from && !!draft.custom.to && draft.custom.from > draft.custom.to

  return (
    <div className="space-y-5">
      <Card title="Choose reports and filters">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</span>
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:underline"
                onClick={() => set({ reports: draft.reports.length === REPORTS.length ? [] : REPORTS.map((r) => r[0]) })}
              >
                {draft.reports.length === REPORTS.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {REPORTS.map(([k, label, hint]) => (
                <label
                  key={k}
                  className={cx(
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors',
                    has(k) ? 'border-brand-700 bg-brand-50' : 'border-slate-200 hover:border-brand-200',
                  )}
                >
                  <input type="checkbox" checked={has(k)} onChange={() => toggle(k)} className="mt-0.5 accent-brand-800" />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{label}</span>
                    <span className="block text-xs text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Period">
              <Select value={draft.periodKey} onChange={(e) => pickPeriod(e.target.value as PeriodKey)}>
                {Object.entries(PERIOD_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.periodKey === 'custom' && (
              <Field label="From – to" group>
                <div className="flex items-center gap-1.5">
                  <Input type="date" value={draft.custom.from} max={draft.custom.to || undefined} onChange={(e) => pickCustom({ ...draft.custom, from: e.target.value })} aria-label="From" />
                  <Input type="date" value={draft.custom.to} min={draft.custom.from || undefined} onChange={(e) => pickCustom({ ...draft.custom, to: e.target.value })} aria-label="To" />
                </div>
              </Field>
            )}
            <Field label="Client">
              <Select value={draft.clientId} onChange={(e) => set({ clientId: e.target.value })}>
                <option value="">All clients</option>
                {[...clients]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {has('team') && (
              <>
                <Field label="Team">
                  <Select value={draft.role} onChange={(e) => set({ role: e.target.value as TeamRole, person: '' })}>
                    {TEAM_ROLES.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Person">
                  <Select value={draft.person} onChange={(e) => set({ person: e.target.value })}>
                    <option value="">Everyone</option>
                    {people.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {draft.role === 'all' ? ` — ${roleShort(u)}` : ''}
                        {u.active ? '' : ' (inactive)'}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Field label="Show as">
              <Select value={view} onChange={(e) => setView(e.target.value as View)}>
                <option value="both">Graphs and tables</option>
                <option value="graphs">Graphs only</option>
                <option value="tables">Tables only</option>
              </Select>
            </Field>
            {has('trend') && (
              <Field label="Chart by">
                <Select value={draft.unit} onChange={(e) => set({ unit: e.target.value as Unit })}>
                  {Object.entries(UNIT_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {customBad && <span className="text-sm text-red-700">The “from” date is after the “to” date.</span>}
            {!draft.reports.length && <span className="text-sm text-slate-500">Tick at least one report.</span>}
            {changed && <span className="text-sm text-amber-700">Filters changed — press Generate report to update.</span>}
            <Button onClick={generate} disabled={!draft.reports.length || customBad}>
              {shown ? 'Generate report again' : 'Generate report'}
            </Button>
          </div>
        </div>
      </Card>

      {shown ? (
        <Results settings={shown} view={view} history={history} data={{ apps, candidates, clients, jobs, users }} />
      ) : (
        <Empty>Choose the reports and filters above, then press Generate report.</Empty>
      )}
    </div>
  )
}

function Results({
  settings: s,
  view,
  history,
  data,
}: {
  settings: Settings & { at: number }
  view: View
  history: ReturnType<typeof useAllTimeline>
  data: Omit<ReportData, 'timeline'>
}) {
  const r = useMemo(() => {
    const p = periodRange(s.periodKey, s.at, s.custom)
    // A client filter narrows everything down to that client's submissions (and their history).
    let d: ReportData = { ...data, timeline: history.entries }
    if (s.clientId) {
      const apps = data.apps.filter((a) => a.clientId === s.clientId)
      const appIds = new Set(apps.map((a) => a.id))
      const candidateIds = new Set(apps.map((a) => a.candidateId))
      d = {
        ...d,
        apps,
        candidates: data.candidates.filter((c) => candidateIds.has(c.id)),
        clients: data.clients.filter((c) => c.id === s.clientId),
        jobs: data.jobs.filter((j) => j.clientId === s.clientId),
        timeline: history.entries && history.entries.filter((e) => appIds.has(e.appId)),
      }
    }
    const want = (k: ReportKey) => s.reports.includes(k)
    const onlyPerson = <R extends { id: string }>(rows: R[]) => (s.person ? rows.filter((x) => x.id === s.person) : rows)
    const team = want('team') ? teamReport(d, p) : null
    return {
      steps: want('pipeline') ? pipeline(d.apps, p) : null,
      points: want('trend') ? trend(d, p, s.unit, s.at) : null,
      team: team && { pes: onlyPerson(team.pes), pms: team.pms && onlyPerson(team.pms), cts: team.cts && onlyPerson(team.cts) },
      added: want('added') ? addedItems(d, p) : null,
      clientRows: want('clients') ? clientReport(d.apps, d.clients, p) : null,
    }
  }, [s, data, history.entries])

  const period = s.periodKey === 'custom' ? `${s.custom.from || 'start'} to ${s.custom.to || 'today'}` : PERIOD_LABELS[s.periodKey]
  const clientName = s.clientId ? (data.clients.find((c) => c.id === s.clientId)?.name ?? '') : ''
  const file = (name: string) => `${name}-${[period, clientName].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
  // With one person picked, only their role's table is shown.
  const personRole = s.person ? data.users.find((u) => u.id === s.person)?.role : undefined
  const showRole = (role: TeamRole) => (personRole ? personRole === role : s.role === 'all' || s.role === role)
  const historyNote = history.error ? (
    <p className="text-sm text-red-700">Couldn’t load the work history ({history.error}).</p>
  ) : (
    <Spinner label="Loading work history…" />
  )

  const C = SERIES_COLORS
  const byAdder = r.added && [...new Set(r.added.map((x) => x.addedBy))].map((by) => ({
    label: by,
    values: [r.added!.filter((x) => x.addedBy === by && x.kind === 'Client').length, r.added!.filter((x) => x.addedBy === by && x.kind === 'Job opening').length],
  }))

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Showing <b>{period}</b>
        {clientName && (
          <>
            {' '}
            for <b>{clientName}</b>
          </>
        )}
        <span className="text-slate-400"> · generated {fmtDateTime(s.at)}</span>
      </p>

      {r.team && (
        <Card
          title="Work done by the team"
          actions={
            <div className="flex items-center gap-2">
              {history.loadedAt && <span className="text-xs text-slate-400">History as of {fmtDateTime(history.loadedAt)}</span>}
              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={history.refresh} disabled={history.loading}>
                {history.loading ? <Spin /> : '↻'} Refresh
              </Button>
            </div>
          }
        >
          <div className="space-y-8">
            {showRole('PE') && (
              <Block
                title="PEs"
                view={view}
                chart={
                  <BarChart
                    series={[{ name: 'New candidates', color: C.volume }, { name: 'Placed', color: C.placed }]}
                    rows={r.team.pes.map((x) => ({ label: x.name, values: [x.newCandidates, x.placed] }))}
                  />
                }
                table={
                  <ReportTable
                    file={file('pe-work')}
                    header={['PE', 'New candidates', 'Submissions', 'Placed']}
                    rows={r.team.pes.map((x) => [x.name, x.newCandidates, x.submissions, x.placed])}
                  />
                }
              />
            )}
            {(showRole('PM') || showRole('ClientTeam')) && !r.team.pms && historyNote}
            {showRole('PM') && r.team.pms && (
              <Block
                title="PMs"
                view={view}
                chart={
                  <BarChart
                    series={[{ name: 'Sent to Client Team', color: C.volume }, { name: 'Placed', color: C.placed }]}
                    rows={r.team.pms.map((x) => ({ label: x.name, values: [x.sentToClientTeam, x.placed] }))}
                  />
                }
                table={
                  <ReportTable
                    file={file('pm-work')}
                    header={['PM', 'Sent to Client Team', 'Candidate dates', 'Debriefs', 'Notes', 'Pending now', 'Placed']}
                    rows={r.team.pms.map((x) => [x.name, x.sentToClientTeam, x.candidateDates, x.debriefs, x.notes, x.pending, x.placed])}
                  />
                }
              />
            )}
            {showRole('ClientTeam') && r.team.cts && (
              <Block
                title="Client Team"
                view={view}
                chart={
                  <BarChart
                    series={[
                      { name: 'CVs to client', color: C.volume },
                      { name: 'Interviews scheduled', color: C.interviews },
                      { name: 'Placed', color: C.placed },
                    ]}
                    rows={r.team.cts.map((x) => ({ label: x.name, values: [x.cvsToClient, x.interviewsScheduled, x.placed] }))}
                  />
                }
                table={
                  <ReportTable
                    file={file('client-team-work')}
                    header={['Member', 'CVs to client', 'Interviews scheduled', 'Reschedules', 'Placed', 'Rejected', 'Notes']}
                    rows={r.team.cts.map((x) => [x.name, x.cvsToClient, x.interviewsScheduled, x.reschedules, x.placed, x.rejected, x.notes])}
                  />
                }
              />
            )}
          </div>
        </Card>
      )}

      {r.points && (
        <Card title={`New candidates and placements by ${UNIT_LABELS[s.unit].toLowerCase()}`}>
          <Block
            view={view}
            chart={
              <ColumnChart
                series={[{ name: 'New candidates', color: C.volume }, { name: 'Placed', color: C.placed }]}
                points={r.points.map((x) => ({ label: x.label, values: [x.newCandidates, x.placed] }))}
              />
            }
            table={
              <ReportTable
                file={file(`by-${s.unit}`)}
                header={[UNIT_LABELS[s.unit], 'New candidates', 'Placed']}
                rows={r.points.map((x) => [x.label, x.newCandidates, x.placed])}
                empty="Nothing to show for this period."
              />
            }
          />
        </Card>
      )}

      {r.steps && (
        <Card title="Pipeline — how far this period’s submissions got">
          <Block
            view={view}
            chart={<FunnelChart steps={r.steps} />}
            table={
              <ReportTable
                file={file('pipeline')}
                header={['Step', 'Submissions', '% of added']}
                rows={r.steps[0].count ? r.steps.map((x) => [x.label, x.count, `${x.pct}%`]) : []}
                empty="No submissions added in this period."
              />
            }
          />
        </Card>
      )}

      {r.clientRows && (
        <Card title="Client-wise summary">
          <Block
            view={view}
            chart={
              <BarChart
                series={[
                  { name: 'Submissions', color: C.volume },
                  { name: 'Interviews', color: C.interviews },
                  { name: 'Placed', color: C.placed },
                  { name: 'Rejected', color: C.rejected },
                ]}
                rows={r.clientRows.map((x) => ({ label: x.name, values: [x.submissions, x.interviews, x.placed, x.rejected] }))}
              />
            }
            table={
              <ReportTable
                file={file('client-report')}
                header={['Client', 'Submissions', 'Interviews', 'Placed', 'Rejected']}
                rows={r.clientRows.map((x) => [x.name, x.submissions, x.interviews, x.placed, x.rejected])}
                empty="No client activity in this period."
              />
            }
          />
        </Card>
      )}

      {r.added && byAdder && (
        <Card title="Clients and job openings added">
          <Block
            view={view}
            chart={
              <BarChart
                series={[{ name: 'Clients added', color: C.volume }, { name: 'Job openings added', color: C.jobs }]}
                rows={byAdder}
              />
            }
            table={
              <ReportTable
                file={file('clients-jobs-added')}
                header={['Added', 'Name', 'Client', 'Added by', 'When']}
                rows={r.added.map((x) => [x.kind, x.name, x.client || '—', x.addedBy, fmtDateTime(x.at)])}
                numeric={false}
                empty="No clients or job openings added in this period."
              />
            }
          />
        </Card>
      )}

      <p className="text-xs text-slate-400">
        New candidates, clients and job openings count those added in the period; work done counts the actions in the period; placed and rejected count
        submissions closed in the period. Deleted candidates and clients are not counted. Hover over a bar to see all its numbers.
      </p>
    </div>
  )
}

type View = 'both' | 'graphs' | 'tables'

/** A report's graph and / or table (side by side on wide screens when both). */
function Block({ title, view, chart, table }: { title?: string; view: View; chart: ReactNode; table: ReactNode }) {
  return (
    <div>
      {title && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>}
      <div className={cx('grid gap-6', view === 'both' && 'lg:grid-cols-2')}>
        {view !== 'tables' && <div className="min-w-0">{chart}</div>}
        {view !== 'graphs' && <div className="min-w-0">{table}</div>}
      </div>
    </div>
  )
}

/**
 * A small table with a "Download CSV" button. The first column is the name; the rest are numbers
 * (right-aligned) unless `numeric` is false.
 */
function ReportTable({
  title,
  file,
  header,
  rows,
  numeric = true,
  empty = 'No one to show.',
}: {
  title?: string
  file: string
  header: string[]
  rows: (string | number)[][]
  numeric?: boolean
  empty?: string
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    URL.revokeObjectURL(url)
  }
  const align = (i: number) => (i === 0 ? 'pr-3' : numeric ? 'pl-3 text-right tabular-nums' : 'px-3')
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>}
        <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={download} disabled={!rows.length}>
          ⬇ Download CSV
        </Button>
      </div>
      {rows.length ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {header.map((h, i) => (
                  <th key={h} className={`py-1.5 ${align(i)}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((v, i) => (
                    <td key={i} className={`py-2 ${align(i)} ${i === 0 ? 'font-medium' : ''}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </div>
  )
}
