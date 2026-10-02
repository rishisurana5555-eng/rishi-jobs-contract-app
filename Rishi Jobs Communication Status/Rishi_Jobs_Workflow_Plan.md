# Rishi Jobs — PM ↔ Client Team Coordination Dashboard
### Build Plan (for development in Visual Studio / VS Code) — Revision 3

---

## 0a. What Changed in Revision 3

1. **"Your turn" alert with sound.** The moment a status change makes it someone's turn, that person gets the Action Required banner **plus a short chime**.
2. **Repeating reminder alarm every 10 minutes.** While a record stays the person's turn, an alarm sound plays and a "Work pending — it's your turn" pop-up appears every 10 minutes until the status is changed (section 5.1).
3. **No reminders while an interview is scheduled.** Reminders start only after the interview date and time have passed, when the system moves the record to "debrief pending".
4. **New status: "Client / Candidate asked to wait till <date, time>".** After the interview, if the client or candidate asks for time before giving their answer, the Client Team (client) or PM (candidate) records the date and time. **Only that side's** reminders pause until then; the other side keeps working and keeps getting reminders unless it records its own wait. Once the time passes, the waiting side's reminders start again until it updates the status.
5. **New client / new job opening alert.** When a Client Team member (or Owner) adds a new client or job opening, every other user gets a one-time alert about it (section 5.2).

## 0. What Changed in Revision 2

1. **Availability dates are collected at first submission.** When the PM submits a candidate to the Client Team, the submission must include the revised CV, the candidate's contact number, and the candidate's available interview dates. The separate "PM asks candidate for availability" step is removed.
2. **New dates are asked for only on a mismatch.** The Client Team gets the client's interview dates and compares them with the candidate's dates already on the record. If a date matches, the interview is scheduled directly. Only if nothing matches do both sides go back to collect new dates.
3. **Each side now has its own status.** The same application shows a PM-side status and a Client-Team-side status (for example, PM sees "Submitted CV to Client Team" while the Client Team sees "Pending – New submission from PM"). Both come from one shared workflow stage, so they can never contradict each other.
4. **Interview stays "in progress" until the interview date has passed**, then automatically moves both sides to "Pending – get debrief".
5. **Multiple interview rounds are supported.** After the debrief, the Client Team can request another round, and the date-matching process repeats.
6. **Only the Client Team sets the final outcome** — "Candidate placed" or "Candidate rejected".
7. **Status messages are fixed options selected from a list**, and every status change has an **optional free-text message box** alongside it.

---

## 1. Purpose

Replace manual calls/WhatsApp coordination between PMs and Client Team members with a real-time dashboard where:

- Every candidate-client submission has a single, always-current **workflow stage**, shown to each side as that side's own **fixed status label**.
- Status is always chosen from **fixed, pre-defined options** (no free-typed statuses), and every status change can carry an **optional message** from the person making the change.
- Either side can also attach a standalone **note** at any time, visible instantly to the other side.
- Every status change or note triggers an **instant top-of-page alert** for the relevant person only.
- Every workflow record clearly shows **who needs to act next** (`nextActionBy`) — one side or both sides — so the responsible person is immediately visible.
- The dashboard prominently surfaces **My Action Required**, separating items that need the current user's action from informational updates.
- The full **history/timeline** of a candidate's journey (status changes + messages + notes + timestamps) is stored permanently and viewable on demand.

Team for v1: 2 PMs (Shubham, Kimi), 2 Client Team members (Depanshi, Vanshika), 4 PEs (Bhavya, Dheer under Shubham; Dhirendra, Narendra under Kimi), 1 Admin (Rishi).

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React (Vite) + TypeScript | Fast dev, works great in VS Code, easy real-time UI updates |
| Styling | Tailwind CSS | Fast to build a clean status-color-coded table UI |
| Backend/DB | **Firebase Firestore** | Real-time listeners = instant cross-user updates with no polling |
| Auth | Firebase Authentication | Role-based login (PM / Client Team / Admin) out of the box |
| Notifications (in-app) | Firestore real-time listener + toast/banner component | No extra service needed for v1 |
| Notifications (push, later) | Firebase Cloud Messaging (FCM) or WhatsApp Cloud API webhook | Fast-follow, not v1-critical |
| Hosting | Firebase Hosting | One-command deploy, pairs natively with Firestore |
| Dev environment | VS Code + Firebase CLI + Node.js | Standard local dev + emulator suite for testing without touching prod data |

