/**
 * Names are shown with a capital first letter on every word: "ravi kumar" and "RAVI KUMAR"
 * both become "Ravi Kumar", "archita m. makwana" becomes "Archita M. Makwana". A word typed in
 * mixed case ("McDonald", "DSouza") keeps its own capitals; only its first letter is raised.
 */
export function properName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) =>
      word
        .split(/([-'.])/)
        .map((part) => {
          if (!part || /^[-'.]$/.test(part)) return part
          const plain = part === part.toLowerCase() || part === part.toUpperCase()
          const rest = plain && part.length > 1 ? part.slice(1).toLowerCase() : part.slice(1)
          return part[0].toUpperCase() + rest
        })
        .join(''),
    )
    .join(' ')
}
