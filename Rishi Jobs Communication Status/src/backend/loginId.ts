/**
 * People log in with a short User ID (e.g. "shubham"). Firebase Authentication needs an
 * email-shaped login, so the ID is mapped to "<id>@rishijobs.local". No mail is ever sent
 * to it; the person's real email is kept separately in users/{uid}.email.
 * Keep LOGIN_DOMAIN in sync with scripts/users.mjs.
 */
export const LOGIN_DOMAIN = 'rishijobs.local'

export const loginEmailFor = (userId: string) => {
  const id = userId.trim().toLowerCase()
  return id.includes('@') ? id : `${id}@${LOGIN_DOMAIN}`
}