**Deployment/access model:** The React application is deployed once to Firebase Hosting and accessed through a shared web URL. PMs, Client Team members, PEs, and Admin can open the same application from their own laptops/desktops (and supported mobile browsers) and log in with their individual Firebase Authentication accounts. The application does not need to run on the developer's computer after deployment.

**Why Firestore specifically (not Realtime Database):** Firestore gives you structured collections/subcollections (Applications → Timeline entries), better querying (filter by assigned PM, by client, by status), and scales better for the history/audit-log requirement you described.

---

## 3. Firestore Data Model

```
users (collection)
  userId
    name
    role: "PM" | "ClientTeam" | "PE" | "Admin"
    reportsTo: userId (PE → PM link)

clients (collection)
  clientId
    name
    contactPerson
    assignedClientTeam: userId
    createdAt / createdBy / createdByName   // set when the client is added (drives the one-time "new client" alert)

jobOpenings (collection)
  jobId
    clientId
    title
    status: "open" | "closed" | "on-hold"
    createdAt / createdBy / createdByName   // set when the job opening is added (drives the one-time "new job opening" alert)

userState (collection)       <-- per-person app state; each person can read/write only their own doc
  userId
    catalogSeenAt: timestamp    // newest client/job creation this person has already been alerted about

applications (collection)   <-- the core record, one per candidate+job
  applicationId
    candidateId
    candidateName
    candidateContactNumber          // REQUIRED at first submission
    originalCvUrl
    revisedCvUrl                    // REQUIRED at first submission
    jobId
    clientId
    assignedPE: userId
    assignedPM: userId
    assignedClientTeam: userId

    // --- workflow state (see section 4) ---
    stage: string                   // single source of truth for where the workflow is
    pmStatus: string                // fixed status code shown on the PM side
    clientTeamStatus: string        // fixed status code shown on the Client Team side
    currentInterviewRound: number   // 1, 2, 3 ... (increments when a next round is requested)
    latestCandidateDates: [date]    // candidate's most recent availability (from first submission or a later update)
    latestClientDates: [date]       // client's most recent availability
    scheduledInterviewAt: timestamp // set when an interview is scheduled; null otherwise
    outcome: null | "placed" | "rejected"
    clientWaitUntil: timestamp | null     // debrief_pending: client asked to wait till this time — pauses only the Client Team
    candidateWaitUntil: timestamp | null  // debrief_pending: candidate asked to wait till this time — pauses only the PM
                                          // both cleared on a stage change; the candidate's also when the candidate debrief is recorded

    lastUpdatedBy: userId
    lastUpdatedAt: timestamp
    latestMessage: string           // most recent status message or note (quick-access copy)
    unreadFor: [userId]             // whoever hasn't seen the latest change yet
    nextActionBy: [userId]          // ONE OR BOTH sides — array, because some stages are pending on both
    notificationType: "action_required" | "informational"
    lastActionType: string          // status change / note / availability / interview etc.

    /timeline (subcollection)       <-- full audit history, append-only
      entryId
        type: "status_change" | "note" | "cv_upload" | "availability_update" | "interview" | "debrief" | "system"
        side: "PM" | "ClientTeam" | "System"
        fromStage / toStage
        statusCode                  // the fixed status option selected
        statusLabel                 // the label as displayed at that time (e.g. "Interview scheduled at 12 Oct, 3:00 PM")
        message: string (optional)  // free text typed alongside the status change; may be empty
        dates: [date] (optional)    // availability dates attached to this entry, if any
        actor: userId | "system"
        actorRole: "PM" | "ClientTeam" | "System"
        timestamp

    /availabilityRounds (subcollection)
      roundId
        interviewRound              // which interview round these dates are for
        attemptNumber               // 1 = first try, 2+ = after a mismatch
        candidateDates: [date]      // attempt 1 of round 1 = dates given at first submission
        clientDates: [date]
        matchResult: "pending" | "matched" | "no-match"
        createdAt

    /interviews (subcollection)
      interviewId
        interviewRound
        scheduledAt: timestamp
        mode: "in-person" | "phone" | "video"
        meetingDetails: string
        status: "scheduled" | "in_progress" | "completed"
        candidateDebrief: string    // entered by PM
        clientDebrief: string       // entered by Client Team
        candidateDebriefAt / clientDebriefAt: timestamp
```

