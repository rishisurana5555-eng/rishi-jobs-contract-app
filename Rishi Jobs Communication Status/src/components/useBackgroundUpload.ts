import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'

export type UploadState = 'idle' | 'uploading' | 'done' | 'failed'

interface Upload {
  file: File
  uploadId: string
  promise: Promise<{ url: string; name: string }> | null
}

/**
 * The chosen CV is only saved to Google Drive when the person sends (never just because it was
 * picked), so a CV of a candidate who is never added doesn't end up in Drive. `ensure()` uploads it
 * then, or returns it if it was already saved by an earlier try; one file keeps one uploadId, so a
 * retry never saves it twice. If saving the record fails afterwards, `discard()` moves the CV to the
 * Drive trash, and the next send uploads it afresh.
 */
export function useBackgroundUpload(file: File | null) {
  const { backend } = useApp()
  const current = useRef<Upload | null>(null)
  const [state, setState] = useState<UploadState>('idle')

  useEffect(() => {
    current.current = file ? { file, uploadId: crypto.randomUUID(), promise: null } : null
    setState('idle')
  }, [file])

  const ensure = useCallback(async () => {
    const u = current.current
    if (!u) throw new Error('Choose the CV first.')
    const run = () => {
      const promise = backend.uploadCv(u.file, u.uploadId)
      u.promise = promise
      setState('uploading')
      promise.then(
        () => current.current === u && setState('done'),
        () => current.current === u && setState('failed'),
      )
      return promise
    }
    try {
      return await (u.promise ?? run())
    } catch {
      // Try once more (same uploadId: if the first one was actually saved, that file comes back).
      return run()
    }
  }, [backend])

  /** Saving the record failed: the CV just uploaded for it goes to the Drive trash. */
  const discard = useCallback(
    async (url: string) => {
      const u = current.current
      if (u) current.current = { file: u.file, uploadId: crypto.randomUUID(), promise: null }
      setState('idle')
      await backend.discardCv(url).catch(console.error)
    },
    [backend],
  )

  return { state, ensure, discard }
}
