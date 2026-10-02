import { useCallback, useEffect, useState } from 'react'
import { loadBackend, type Backend } from './backend'
import { useIdleSignOut } from './backend/idleSignOut'
import { ApplicationDetail } from './components/ApplicationDetail'
import { Header } from './components/Header'
import { DeleteCandidateDialog } from './components/DeleteDialogs'
import { MessagesModal } from './components/MessagesPanel'
import { NotificationBanner } from './components/NotificationBanner'
import { ReminderAlarm } from './components/ReminderAlarm'
import { SendToClientTeamModal } from './components/SendToClientTeamForm'
import { Alert, Spinner } from './components/ui'
import { AppProvider, useApp } from './context/AppContext'
import { AdminDashboard } from './pages/AdminDashboard'
import { ClientTeamDashboard } from './pages/ClientTeamDashboard'
import { Login } from './pages/Login'
import { PEDashboard } from './pages/PEDashboard'
import { PMDashboard } from './pages/PMDashboard'
import type { AppUser } from './types'

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    loadBackend().then(setBackend, (e: Error) => setAuthError(e.message))
  }, [])

  useEffect(() => {
    if (!backend) return
    return backend.onAuth(
      (u) => {
        setUser(u)
        if (u) setAuthError(null)
      },
      (e) => {
        setAuthError(e.message)
        setUser(null)
      },
    )
  }, [backend])

  const idleSignOut = useCallback(() => {
    setAuthError('You were signed out after 12 hours of inactivity. Please sign in again.')
    void backend?.signOut()
  }, [backend])
  useIdleSignOut(!!backend && !!user, idleSignOut)

  if (!backend || user === undefined)
    return authError ? (
      <div className="p-6">
        <Alert>{authError}</Alert>
      </div>
    ) : (
      <Spinner label="Starting…" />
    )
  if (!user) return <Login backend={backend} error={authError} />

  return (
    <AppProvider key={user.id} backend={backend} me={user}>
      <Shell />
    </AppProvider>
  )
}

function DeleteCandidate() {
  const { deletingCandidate, setDeletingCandidate, selectedId, apps, openApp } = useApp()
  if (!deletingCandidate) return null
  const { candidateId, name } = deletingCandidate
  return (
    <DeleteCandidateDialog
      candidateId={candidateId}
      name={name}
      onClose={() => setDeletingCandidate(null)}
      // The candidate's detail panel has nothing left to show.
      onDeleted={() => apps.find((a) => a.id === selectedId)?.candidateId === candidateId && openApp(null)}
    />
  )
}

function Shell() {
  const { me, appsLoaded, loadError } = useApp()
  const Page = { PM: PMDashboard, ClientTeam: ClientTeamDashboard, Admin: AdminDashboard, SuperAdmin: AdminDashboard, PE: PEDashboard }[me.role]
  return (
    <div className="min-h-full">
      <Header />
      <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6">
        <NotificationBanner />
        {loadError && (
          <div className="mb-4">
            <Alert>Could not load data: {loadError}</Alert>
          </div>
        )}
        {appsLoaded ? <Page /> : !loadError && <Spinner />}
      </main>
      <ApplicationDetail />
      <SendToClientTeamModal />
      <MessagesModal />
      <DeleteCandidate />
      <ReminderAlarm />
    </div>
  )
}