**Key design point:** `applications` is the single source of truth. The PM dashboard and Client Team dashboard are just two *filtered views* of this same collection (`where assignedPM == currentUser` vs `where assignedClientTeam == currentUser`). This is what guarantees no message ever "goes to the wrong person" — visibility is enforced by the query, not by manual routing.

**Why `stage` plus two side statuses:** `stage` decides what is allowed next. `pmStatus` and `clientTeamStatus` are what each side sees. Both side statuses are always written together with the stage in one Firestore transaction, so the two sides can never drift out of sync.

---

### Current v1 scope note
The existing data-model and build-plan references to `jobOpenings` and candidate/application records are intentionally retained as future-compatible foundations. **Do not remove them from this plan.** For the first implementation, prioritize the PM ↔ Client Team coordination workflow, status/action ownership, status messages, notes, notifications, availability matching, interview scheduling, multi-round interviews, debriefs, and timeline/history. A fuller Job Opening module and dedicated Candidate Management module can be implemented later using the retained data-model structure.

---

## 4. Workflow, Fixed Statuses + Color Logic

### 4.1 The workflow step by step

1. **PM submits candidate.** The PM submits the revised CV, the candidate's contact number and the candidate's available interview dates (all three are required fields). PM status becomes **"Submitted CV to Client Team"**. Client Team status becomes **"Pending – New submission from PM"**. Next action: Client Team.
2. **Client Team submits CV to client.** The Client Team reviews the CV and sends it to the client, then selects **"CV submitted to client"**. The pending work is still with the Client Team only: they must call the client and get the client's interview dates. Next action: Client Team.
3. **Client Team matches dates.** The Client Team enters the client's available dates. The system compares them with the candidate's dates already on the record and highlights any overlap.
   - **If a date matches**, the Client Team selects **"Interview scheduled"** and picks the date/time. Both sides show **"Interview scheduled at <date, time> – in progress"**. Go to step 5.
   - **If no date matches**, the Client Team selects **"Dates don't match – new dates needed"**. Go to step 4.
4. **Dates mismatch — both sides pending.** PM status becomes **"Pending – get new available date from candidate"** and Client Team status becomes **"Pending – get new available date from client"**. Next action: both. The PM calls the candidate and submits new dates (PM status becomes "New candidate dates submitted"); the Client Team calls the client and enters new client dates. When a date matches, the Client Team schedules the interview (step 5). If there is still no match, the Client Team selects "Dates don't match" again and a new attempt starts. Every attempt is kept as a separate availability round.
5. **Interview scheduled / in progress.** Both sides show **"Interview scheduled at <date, time> – in progress"** until the interview date has passed. Nobody has a pending action during this stage (either side can still add notes, and the Client Team can reschedule if needed, which returns to step 4).
6. **Debrief — both sides pending.** Once the interview date has passed, the system automatically moves both sides to pending: PM status **"Pending – get debrief from candidate"**, Client Team status **"Pending – get debrief from client"**. The PM calls the candidate and records the candidate debrief (PM status becomes **"Debrief received from candidate"**). The Client Team calls the client and records the client debrief, choosing one of the next outcomes:
   - **"Debrief received – next round required"** → the interview round number increases by one and both sides go back to step 4 to collect dates for the next round. The same process repeats until the final interview is done.
   - **"Candidate placed"** or **"Candidate rejected"** → step 7.
7. **Final outcome (Client Team only).** The Client Team sets **"Candidate placed"** or **"Candidate rejected"**. Both sides show the final status, and the record moves to Completed. If the PM has not yet recorded the candidate debrief, the screen shows a warning but does not block the Client Team.

### 4.2 Fixed status options each role can select

Statuses are **never typed freely**. Each user sees a dropdown containing only the options valid for their role *and* the current stage. Every status change form also has an **optional message box** ("Add a message (optional)") — the user may leave it empty or write anything, and the message is saved with that status change in the timeline and shown to the other side in the notification.

| Stage (before change) | Who can change | Options shown in dropdown | Extra required inputs |
|---|---|---|---|
| — (new record) | PM | Submitted CV to Client Team | Revised CV, candidate contact number, candidate available dates |
| `new_submission` | Client Team | CV submitted to client | — |
| `cv_with_client` | Client Team | Interview scheduled · Dates don't match – new dates needed | Client available dates; interview date/time, mode, meeting details (for "Interview scheduled") |
| `rescheduling` | PM | New candidate dates submitted | New candidate dates |
| `rescheduling` | Client Team | Interview scheduled · Dates don't match – new dates needed | New client dates; interview date/time, mode, meeting details (for "Interview scheduled") |
| `interview_scheduled` | Client Team | Reschedule – new dates needed | — |
| `debrief_pending` | PM | Debrief received from candidate | Candidate debrief text |
| `debrief_pending` | Client Team | Debrief received – next round required · Candidate placed · Candidate rejected | Client debrief text |
| `debrief_pending` (candidate debrief not yet recorded) | PM | Candidate asked to wait till… | Date and time the candidate will answer by (must be in the future) |
| `debrief_pending` | Client Team | Client asked to wait till… | Date and time the client will answer by (must be in the future) |

