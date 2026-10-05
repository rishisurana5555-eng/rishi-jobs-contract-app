# Rishi Jobs — PM ↔ Client Team Coordination Dashboard

A real-time dashboard that replaces calls and WhatsApp between PMs and the Client Team.

**Stack:** React + Vite + TypeScript, Tailwind CSS, Firebase (Firestore, Auth, Hosting); CV files in Google Drive via an Apps Script web app.

---

## Setup

This app uses the Firebase project **RishiJobs-Workflow** (`rishijobs-workflow`). The connection settings are in `.env`.
The admin key `serviceAccountKey.json` is used only by the scripts below. It is git-ignored and must never be shared or uploaded.

### 1. Logins (users)

- Everyone logs in with a **User ID** (e.g. `shubham`) and a password.
- Each person's details are kept in the Firestore **`users`** collection: user type (Super Admin, Admin, PM, Client Team, PE), name, user ID, contact number, email and, for PEs, who they report to.
- **Passwords are never stored in that table.** Firebase Authentication keeps them scrambled.

1. Switch on logins (once): Firebase console → Build → **Authentication** → Get started → **Email/Password** → Enable.
2. Create everyone's logins: `npm run users`. This reads `scripts/team.json`, prints a password for each new person, and also saves them to `login-credentials.txt` (git-ignored).
3. Reset someone's password: `npm run users -- reset shubham`.

After that, the Admins manage people in the app under **Clients, jobs & team → Team**: add a person (a password is generated and shown once), edit contact number and email, change the user type, or deactivate someone.

To change only one person's user type from this computer: `npm run users -- role <userId> <SuperAdmin|Admin|PM|ClientTeam|PE>`.

**Who can do what:**
- **Super Admin (Rishi)** can do everything an Admin can, and is the only one who can add, edit or deactivate Admin accounts or give someone an Admin role.
- **Admins (Shweta, Vanshika)** see everything, receive every new client and job opening, assign each job opening to a PM, and manage the team (except Admin accounts), clients and job openings.
- **PMs (Shubham, Kimi)** see only the job openings assigned to them, and assign each one to one of their PEs.
- **PEs (Dheer, Bhavya, Narendra, Dhirendra)** see only the job openings assigned to them, add candidates for them (**＋ Add Candidate**), and follow the status and full history of every candidate they are on.
- **Client Team (Depanshi)** adds clients (client details only) and, separately, their job openings (**Clients & jobs** tab), sees only their own clients, and follows who each job opening is assigned to.
- **PMs and PEs** can't change clients or job openings, and can't see clients or job openings that aren't assigned to them.
- Only the Super Admin can delete a client; only Admins can delete job openings. The Client Team can delete neither.

### 2. CV files (Google Drive)

When a PM uploads a revised CV, it is saved in the **Rishi Jobs CVs** Google Drive folder, and **only the file's link** is stored in Firebase.
The upload goes through a Google Apps Script web app that runs under the folder owner's Google account. The code is in [google-drive-upload/Code.gs](google-drive-upload/Code.gs), and its URL is `VITE_CV_UPLOAD_URL` in `.env`.

- **Uploads are checked:** only people logged in to the dashboard can upload; the script checks their login with Firebase. Files are limited to 10 MB.
- **Who can open a CV:** anyone with the link can view it (`ANYONE_WITH_LINK_CAN_VIEW = true` in the script). Set it to `false` to rely on the folder's own sharing instead.
- **Changing the script later:** in Apps Script, go to Deploy → **Manage deployments** → edit → *New version*, so the URL stays the same.

### 3. Run and publish

- Local: `npm install`, then `npm run dev`.
- **Live app:** https://rishijobs-workflow.web.app. Everyone logs in there with their User ID and password.
- **Publish changes:** run `npm run deploy`. It builds the app and uploads it to Firebase Hosting using `serviceAccountKey.json`, so no Firebase login is needed. The team sees the new version the next time they open or refresh the page.
- `npm run rules` re-publishes `firestore.rules` after you change it.

