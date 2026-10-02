import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { phoneKey, phoneProblem, type PhoneOwner } from './PhoneInput'

/**
 * The candidate who already has this number, unless it's `ownId` (the candidate being edited). Looked up
 * as soon as the number is complete, so the form can say so before Send; saving checks again (phoneIndex).
 */
export function usePhoneTaken(value: string, ownId?: string): PhoneOwner | null {
  const { backend } = useApp()
  const key = phoneProblem(value) ? null : phoneKey(value)
  const [found, setFound] = useState<{ key: string; owner: PhoneOwner | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    backend
      .lookupPhone(`+${key}`)
      .then((owner) => live && setFound({ key, owner }))
      .catch(console.error)
    return () => {
      live = false
    }
  }, [key, backend])
  const owner = found?.key === key ? found.owner : null
  return owner && owner.candidateId !== ownId ? owner : null
}
