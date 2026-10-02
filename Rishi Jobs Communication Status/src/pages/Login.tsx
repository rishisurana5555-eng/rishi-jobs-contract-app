import { useState, type FormEvent } from 'react'
import type { Backend } from '../backend'
import { Alert, Button, Field, Input } from '../components/ui'

export function Login({ backend, error }: { backend: Backend; error: string | null }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-brand-800 to-brand-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Rishi Jobs" className="h-28 w-auto" />
          <p className="mt-2 text-sm text-slate-500">PM ↔ Client Team Coordination Dashboard</p>
        </div>
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <PasswordLogin backend={backend} />
      </div>
    </div>
  )
}

function PasswordLogin({ backend }: { backend: Backend }) {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await backend.signIn(userId, password)
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')
          ? 'Wrong user ID or password.'
          : code.includes('configuration-not-found') || code.includes('operation-not-allowed')
            ? 'Logins are not switched on yet. Owner: Firebase console → Authentication → Get started → enable Email/Password.'
            : code.includes('user-disabled')
              ? 'Your login has been deactivated. Please contact Rishi.'
              : code.includes('too-many-requests')
                ? 'Too many attempts. Please wait a few minutes and try again.'
                : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="User ID">
        <Input autoComplete="username" autoCapitalize="none" spellCheck={false} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. shubham" required autoFocus />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" busy={busy} className="w-full py-2.5">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-xs text-slate-500">Forgot your password? Ask Rishi to reset it.</p>
    </form>
  )
}