Before launch, set a budget alert in Google Cloud Billing. Usage beyond Firebase's free limits is charged.

## How it works

| Where | What |
|---|---|
| [src/workflow/workflow.ts](src/workflow/workflow.ts) | **The one place to change labels or rules**: stages, the fixed PM and Client Team status labels, which dropdown options each role sees at each stage, and color logic. |
| [src/workflow/engine.ts](src/workflow/engine.ts) | Turns an action (submit, status change, note, auto-debrief) into every write it needs. Both backends apply these writes in **one transaction**, so the stage, both side statuses, `nextActionBy` and the timeline entry always agree. |
| [src/workflow/engine.test.ts](src/workflow/engine.test.ts) | Tests the full journey, including a date mismatch, the automatic debrief move, round 2, placed, rejected and reschedule. Run with `npm test`. |
| [src/backend/firebaseBackend.ts](src/backend/firebaseBackend.ts) | Firestore and Auth access; CV upload to the Google Drive script. |
| [firestore.rules](firestore.rules) | Server-side enforcement. People only see and edit their own records. Only allowed stage moves are accepted, statuses must be the fixed values, and the timeline is append-only. |
| [src/pages/](src/pages/) | PM, Client Team, Admin (rollup, job openings to assign, setup) and PE (their job openings, add candidates, follow their status) dashboards. |

