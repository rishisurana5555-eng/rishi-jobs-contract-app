/**
 * Rishi Jobs — CV upload to Google Drive.
 *
 * The dashboard sends the revised CV here; this script saves it into your Drive folder
 * and returns the file link, which the dashboard stores in Firebase (the file itself
 * never goes into Firebase). Only people logged in to the dashboard can upload:
 * every request carries their Firebase login token, which is checked below.
 * When a candidate or client is deleted in the dashboard, their CVs are moved to the Drive trash
 * through this script too (action "trash").
 *
 * Setup (once): see README.md → "CV upload to Google Drive".
 */

// 1. Paste the ID of your Drive folder, e.g. from https://drive.google.com/drive/folders/THIS_PART
const FOLDER_ID = '1rXjLoZxqOxcDiRLE4g9W9pupqI-b2hEA'

// 2. true  = anyone who has the link can view the CV (simplest: every team member can open it).
//    false = the file keeps the folder's sharing; then share the folder with each team member's Google account.
const ANYONE_WITH_LINK_CAN_VIEW = true

// Firebase web API key of project rishijobs-workflow (a public identifier, used to verify logins).
const FIREBASE_API_KEY = 'AIzaSyBTClamRwGdy8NaOTxFriJ6vjJ_zv8mU0c'
const MAX_BYTES = 10 * 1024 * 1024

function doPost(e) {
  const lock = LockService.getScriptLock()
  try {
    const body = JSON.parse(e.postData.contents)
    const user = verifyLogin_(body.idToken)
    if (body.action === 'trash') return json_(trashCvs_(body.fileIds))
    // The dashboard sends the same uploadId when it retries an upload whose answer got lost,
    // so a retry returns the file already saved instead of saving it a second time.
    const uploadId = String(body.uploadId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
    const cache = CacheService.getScriptCache()
    if (uploadId) {
      lock.waitLock(30000)
      const done = cache.get('upload:' + uploadId)
      if (done) return json_(Object.assign({ ok: true, repeated: true }, JSON.parse(done)))
    }
    const bytes = Utilities.base64Decode(body.data || '')
    if (!bytes.length) throw new Error('The file is empty.')
    if (bytes.length > MAX_BYTES) throw new Error('The file is larger than 10 MB.')
    const name = String(body.fileName || 'cv').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150)
    const blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', name)
    const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob)
    file.setDescription('Uploaded by ' + user.email.split('@')[0] + ' via the Rishi Jobs dashboard')
    if (ANYONE_WITH_LINK_CAN_VIEW) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
    const result = { url: file.getUrl(), id: file.getId(), name: file.getName() }
    if (uploadId) cache.put('upload:' + uploadId, JSON.stringify(result), 21600) // remembered for 6 hours
    return json_(Object.assign({ ok: true }, result))
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) })
  } finally {
    try {
      lock.releaseLock()
    } catch (_) {}
  }
}

// Opening the web app URL in a browser shows this, handy to check the deployment works.
function doGet() {
  return json_({ ok: true, service: 'Rishi Jobs CV upload', version: 3, folderSet: FOLDER_ID.indexOf('PASTE_') !== 0 })
}

/**
 * Moves CVs to the Drive trash when a candidate or client is deleted in the dashboard (recoverable
 * from the trash for 30 days). Only files inside the CV folder are touched; anything else is skipped.
 */
function trashCvs_(fileIds) {
  let trashed = 0
  for (const id of (Array.isArray(fileIds) ? fileIds : []).slice(0, 200)) {
    try {
      const file = DriveApp.getFileById(String(id))
      const parents = file.getParents()
      let inFolder = false
      while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inFolder = true
      if (inFolder && !file.isTrashed()) {
        file.setTrashed(true)
        trashed++
      }
    } catch (err) {
      // already gone, or not a file we can see: nothing to do
    }
  }
  return { ok: true, trashed: trashed }
}

/** Confirms the token belongs to a signed-in dashboard user (asks Firebase Authentication). */
function verifyLogin_(idToken) {
  if (!idToken) throw new Error('Not signed in.')
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true,
  })
  const data = JSON.parse(res.getContentText())
  if (res.getResponseCode() !== 200 || !data.users || !data.users.length || data.users[0].disabled)
    throw new Error('Your login has expired. Please sign out and sign in again.')
  return data.users[0]
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

/** Run this once from the editor (select it → Run) to grant Drive access and test the folder ID. */
function testSetup() {
  const folder = DriveApp.getFolderById(FOLDER_ID)
  Logger.log('OK — CVs will be saved in: ' + folder.getName())
}
