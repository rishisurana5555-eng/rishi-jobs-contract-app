import type { UploadState } from './useBackgroundUpload'
import { Spin } from './ui'

/** Next to a chosen CV: it is only saved to Google Drive when the person sends. */
export function UploadNote({ state }: { state: UploadState }) {
  if (state === 'uploading')
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <Spin className="h-3 w-3" /> Saving to Google Drive…
      </span>
    )
  if (state === 'done') return <span className="text-emerald-700">· saved in Google Drive</span>
  if (state === 'failed') return <span className="text-amber-700">· couldn’t be saved to Google Drive — please press Send again</span>
  return null
}