The two **"asked to wait till…"** options do not change the stage. They add a timeline entry such as *"Client asked to wait till 5 Oct, 5:00 PM"*. **Each wait belongs to one side only:**

- **Client asked to wait** (set by the Client Team, stored in `clientWaitUntil`) pauses only the Client Team. Their status reads *"Client asked to wait till 5 Oct, 5:00 PM"*, it shows blue for them, and they get no reminders until then. The PM is not affected: if the candidate debrief is still pending, the PM stays red, keeps getting reminders, and can record the debrief as usual.
- **Candidate asked to wait** (set by the PM, stored in `candidateWaitUntil`, offered only until the candidate debrief is recorded) pauses only the PM in the same way. The Client Team keeps its own pending work and reminders, and can still record the client debrief and set the outcome.
- Both sides can each have their own wait at the same time.
- When a side's time has passed, its label becomes *"Client's waiting time over (5 Oct, 5:00 PM) – Pending – get debrief from client"*, it turns red again, and its reminders start straight away until it updates the status. That side can also update the status during its wait if the answer comes early.
- A new wait replaces that side's old one. A stage change (outcome, next round) clears both, and recording the candidate debrief clears the candidate wait.

Some transitions are made **by the system**, not by a person (they appear in the timeline as "System"):
- `interview_scheduled` → `debrief_pending` when the interview date has passed.

*Optional recommendation (not part of your original flow):* also allow the Client Team to select "Candidate rejected" during `cv_with_client` or `rescheduling`, for the case where the client rejects the CV before any interview. Remove this if you don't want it.

### 4.3 What each side sees at each stage

