/**
 * A value read from the CV, offered under its field instead of being filled in: the person checks it
 * and clicks it to use it. Hidden when there is none, or the field already holds it.
 */
export function Suggestion({ value, current, onUse }: { value?: string; current: string; onUse: () => void }) {
  if (!value?.trim() || value.trim().toLowerCase() === current.trim().toLowerCase()) return null
  return (
    <button
      type="button"
      onClick={onUse}
      className="mt-1 flex w-full flex-wrap items-baseline gap-x-1.5 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-left text-xs text-amber-950 hover:bg-amber-100"
      title="Read from the CV — check it, then click to use it"
    >
      <span className="font-bold uppercase tracking-wide text-amber-800">Suggestion:</span>
      <span className="font-medium">{value}</span>
      <span className="ml-auto font-medium text-brand-700 underline">Use this</span>
    </button>
  )
}
