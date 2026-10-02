import { useState, type FormEvent } from 'react'
import { useApp } from '../context/AppContext'
import { Alert, Button, Textarea } from './ui'

/** Adds a note without changing the status; the other side is alerted instantly. */
export function NoteInput({ appId }: { appId: string }) {
  const { perform } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await perform(appId, { kind: 'note', message: text })
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Client asked for one more reference check" />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" variant="secondary" busy={busy} disabled={!text.trim()}>
        {busy ? 'Adding…' : 'Add message'}
      </Button>
    </form>
  )
}