**New candidates (only PEs add them):** PMs can't add candidates themselves (the security rules refuse it). The PE clicks **＋ Add Candidate** and uploads the candidate's original CV (PDF) first. The phone number has a country-code dropdown (+91 India by default), so only the number itself is typed. As soon as the CV is chosen it opens **beside the form** (CV on the left, form on the right; **Open in a separate window** puts it in its own window instead), and the PE reads it and types every detail in by hand — nothing is read or filled in from the CV. The PE picks one of the job openings assigned to them (the candidate goes to that job opening's PM), and adds the available dates, current and expected salary (LPA), notice period and the recruiter note. The PE's status becomes "Submitted new candidate to PM" and the PM gets an alert "New candidate added by PE <name>". The client's Client Team member can already follow the candidate (status "New candidate from <PE> – with <PM>, not sent to you yet", filter **With PE / PM – not sent yet**), but can't act on it and isn't alerted until the PM sends it to them.

**Client status (Client Team):** the **Client status** tab shows, for each of their clients, how many candidates have been submitted so far (with PE / PM, with them or the client, interview, placed, rejected, backout), and every submission: candidate, job opening, when and by which PE, the PM, the current status and the last update.

The PM sees these at the top of the dashboard, each with a **Send this candidate to Client Team** button in the **Action** column at the end of the row (candidates already sent show "Sent to Client Team ✓" there). It opens a form with everything the PE entered (all editable) and the **CV editor** (https://rishijobs-revisedcvs.streamlit.app, code in `../cv process`) embedded and pre-filled with the original CV and the details. After **Generate edited CV** there, the revised CV comes straight back into the form (no download / upload); the PM can also open the editor in a new tab, or upload or link a revised CV by hand. Sending it moves the candidate into the normal workflow below. The editor's address is `VITE_CV_EDITOR_URL` (optional; the address above is the default).

**Candidate's available dates:** the note the PE writes when adding a candidate (the available dates) is kept as the candidate's **availability note** and shown to everyone on the candidate. A doubt from the PM and the PE's answer never replace it: when the PM sends the candidate to the Client Team, the message starts with that first note, and the note the PM sends becomes the availability note the Client Team sees. After the PE answers a doubt, the PM's status reads "<PE> answered your doubt".

**CV files are saved to Google Drive only when the candidate is sent** (the PE's original CV on **Send to PM**, the PM's revised CV on **Send to Client Team**), never just because a file was picked. If the record can't be saved after the upload, that CV is moved to the Drive trash again. CVs are read with the "legacy" build of pdf.js, which works in older browsers too (the standard build fails on every PDF there).

**Revised CV in the history:** when the PM confirms "I have checked the revised CV", the candidate's history gets "Revised CV made and checked by PM <name> (<file>)" with the time. Nothing else changes and nobody is alerted.

**Doubts from the Client Team to the PM:** on a candidate the Client Team has, the Client Team member can **Raise a doubt to <PM>** (one open doubt at a time). It becomes the PM's turn — red, "Pending – <Client Team> raised a doubt: please answer", an Action required alert and the 10-minute reminder (counted from the doubt) — until the PM answers it on the candidate. The Client Team member is then alerted, and the question and answer stay on the candidate ("Last doubt") and in its history. The candidate's status doesn't move, and the Client Team can keep updating it meanwhile; a doubt still open when the candidate is closed is dropped. Only the PM and the Client Team member are alerted (the PE can read it on the candidate).

**Workflow (plan §4):** the PM sends the revised CV, contact number and available dates. The Client Team sends the CV to the client, then enters the client's dates. The candidate's and client's dates are compared automatically: a match lets the Client Team schedule the interview, and no match puts both sides on "Pending – get new dates".

Once an interview is scheduled, the Client Team can at any time choose **Reschedule**, **Next round required**, **Placed** or **Rejected**. When they choose next round, they can also add the client's dates for the next round; then only the PM is pending, for the candidate's dates. Five minutes after the interview's start time, the system moves both sides to "Pending – get debrief". The PM and the Client Team can write or edit their debrief for **any** held interview, in any round, under "Availability & interviews".

**Editing clients and job openings:** Admins and the Client Team can edit a client or job opening, but only after writing a **Reason for editing** (compulsory). The edit is stamped on the record (`lastEdit`) and alerts the admins and the PM and PE on the job openings concerned ("✏️ Client edited / Job opening edited", with what changed and the reason). Open / on hold / closed is now changed in the edit form too, so it also needs a reason.

**Clients & job openings log:** every change is logged with date, time and who did it — clients in `clients/{id}/log`, job openings in `jobOpenings/{id}/log`: added, edited (what changed + reason), PM assigned (with the delegation), PE assigned, notes, and client deleted. **Log** buttons in Clients and Job openings, a log card on each job opening's page, and for the admins a **Clients & job openings log** card with everything (also of deleted clients).

**Delegation:** when an Admin assigns a job opening to a PM, they choose **1st, 2nd or 3rd delegation**; it shows on the job opening and goes into its log.

**PM decision on a PE's candidate:** four choices, each with a reason that goes into the history — **Send** (the Send form asks for the **Reason for selection**, logged as "Selected by PM <name>" and shown on the candidate), **Reject**, **Doubt**, and **Unanswered** (the candidate isn't answering: it stays with the PM, and the PE is alerted with the reason).

**Revised CV log:** the candidate's history records when the PM clicks **Generate revised CV** ("Revised CV generated by PM <name>"), when they confirm it, and every time the Client Team member opens / downloads it from the green **Revised CV → Open CV** link ("Revised CV downloaded by <name>"), each with date and time.

**Candidates and deleting:** each candidate has a profile (collection `candidates`: details, original CV, their PE and PM); every submission to a client points to it by candidate ID, so a PE can send the same candidate to another client (**My candidates → Send to another client**). Everyone can **delete a candidate** (detail panel or Candidates list): all their submissions with the whole history, the profile, and their CVs (moved to the Drive trash) go. Only the Super Admin can **delete a client** (Clients, jobs & team): its job openings and all submissions to it (with the revised CVs made for it) go; the candidates stay in the Candidates list.

**Messages to the admins:** a PE starts a conversation with one Admin, the Super Admin, or all admins with **✉ Message Admin** on their dashboard. The admins reply in the conversation and the PE can answer back; each side sees when their message was read. New messages and replies bring an alert with the calm notification sound, and the envelope with the unread count in the header opens the conversations. Only the PE and the admin(s) the conversation is with can read it (collection `messages`).

**Reports (Admins and the Super Admin):** in the **Reports** tab the admin ticks the reports they want, sets the filters (period, client, and for team work a role or one person) and presses **Generate report**; nothing is worked out or loaded before that. **Show as** picks graphs and tables, graphs only or tables only ([src/components/Charts.tsx](src/components/Charts.tsx); each measure keeps one colour in every graph). The reports are, for a chosen period (today, yesterday, this / last week, this / last month, last 3 months, this year, all time or custom dates): new candidates, clients and job openings; work done per PE, PM and Client Team member (sent to Client Team, candidate dates, debriefs, CVs to client, interviews scheduled, reschedules, placed, rejected, notes); a chart of new candidates and placements by day, week or month; the pipeline; the clients and job openings added and by whom; and a table per client. Each table can be downloaded as CSV. Work done is counted from every submission's history, loaded once when Reports is opened (**Refresh** reloads it); this needs the admin-only `timeline` rule in `firestore.rules`. Deleted candidates and clients drop out of the reports ([src/reports/metrics.ts](src/reports/metrics.ts)).

**Signing out:** the login is shared by all tabs of the browser and lasts only while the app is open. Once **every tab of the app is closed** (whether or not the browser stays open), the person is signed out and must log in again next time. Each open tab shows it is alive (a time in localStorage every few seconds, and an answer on a BroadcastChannel); when the app starts with a saved login, it is kept only if this is a reload (a sign of life seconds ago) or another open tab answers ([src/backend/browserSession.ts](src/backend/browserSession.ts)). Closing all tabs and reopening the app within about 10 seconds counts as a reload. After 12 hours without a click, key press or scroll, the person is signed out too ([src/backend/idleSignOut.ts](src/backend/idleSignOut.ts)).

**Names** (candidates and team) are shown and saved with a capital first letter on every word ([src/workflow/names.ts](src/workflow/names.ts)).

**Status labels** name the people on the candidate instead of their role, e.g. "Pending – New submission from Shubham", "Submitted CV to Vanshika" (the role is shown if the person isn't known yet).

**Colors (per viewer):** red = your action, yellow = waiting on the other side, blue = interview scheduled, green = placed, grey = rejected.

**Alerts:** alerts arrive instantly through Firestore listeners and appear as banners at the top of the page. A bell shows the unread count, and "My Action Required" lists what needs you. **Desktop notifications** are asked for everyone on their first click after logging in (browsers only allow asking then); once allowed, every alert and the reminder alarm also appear as a desktop notification whenever the person isn't looking at the app (another tab or program in front). If someone blocked them, the bell menu explains how to allow them again.

**Sounds:** a smooth rising chime for a status change or something you did successfully; a calm, soft bell for notifications (notes, new clients / job openings); a harsher buzzing beep for alerts — when something needs your action, and for error and warning messages; and the alarm for the 10-minute reminder. Closing the alert banner, the reminder pop-up or the desktop notification stops its sound. All four can be played from the account menu (**Test sounds**).

**Reminder alarm:** when something becomes your turn, the alert sound plays. Job openings count too: one without a PM is the admins' turn, one without a PE is its PM's turn, and one assigned to a PE is that PE's turn (shown red, "Your turn – find and add a candidate") until they have submitted a candidate for it; the alarm rings 10 minutes after the turn started, and every 10 minutes after that. While it stays your turn, a "Work pending" pop-up with an alarm sound appears every 10 minutes until the status changes. There are no reminders while an interview is scheduled; they start after the interview time has passed. After the interview, the Client Team can set "Client asked to wait till <date, time>" and the PM can set "Candidate asked to wait till <date, time>". Each wait pauses only that side's reminders until the time; the other side is still reminded of its own pending work. Browsers only play sound after one click on the page. See section 5.1 of the plan.

**Job openings are handed down, not shown to everyone** ([src/workflow/jobs.ts](src/workflow/jobs.ts), [src/components/JobOpenings.tsx](src/components/JobOpenings.tsx)):
1. The Client Team adds a client (client details only), then adds its job openings under **Job openings** (title and details: requirements, experience, location, salary…). They go to the **admins** only, who are alerted the moment the form is saved: "📢 New client added with a job opening: <job> at <client>" for each job opening, and "📢 New client added: <client>" for every new client (the client form takes client details only). When adding a job opening, its **Job status** is chosen: *Active* or *Second priority*. The status is "With Admin – to assign a PM".
2. An admin sees the job openings in **Job openings**, one line each with a search (client, job title, ID), a status filter (open / on hold / closed) and an **Assign to PM** button at the end of the row. Clicking a job opening opens its page: the details, the notes, and the PM to assign it to, with an optional note. Only that PM is alerted; the status becomes "With <PM> – to assign a PE".
3. The PM sees the same one-line list in their **Job openings** tab; **Assign to PE** (or clicking the job opening) opens its page, where they assign it to one of their PEs (the PEs who report to them), with an optional note. Only that PE is alerted; the status becomes "Assigned to <PE>".
4. The PE adds candidates for it (**＋ Add candidate for this job**, or **＋ Add Candidate**); each goes to that job opening's PM.

**Notes:** every note — written by the Client Team when adding the job opening, by an admin or PM when handing it on, or by anyone on it at any time from its page — is added to the job opening's **Notes**, which everyone on it (and the next person it goes to) reads. Notes can't be changed or removed.

**On hold / closed:** if a job opening that is on hold or closed is assigned to a PM or PE, their alert and the job opening's page say that it is not a priority right now, so they can work on other openings first.

So every job opening has one Client Team member, one PM and one PE; nobody else sees it or is alerted about it (enforced in `firestore.rules`: a PM or PE can only read job openings assigned to them, and no clients). The client's Client Team member is told when it is assigned to a PM and to a PE. An admin can change the PM (the new PM then chooses the PE), and the PM can change the PE. Candidates already submitted stay with the PM and PE who submitted them, who carry on with them as before (the PM can still send them to the Client Team, though they no longer see the job opening); new candidates go to the new PM / PE. The job opening's page lists every candidate for it with their own PE and PM, marking those from before the change, and the Client Team's **Client status** counts them all. Each alert stays until closed and is not repeated on refresh or on another device (saved in `userState/{uid}`).

**"Interview time passed" (start time + 5 minutes):** there is no paid server job. The Client Team member's open dashboard performs the move the moment the time passes (a timer set for that moment; if the server refuses it as a moment too early, it is tried again every 15 seconds, and it is checked again as soon as the tab is shown). Both sides then get the "get debrief" alert with the alert sound, and the 10-minute reminder starts. If their dashboard isn't open, the PM's dashboard does it a minute later. It runs in a transaction, so it happens only once, and the security rules allow it only after that time. If neither dashboard is open, it happens as soon as one of them is opened. Plan Phase 12 (a scheduled Cloud Function on the Blaze plan) can take this over later.

**Decisions made where the plan left a choice:**
- The optional "Candidate rejected before any interview" option is **included** (Client Team, at *CV with client* / *Getting new dates*). To remove it, delete `cv_with_client` and `rescheduling` from that option's `stages` in `workflow.ts`, and update `clientTeamMoveAllowed` in `firestore.rules`.
- PEs can add candidates for their PM, and see (not change) the status and full history of the candidates they are on. They can't add notes or change statuses.
- The Client Team can "Save client dates only" without changing status, for when the client answers before the candidate.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Local development |
| `npm test` | Workflow engine tests |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run users` | Create logins and profiles from `scripts/team.json`; `-- reset <userId>` for a new password; `-- role <userId> <role>` to change one person's user type |
| `npm run rules` | Publish `firestore.rules` using the admin key |
| `npm run deploy` | Build and publish to https://rishijobs-workflow.web.app |