| Stage | PM-side status label | Client-Team-side status label | `nextActionBy` |
|---|---|---|---|
| `new_submission` | Submitted CV to Client Team | Pending – New submission from PM | Client Team |
| `cv_with_client` | CV submitted to client | CV submitted to client – Pending: get client dates | Client Team |
| `rescheduling` (PM hasn't sent new dates) | Pending – get new available date from candidate | Pending – get new available date from client | Both |
| `rescheduling` (PM has sent new dates) | New candidate dates submitted – waiting for Client Team | Pending – get new available date from client / schedule interview | Client Team |
| `interview_scheduled` | Interview scheduled at <date, time> – in progress | Interview scheduled at <date, time> – in progress | Nobody |
| `debrief_pending` (neither debrief in) | Pending – get debrief from candidate | Pending – get debrief from client | Both |
| `debrief_pending` (PM debrief in) | Debrief received from candidate | Pending – get debrief from client | Client Team |
| `debrief_pending` (client asked to wait) | Unchanged (PM's own pending status) | Client asked to wait till <date, time> | Unchanged; only the Client Team is paused until the time passes |
| `debrief_pending` (candidate asked to wait) | Candidate asked to wait till <date, time> | Unchanged (Client Team's own pending status) | Unchanged; only the PM is paused until the time passes |
| `closed_placed` | Candidate placed | Candidate placed | Nobody |
| `closed_rejected` | Candidate rejected | Candidate rejected | Nobody |

The "Interview scheduled at <date, time>" label is a fixed template — the date and time are filled in automatically from `scheduledInterviewAt`; the user does not type the label.

Every status label also shows the interview round when it is round 2 or later, e.g. "Round 2 – Interview scheduled at 18 Oct, 11:00 AM – in progress".

### 4.4 Color logic

Color is computed client-side from the viewer's role and `nextActionBy`, not stored.

| Situation for the viewer | Color |
|---|---|
| Pending on **me** (I am in `nextActionBy`) | Red |
| Pending on the **other side** only (I'm waiting) | Yellow |
| Interview scheduled / in progress, or a waiting period is running for **my** side | Blue |
| Candidate placed | Green (closed) |
| Candidate rejected | Grey (closed) |

### 4.5 When does "the interview date has passed"?

Default rule: the interview stays "in progress" until the **end of the scheduled interview day** (midnight, local time). After that the system moves the record to `debrief_pending`. This cut-off can later be changed to "interview time + X hours" if you prefer.

How this runs in v1 without extra paid services: whenever any dashboard loads or refreshes its listener, it checks records in `interview_scheduled` whose date has passed and performs the transition in a Firestore transaction (safe even if two people open the dashboard at the same moment — only one write succeeds, and a "System" timeline entry is added). A scheduled Cloud Function can replace this later (Phase 12), but it requires the Firebase Blaze (pay-as-you-go) plan.

### 4.6 Notes vs. status messages

- A **status message** is the optional text typed in the message box at the moment of a status change. It is stored in the same timeline entry as the status change.
- A **note** can be added at any point *without* changing the status, e.g. "Client asked for one more reference check."
- Both are timestamped, stored in the timeline subcollection, update `latestMessage` + `unreadFor` on the parent application, and surface in the notification banner immediately.

---

## 5. Real-Time Notification Behavior

Using Firestore's `onSnapshot` real-time listener (no polling, no delay):

1. PM or Client Team member changes status (with or without a message) or adds a note — or the system moves an interview to debrief.
2. Firestore writes, in one transaction: updates `applications/{id}` (stage, pmStatus, clientTeamStatus, nextActionBy, latestMessage, unreadFor) + adds an entry to `applications/{id}/timeline`.
3. The other side's dashboard has an active listener on `applications where assignedTo == me and unreadFor contains me` — the moment the write happens, their screen updates **without refreshing**.
4. A **top-of-page banner/toast** appears, showing the fixed status plus the message if one was written: *"Shubham → [Candidate Name]: Submitted CV to Client Team — 'Candidate prefers afternoons'"* or *"Depanshi added a note on [Candidate Name]"*, with a click-through to that record. When a stage becomes pending on both sides (date mismatch, debrief), **both** the PM and the Client Team member receive an Action Required alert.
5. Once the recipient opens/views the record, `unreadFor` is cleared for them — this also lets you show an unread-count badge (like an inbox) on the dashboard's nav bar, so nothing gets missed even if they're not staring at the screen when it happens.

This satisfies "immediate + no missed points" — it's push-based, not something either side has to go looking for.

### 5.1 "Your turn" sound and the 10-minute reminder alarm

The laptop may be on with the dashboard open while the person is away or has forgotten, so alerts also make a sound.

1. **Your turn (immediately).** When a change by the other side (or the system) puts you in `nextActionBy`, the Action Required banner appears and a **short chime** plays.
2. **Reminder alarm (every 10 minutes).** While a record is still your turn, a **"⏰ Work pending — it's your turn"** pop-up appears over the page with about 6 seconds of **alarm beeping**. It lists every record that has been your turn for 10+ minutes, how long each has been pending, and an Open button. "OK, I'm on it" closes it. The alarm comes back every 10 minutes until the status is changed. Records whose status changes drop off the list straight away.
3. **When the reminders start:**
   - Normal pending work: 10 minutes after it became your turn (`stageSince`).
   - **Interview scheduled:** nobody is pending, so there are no reminders. After the interview date and time have passed, the system moves the record to `debrief_pending` (section 4.5). That is the "your turn" moment for both sides, and the 10-minute cycle starts from there.
   - **Client/Candidate asked to wait:** no reminders **for the side that was asked to wait** (Client Team for the client, PM for the candidate) until that time. Their first alarm rings as soon as the time has passed, then every 10 minutes. The other side is reminded as normal for its own pending work unless it records its own wait.
4. **Several records at once:** all overdue records ring together in one alarm, then share the same 10-minute cycle, so the person isn't hit with separate alarms for each one.
5. **Tab in the background:** the sound still plays. If desktop alerts are turned on (bell menu), a desktop notification that stays until clicked is also shown.
6. **Browser sound permission:** browsers only allow sound after the person has clicked or typed on the page once. After a page reload with no click yet, the reminder pop-up shows "The browser blocked the alarm sound — click here to turn sound on". The account menu has a **"Test reminder sound"** button.
7. **Only on open dashboards:** the chime and alarm run in the browser, so they need the dashboard open (any tab). Anything pending when someone opens the dashboard rings right away. Reaching people who don't have it open is Phase 11 (WhatsApp/email push).

### 5.2 New client / new job opening alert (everyone, once)

1. When anyone adds a **new client** or **new job opening** (Setup → Clients / Job openings), the record is stamped with `createdAt`, `createdBy` and `createdByName`. Editing an existing client or job does not send an alert.
2. **Every other user** (PMs, Client Team, PEs, Owners) gets a green top-of-page alert straight away: *"📢 New client added: Acme Corp — added by Depanshi"* or *"📢 New job opening: Accountant at Acme Corp — added by Depanshi"*. The person who added it doesn't get one.
3. The alert stays until it is closed, so it isn't missed. If the tab is in the background and desktop alerts are on, a desktop notification is shown too.
4. **Only once per person:** once the alert has been shown, the app saves `userState/{uid}.catalogSeenAt`, so it doesn't come back after a refresh or on another device. Someone who wasn't online when it was added gets the alert the next time they open the dashboard. The exception is a person with no saved state yet (e.g. a brand-new login), who is only alerted about additions from the last 7 days.

The rules live in `src/workflow/workflow.ts` (`isMyTurn`, `firstReminderAt`, `REMINDER_EVERY_MS`), the timing loop in `src/context/AppContext.tsx`, the pop-up in `src/components/ReminderAlarm.tsx`, and the sounds in `src/alarm/sound.ts` (generated with the Web Audio API, so there are no sound files).

---

## 6. Screens

### Status Change Control (shared component, both roles)
- A **dropdown of fixed status options**, filtered to only those valid for the user's role and the record's current stage (section 4.2).
- Any **extra required fields** for the chosen option appear below it (e.g. dates picker, interview date/time, debrief text).
- An **always-visible optional message box** ("Add a message (optional)") beside/below the dropdown. It can be left empty.
- A single **Update Status** button that saves the status, required fields and message together.

### PM Dashboard (Shubham / Kimi)
- **Home:** two actions — "Submit Candidate to Client Team" and "My Submissions"
- **Submit Candidate form:** candidate name/ID, client, job opening, revised CV upload, **candidate contact number (required)**, **candidate available interview dates (required, multiple dates/slots allowed)**, optional message. Submitting sets PM status to "Submitted CV to Client Team".
- **My Submissions table:** Candidate ID, Candidate Name, Contact Number, CV link, Client Name, Client ID, Interview Round, **PM Status (color-coded)**, Last Message, Last Updated
- Row click → detail panel: full timeline, Status Change Control, add-note box, availability rounds (candidate vs client dates side by side), interview details, debriefs
- Top-of-page notification bell/banner for unread updates
- **My Action Required** section showing records where current user is in `nextActionBy`
- Separate counts for **Action Required** and **Unread Updates**
- Quick filters: My Action Required, All My Submissions, Waiting for Client Team, Recently Updated, Interview Scheduled, Debrief Pending, Completed
- Display `Current Status`, `Next Action`, `Last Updated`, and `Last Updated By` prominently

### Client Team Dashboard (Depanshi / Vanshika)
- **Home:** grouped by Client → Job Opening → Candidates submitted, with color-coded Client-Team-side status
- New submissions show the candidate's contact number and available dates right away, so no one has to ask for them
- Same row detail panel, Status Change Control, note and notification behavior as the PM view
- When entering client dates, the screen shows candidate dates and client dates side by side and highlights matching dates, with a one-click "Schedule on this date" action
- Filter by client, by status, by PM
- **My Action Required** section showing only submissions requiring this Client Team member's action
- Separate counts for Action Required and Unread Updates
- Display Current Status, Next Action, Last Updated, and Last Updated By prominently

### Timeline / History View (both roles)
- Accessible from any candidate row: chronological feed of every status change (with its message, if any), note, availability round, interview, debrief and system transition — who did it and when. This is your "till-date progress" view, pulled directly from the `timeline` subcollection.
- Visual stepper at the top: **CV Submitted to Client Team → CV Submitted to Client → Interview Scheduled → Debrief → (Next Round…) → Placed/Rejected**, with the current stage and current round highlighted. Mismatch/rescheduling attempts appear as a loop marker on the Interview Scheduled step.

### Interview Details
- Show the matching dates between candidate and client clearly; the Client Team confirms the selected slot.
- Store interview round, date, time, mode, meeting/link details, and interview status (scheduled → in progress → completed).
- Store candidate debrief (PM) and client debrief (Client Team) per round.
- Each round is kept separately, so round 1, round 2 etc. are all visible in history.
- Interview-related changes must also create timeline entries and notifications.

### Admin (Rishi) Dashboard
- Rollup across both PMs and both Client Team members
- Sort by "stuck longest" / oldest unresolved status
- Full access to every candidate's timeline

---

## 7. Build Phases

**Phase 1 — Project Setup**
- Initialize React + Vite + TypeScript project in VS Code
- Set up Firebase project, enable Firestore + Authentication
- Set up Firebase emulator suite for local dev/testing

**Phase 2 — Auth & Roles**
- Firebase Auth login (email/password to start)
- Role field per user (PM / ClientTeam / PE / Admin), controls which dashboard renders and which Firestore queries run

**Phase 3 — Core Data + CRUD**
- Build `clients`, `jobOpenings`, `applications` collections
- Build forms: add client, add job opening, CV upload to Firebase Storage
- Build the **PM Submit Candidate form** with required revised CV, candidate contact number and candidate availability dates; these dates become attempt 1 of availability round 1

**Phase 4 — Workflow Engine + Fixed Statuses + Color Logic**
- Define the stage list and the fixed status options per role per stage in one config file (`workflow.ts`) — the single place to change labels or allowed transitions later
- Build the **Status Change Control**: filtered dropdown, conditional required fields, always-present optional message box
- Every status change writes stage + pmStatus + clientTeamStatus + nextActionBy + timeline entry (with message) in one Firestore transaction
- Enforce role rules (e.g. only the Client Team can set "CV submitted to client", "Interview scheduled", "Candidate placed/rejected")
- Client-side color computation based on viewer role and `nextActionBy`

**Phase 5 — Action Ownership + Notes + Real-Time Notifications**
- `nextActionBy` as an array so both sides can be pending together (mismatch and debrief stages)
- Build **My Action Required** sections for PM and Client Team dashboards
- Distinguish Action Required notifications from Informational notifications
- Add-note UI component on each application record
- Firestore `onSnapshot` listeners wired to dashboards
- Top-of-page toast/banner (showing status + message) + unread badge system
- One-time alert to all users when a new client or job opening is added (section 5.2)
- "Your turn" chime and the repeating 10-minute reminder alarm with sound (section 5.1), paused during scheduled interviews, and for one side during that side's agreed client/candidate waiting period

**Phase 6 — Timeline/History View**
- Build the chronological feed component per candidate, showing status, message, actor and time
- Visual stepper for current stage and round
- History is **append-only**: status changes, messages, notes, availability rounds, interview actions, debriefs, CV actions, system transitions and outcome changes are never deleted or overwritten from the audit timeline.

**Phase 7 — Availability Matching Loop**
- Candidate dates come from the PM's first submission (no separate request step)
- Client Team enters client dates; show candidate and client dates side by side
- Automatically identify overlapping dates/slots and highlight `matched`, `no-match`, and `pending`
- On match: Client Team confirms the slot → `interview_scheduled`
- On no match: Client Team selects "Dates don't match" → both sides pending → PM submits new candidate dates, Client Team enters new client dates → new attempt created automatically
- Preserve every attempt and round in history; never overwrite previous rounds

**Phase 8 — Interview Management + Debrief + Multi-Round**
- Build interview record/details per round (date/time, mode, meeting details, status)
- "Interview scheduled at <date, time> – in progress" label until the interview day has passed
- Automatic transition to `debrief_pending` after the interview date (section 4.5)
- Capture candidate debrief (PM) and client debrief (Client Team)
- Client Team outcome options: next round required (loops back to Phase 7 flow with round + 1), candidate placed, candidate rejected
- Notify relevant users about scheduling, reschedules, debrief-pending, next rounds and final outcome

**Phase 9 — Admin Rollup Dashboard**
- Cross-PM / cross-Client-Team view with bottleneck sorting

**Phase 10 — Polish & Deploy**
- Firebase Hosting deploy
- Firestore security rules (a PM can only write to applications where `assignedPM == their uid`; same for Client Team)
- Basic mobile responsiveness (your team will likely check this on phones between calls)

**Phase 11 — Fast-Follow (optional, post-launch)**
- WhatsApp/email push notifications via Cloud Functions, for anyone not actively on the dashboard
- SLA timers: escalate color/urgency if a status sits untouched too long (the in-browser 10-minute reminder alarm is already built, section 5.1)

**Phase 12 — Scheduled Transition (optional, post-launch)**
- Move the "interview date passed → debrief pending" check into a scheduled Cloud Function so it happens even if nobody opens the dashboard (requires Firebase Blaze plan)

---

## 8. Deployment, Team Access & Cost Planning

### Deployment
- Build the React + Vite + TypeScript application locally in VS Code.
- Create a production build and deploy it to Firebase Hosting.
- Firebase Hosting provides a shared HTTPS web URL for the application.
- After deployment, the developer's laptop does **not** need to remain running for the team to use the application.
- All team members access the same deployed application from their own devices using a browser.

### Team Access
- Each person gets an individual Firebase Authentication account.
- The application determines the user's role after login and loads the appropriate dashboard.
- Example:
  - Shubham → PM Dashboard
  - Kimi → PM Dashboard
  - Depanshi → Client Team Dashboard
  - Vanshika → Client Team Dashboard
  - Bhavya / Dheer → PE access as defined by permissions
  - Dhirendra / Narendra → PE access as defined by permissions
  - Rishi → Admin Dashboard
- Never share one common login between team members.

### Cost
- Development can be done using the free tooling and Firebase free usage limits where applicable.
- Firebase services are usage-based; production charges can occur if database reads/writes, storage, hosting traffic, or other service usage exceeds the applicable free limits.
- Scheduled Cloud Functions (Phase 12) and push notifications via Cloud Functions (Phase 11) require the Blaze plan; v1 is designed to work without them.
- Before production launch, configure Firebase billing/budget alerts and monitor usage.
- The initial internal team size is small, so the first deployment can be kept low-cost, but the plan should not assume that Firebase will remain permanently free at every usage level.

---

## 9. Firestore Security Rules — Key Principle

Enforce visibility and edit rights at the database level, not just in the UI, so no role can see or edit records that aren't theirs:

- PM can `read`/`write` only applications where `assignedPM == request.auth.uid`
- Client Team can `read`/`write` only applications where `assignedClientTeam == request.auth.uid`
- Admin (Rishi) can `read` everything
- Only the assigned PM can set PM-side statuses (submission, new candidate dates, candidate debrief); only the assigned Client Team member can set client-side statuses (CV submitted to client, interview scheduled, dates mismatch, next round, placed/rejected)
- Rules check that a new status is one of the fixed allowed values for that role and stage — free-typed status values are rejected
- The automatic `interview_scheduled` → `debrief_pending` change is allowed for either assigned user only when `scheduledInterviewAt` is in the past
- Timeline entries can be created but never updated or deleted

---

## 10. Suggested VS Code Project Structure

```
rishi-jobs-dashboard/
  src/
    components/
      StatusBadge.tsx          // color logic lives here
      StatusChangeControl.tsx  // fixed-option dropdown + required fields + optional message box
      SubmitCandidateForm.tsx  // revised CV + contact number + availability dates
      AvailabilityMatcher.tsx  // candidate vs client dates side by side, match highlighting
      InterviewPanel.tsx       // interview details + debriefs per round
      NotificationBanner.tsx
      ApplicationTable.tsx
      ApplicationDetail.tsx
      TimelineFeed.tsx
      NoteInput.tsx
    pages/
      PMDashboard.tsx
      ClientTeamDashboard.tsx
      AdminDashboard.tsx
      Login.tsx
    workflow/
      workflow.ts              // stages, fixed status options per role, labels, allowed transitions
      transitions.ts           // transaction helpers for each status change
      autoTransitions.ts       // "interview date passed → debrief pending" check
    firebase/
      config.ts
      firestore.ts             // query helpers
      auth.ts
    types/
      Application.ts
      TimelineEntry.ts
      Interview.ts
  firestore.rules
  firebase.json
  package.json
```

---

## 11. Immediate Next Steps

1. Create Firebase project + enable Firestore, Auth, Storage, Hosting.
2. Scaffold the React+Vite+TS app in VS Code, connect Firebase config.
3. Seed the collections with your real users (Shubham, Kimi, Depanshi, Vanshika, Bhavya, Dheer, Dhirendra, Narendra, Rishi) and a couple of test clients/candidates.
4. Write `workflow.ts` first (stages, fixed status options, labels) — confirm the labels with the team before building screens.
5. Build Phase 2–4 (auth, submission form with contact + availability, workflow engine with the Status Change Control) — this alone gets you a usable v1.
6. Layer in real-time notifications, Action Required logic, and the timeline view once the core flow is stable.
7. Add availability matching, interview management, debriefs and multi-round support.
8. Deploy to Firebase Hosting and test the full flow (including a date mismatch and a second round) from multiple team devices/accounts before production use.
