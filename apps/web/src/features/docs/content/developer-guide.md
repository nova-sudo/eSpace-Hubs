# Developer guide

This guide is for engineers using the **Dev Hub**. It walks through the
whole year: adding your goals, giving each one a tracker, logging
check-ins, and sending your manager a review packet.

New here? Start with [getting-started.md](getting-started.md) to sign up
and sign in. Words you don't know are in [glossary.md](glossary.md). To
recognise a goal widget at a glance, open the
[widget gallery](widget-gallery.html).

---

## Contents

1. [Finding your way around](#1-finding-your-way-around)
2. [Your home page (Intelligence)](#2-your-home-page-intelligence)
3. [Adding or importing goals](#3-adding-or-importing-goals)
4. [Analyze my goals (the AI analyst)](#4-analyze-my-goals-the-ai-analyst)
5. [Build your own tracker and manager approval](#5-build-your-own-tracker-and-manager-approval)
6. [Logging check-ins](#6-logging-check-ins)
7. [Grades and achievement levels](#7-grades-and-achievement-levels)
8. [The Goals page](#8-the-goals-page)
9. [The Evidence page](#9-the-evidence-page)
10. [Review packets](#10-review-packets)
11. [Publishing a plan to GitHub](#11-publishing-a-plan-to-github)
12. [Snapshots](#12-snapshots)
13. [Reviews log (PR reviews)](#13-reviews-log-pr-reviews)
14. [Shared goals](#14-shared-goals)
15. [Notifications and email](#15-notifications-and-email)
16. [Settings](#16-settings)

---

## 1. Finding your way around

The bar at the top of every page has these tabs in the Dev Hub:

- **Intelligence**: your home page.
- **Goals**: every goal, in one place.
- **Evidence**: build the document you send your manager.
- **Settings**: your goals, tokens, account and preferences.

On the right of the bar you'll find:

- A search button (**Open command palette**) to jump anywhere.
- A light/dark switch.
- The **AI analyst** button. It shows how many goals still need a
  tracker, for example "AI analyst · 3 to classify", or "AI analyst · all
  set". It is hidden on phones.
- The notification bell.
- Your name, with a sign-out menu.

Under the page title on the home page there is a small row of links:
**Overview**, **Reviews log**, **Snapshots** and **Shared with me**.

On a phone, the tabs fold into a menu button (**Open navigation**).

---

## 2. Your home page (Intelligence)

The home page is titled **"One thing at a time."** It answers one
question: what needs you right now?

### If you have no goals yet

You see **No goals yet** and a button, **Add or import goals**. It takes
you to Settings → **Goals & setup**. See [section 3](#3-adding-or-importing-goals).

### If your goals have no trackers yet

You see **Goals aren't set up for tracking yet** and a button, **Analyze
my goals**. See [section 4](#4-analyze-my-goals-the-ai-analyst).

### Once goals are tracked

The page has three parts.

**1. The summary row: "Logged so far"**

- One percentage: of the check-ins that were due so far, how many you
  logged (or marked **Nothing to report**).
- Each objective counts by its weight.
- Weeks before a tracker existed, and weeks still to come, are never
  counted.
- The coloured badges count your goals by status (see the table below).
- If some goals aren't in the number, a line says so. Otherwise it reads
  "Every goal with a tracker is in this number."

**2. "Needs you first"**

- The most urgent goal is shown large, with a short explanation and one
  main button. The button depends on the goal:
  - **Fill this week** (or this month, this quarter…) for a goal you log.
  - **Open goal** for a goal measured automatically.
  - **Set up** for a goal that still needs setup answers.
  - **Revise and resubmit** for a tracker your manager sent back.
- Other goals that need you are listed under it as one-line rows.
- When nothing is due, the section is called **Where you stand** and
  reads **All caught up.**
- Beside it you may see:
  - **Capture this week's snapshot**, with a **Snapshot now** button and
    a **History** link. It appears only when this week has no snapshot.
    See [section 12](#12-snapshots).
  - **Notes from your manager**: one-to-one notes your manager chose to
    share with you. Private notes never appear here. The card is hidden
    when there are none.

**3. "All objectives"**

Every objective is a band, and every goal is a row in it. Each row shows
its window strip, its status, and its grade (or **Not graded yet**). Goals
without a tracker are listed at the bottom with an **Analyze my goals**
button.

### What the status badges mean

These are the same words on every page.

| Badge | Colour | Meaning |
|---|---|---|
| **On pace** | mint (green) | Everything due so far is logged. |
| **Exceeding** | sky (blue) | Graded Over achieved or Role model. |
| **Auto-tracked** | lavender | Measured from GitHub, GitLab or Jira. Nothing to log. |
| **Not logged** | lemon (yellow) | The tracker is ready. Nothing is logged yet, and nothing is overdue yet. |
| **Needs setup** | lemon (yellow) | Has a tracker that can't be logged yet: setup questions, approval, or someone else judges it. |
| **Behind** | peach (orange) | Something that was due has nothing logged, or the goal was graded Not achieved. |
| **No tracker yet** | grey | No tracker yet, so this goal isn't in any percentage. |

A tracker waiting for approval shows **Pending approval**. One your
manager sent back shows **Changes requested**.

---

## 3. Adding or importing goals

Go to **Settings → Goals & setup**. The page is titled **"Your goals."**

Your goals come in two levels:

- An **objective** (L1) is a heading from your performance plan.
- A **goal** (L2) sits under an objective. It is what you are measured
  on.

On your very first visit, a welcome card tells you who your manager is.
Your manager approves the trackers you build and reads the review packets
you send. If no manager is assigned yet, it tells you to ask your admin.
Until then, trackers you build go to the admins for approval.

### Typing goals in

1. Click **Add objective**.
2. Fill in the objective: **Code (optional)**, **Category**, **Weightage
   %**, **Goal statement**, **Short description** and **Achievement
   rubric**.
3. Under the objective, click **Add goal**.
4. Fill in the goal: **Code (optional)**, **Category**, **Weightage %**,
   **Title**, **Description**, **Rubric**, **Priority**, **Start date**
   and **Due date**.

Changes save to your account as you type.

Tips:

- The badge at the top shows your total weight, for example "80%
  weighted · 20% left". It turns green at exactly 100%.
- The AI reads every field. The rubric and description matter most for
  picking a good tracker. The more specific, the better.
- The **Code** is your Goal Code from the performance plan. Managers can
  set grading rules per code (see [manager-guide.md](manager-guide.md)).
- To remove an objective and all its goals, click **Delete** on its card.

### Importing from Zoho

1. Click **Import file (Zoho export)**.
2. Drop the **L1 View** `.csv` file and the **L2 View** `.xls` file, or
   click **Drop files or click to browse**.
3. Each file shows what it was read as ("Detected L1" or "Detected L2").
   If it guessed wrong, switch the level.
4. Check the **Preview**. If a goal's objective isn't in the files, pick
   an objective for it from the dropdown, or choose **— leave out —**.
5. Pick a mode:
   - **Append** (the default): adds the new objectives. Objectives with a
     code you already have are skipped.
   - **Replace existing**: archives your current tree. Trackers and
     logged readings do **not** carry over. There is no undo.
6. Click the button to finish (**Append …** or **Replace & import …**).

When you replace, your old goals are not deleted. They are kept as a
read-only report card under **Past cycles**, at the bottom of the same
page.

### Integration status

Under your goals, **Connect your integrations** shows which tools are
connected (for example "2 of 3 connected"). Click **Manage** to open the
Integrations tab. See [section 16](#16-settings).

---

## 4. Analyze my goals (the AI analyst)

The analyst reads each goal and proposes a **tracker**: how that goal
will be measured.

Open it with the **AI analyst** button in the top bar, or with any
**Analyze my goals** button. It opens full screen, titled **Analyst**.

### How it works

1. **Read goals.** It reads every objective and goal title and rubric.
2. **Match a widget.** It picks one of three kinds:
   - **Automatic (read from your tools)**: GitLab, GitHub, Jira or CI
     data. You log nothing.
   - **Manual (you log it)**: you fill in a check-in each period.
   - **Hybrid (both)**.
3. **You review.** Nothing is saved until you accept it.

### Running it

1. In the left rail, pick a mode: **Widgets**, **Analysis**, **Review**
   or **Chat**.
2. Pick an **AI provider** if you want a different model.
3. Click **Run analysis** (first time), **Classify remaining N** (new
   goals only) or **Re-analyze all**.
4. The **Analysis** view shows each goal as it is read: **Reading…**,
   **Classifying…**, then the chosen widget, or **Failed**. Each result
   has a **Why** line.
5. You can stop at any time with **Abort**.

### Reviewing proposals

Open **Review**. The count of proposals is shown with a **To review**
badge. For each proposal you can:

- Change the **Widget** or the **Kind**.
- Narrow it to certain repos (**Repo scope**; **All repos** clears it),
  labels, a ticket type, or a CI job, when the widget uses them.
- Set a target.
- Click **Can't track this** to mark it untrackable, with a reason.
- Click **Skip** to throw this proposal away, or **Save** to keep it.

Or use **Save all** / **Discard all** at the top.

Be careful: if a proposal changes a goal's tracker kind, saving it
deletes that goal's logged history. The card warns you before you save.

**Re-analyze all** keeps your current trackers until you save the new
proposals.

### Chat

**Chat** lets you ask the AI about your work ("Ask about your work…").
What you type is sent to the AI provider you picked.

---

## 5. Build your own tracker and manager approval

Already know how you want to track a goal? Skip the AI's guess and
describe it yourself.

### Where to start

- In the analyst, next to any goal without a tracker: **Build my own**.
- On any goal's card: **More → Build my own tracker**.

### Steps

1. The window is titled **Build your own tracker**.
2. Under **How do you want to track this goal?**, write what you'd log
   and how often. For example: "Each quarter I want to log how many
   chapters I read — target 5 — plus a short note."
3. Optional: **Attach a plan — PDF, DOCX, XLSX, XLS or CSV, up to 10 MB**.
   The app reads the document and shows you the text first. You can edit
   or trim it before anything is sent to the AI.
4. Click **Generate tracker**. It designs the fields, the cadence and the
   achievement levels.
5. Check the preview. If something was unclear, a banner lists what it
   needs from you.
6. For a plan with several periods, you see **Check the plan**: the plan
   laid out window by window. Check the start and end of the cycle here.
   Without a stated length, a plan falls back to the calendar year.
7. If the tracker reads from your repository, answer the setup questions
   first (**Set up auto-fill**).
8. Click **Submit for approval**.

### Approval

- Every tracker you build waits for approval. Nothing is approved
  automatically.
- It goes to your manager. If you have no manager, it goes to your
  organisation's admins instead.
- While it waits, the card shows **Pending approval**. You can't log on
  it yet.
- If your manager asks for changes, the card shows **Changes requested**,
  with their note. Click **Revise & resubmit**.
- You get a notification when it is approved or sent back.
- Your manager may adjust the achievement levels when they approve.

### Changing a live plan

- **Edit setup** changes targets and weights. It never touches the cycle.
- **More → Edit plan** opens the full plan. Click **Save plan**. If you
  change the cycle, it goes back to your manager for approval.

---

## 6. Logging check-ins

Manual trackers split the year into **windows**, one per period of the
tracker's cadence. Cadences are daily, weekly, every two weeks, monthly,
quarterly, per incident, per milestone, or continuous.

Weeks run Sunday to Saturday, with the work week Sunday to Thursday. A
Friday entry counts for the week you just worked. Week numbers (W39 and
so on) are the same on every page.

### How to log

1. Open the goal: from the home page button (**Fill this week**), or by
   clicking it on the Goals page.
2. Under **This cycle**, the window strip shows every window. Click one
   to open it.
3. Fill in the fields.
4. Click **Save**, or **Save & grade** when the goal has achievement
   levels. That saves the period and re-grades the goal.

Other buttons in a window:

- **Nothing to report**: nothing happened this period. It stops the
  window being flagged as missed. Click **Reopen** to undo.
- **Attach evidence**: drop a file, or click to choose. See below.
- **Grade window** / **Re-grade window**: grade just this window.
- **Back to [current window]** or **Close**.

If you leave with unsaved changes, the app asks before discarding them.

### What a window's colour means

| State | Meaning |
|---|---|
| logged | It has an entry. |
| missed | It ended without an entry. |
| current | The window you are in now. |
| upcoming | Still to come. |
| nothing to report | You settled it with **Nothing to report**. |
| before this tracker | It ended before the tracker existed. You can still backfill it. It is never counted as missed. |

### Evidence files per period

Inside a window, **Attach evidence** holds files for that period.

- Up to 10 MB per file.
- Allowed types include PDF, Word, Excel, PowerPoint, CSV, text,
  Markdown, images and ZIP.
- Up to 60 files per goal.
- Files always download when opened. They never open inside the app.
- Remove a file with the cross next to it.

### Goals someone else judges

If your manager or a peer decides whether a goal is met, use **More →
Delegate…**. The tracker is hidden and you stop logging on it. Click
**Self-track** on the card to take it back.

---

## 7. Grades and achievement levels

Each goal can have four levels: **Not achieved**, **Achieved**, **Over
achieved** and **Role model**.

- A tracker you build can have two ladders: one for the **whole cycle**
  and one for **each window**.
- The AI grades your goal against these levels from what you logged.
  It shows **Last graded …**.
- Grading runs at most once a day by itself. Click **Re-grade** to grade
  now.
- Click **Edit** to correct the criteria. Your edits are kept when the
  goal is re-analyzed.
- If a badge says **Set by your manager's policy**, the criteria come
  from your manager's rule for that Goal Code. Only a manager can change
  them.

### Manager verdicts

Your manager can grade a goal directly. That shows as **Manager
verdict**, and it outranks the AI grade.

Below a manager grade you can:

- Click **Mark as seen** to acknowledge it.
- Click **I disagree**, say what doesn't fit, and click **Send to
  [manager]**. Your manager sees it on your board.
- Click **History** to see every grade (**Grade history**).

---

## 8. The Goals page

The Goals page is titled **"Every goal, in one place."**

At the top is the same "Logged so far" summary as the home page, then one
tile per objective. Click a tile to show only that objective's goals.
Click it again (or the filter chip) to clear it.

### Three views

Switch with the **Focus / Timeline / Board** control. The app remembers
your choice on this device.

- **Focus**: a list of goals on the left. The selected goal is open on
  the right, with its widget, window strip and levels. This is where you
  log.
- **Timeline**: one row per goal across the 12 months of the year. Each
  month shows the worst state of the windows inside it.
- **Board**: goals sorted into status columns. The last column, **Not
  measured yet**, holds goals with no tracker, in setup, or auto-tracked.
  You can't drag cards. A card moves when you log.

### Buttons along the top

- **Classify N**: opens the analyst for goals without a tracker.
- **Missed only**: shows only goals with a missed window.
- **Comfortable / Compact**: row spacing.
- **Expand all / Collapse all**: objective groups. Not available in
  Board view.
- **Evidence**: opens a side panel with your weekly snapshots, recent
  commits and a link, **Open evidence builder**.

Shared goals from your manager appear under an objective called
**Assigned to you**. You can fill them, but not edit them.

---

## 9. The Evidence page

The Evidence page is titled **"Make the case."** It turns your goals,
readings and evidence into one document your manager can review.

Switch between **Board** and **Document** at the top.

### Board

- Every goal, grouped by objective, with its reading and evidence.
- On the right:
  - A **Review prep checklist** (for example, every goal has a tracker;
    **Snapshot captured this week**), with quick buttons such as
    **Classify** and **Capture**.
  - **Review packet**: your "Logged so far" number, status counts, the
    date of your **Last frozen packet**, and **Preview document**.
  - **Submit for review** (see [section 10](#10-review-packets)).
  - **Starred proof**: hand-picked pieces of work. Click **+ Add proof**
    and pick from **Recent work**.
  - **Linked on GitHub**: pull requests linked to your published
    goal issues.
- Below, a **GitHub** section shows the correlation report for goals you
  published (see [section 11](#11-publishing-a-plan-to-github)).

### Document (the document builder)

- On the left, **Configure bundle**:
  - **Window**: the date range covered.
  - **Your career level**: printed in the title. Leave it blank to
    leave it out.
  - **Include sections**: **Summary narrative** and **Goal readings**.
- On the right, a live preview of the document:
  - **Summary**: write a few sentences about the period.
  - Your goal readings, each with target and assessment.
  - **Not yet tracked**: goals with no tracker. They aren't in any
    number.
  - **Starred proof**.

### Exporting

- **Download .md** saves a Markdown file.
- **Export PDF** saves a PDF.

Both files are built in your browser. Nothing is sent anywhere.

If a reading is still loading from your code host, the app warns you
first. Wait a moment, or the file prints "Still loading" for it.

A **History capped** badge means your check-in history is very long. The
oldest entries aren't loaded, so totals read as "at least", not exact.

---

## 10. Review packets

A review packet is a frozen copy of your document, sent to your manager.

1. On the Evidence page, find **Submit for review**.
2. Pick a template:
   - **Scorecard**: every goal on one page, level and reading side by
     side.
   - **Journey**: the cycle window by window.
   - **Deck**: one goal per slide, for walking through in a meeting.
   - **Dossier**: the full record, with ladders, reasoning and proof.
3. Click **Submit packet**.
4. Read the confirmation (**Submit this packet?**). It warns you if some
   goals have no tracker, or show "No reading on this device". Click
   **Submit packet** (or **Submit anyway**).

Good to know:

- Resubmitting creates a newer version. Nothing is overwritten.
- If you have no manager yet, the packet is stored. A manager sees it
  once one is assigned.
- Click **View last submitted packet** to see what you sent. From there
  you can **Open full page** or **Download .md**.
- Each packet has its own page with a **Copy link** button. Only you,
  your current manager and admins can open it. Admin views are recorded
  in the audit log.

---

## 11. Publishing a plan to GitHub

A tracker built as a plan (with periods) can be published to GitHub: one
issue per period.

You need GitHub connected in Settings, and the plan must be approved.

1. On the goal's card, click **More → Publish to GitHub…**.
2. Pick a **Repository**, or **Another repository…** and type it as
   `owner/name`.
3. Tick the **Periods** you want (or **Select all**). Periods already
   published are locked and show their issue number.
4. Optional: **Preview an issue**.
5. Click **Create N issues**.

The issues are created with your own GitHub account.

### After publishing

- Tick the task list on GitHub as you go.
- The app reads your issues back about once an hour.
- Closing an issue as completed logs that period as done here. Closing
  it as "not planned" does not.
- Each period shows a chip with its state:

| Chip | Meaning |
|---|---|
| **Open on GitHub** (· 2/5 tasks) | Open. Closing it logs the period as done. |
| **Closed on GitHub** | Closed as completed. Logged as done. |
| **Closed · not planned** | Closed, but not logged as done. |
| **Publishing…** | The issue is being created. |
| **Publish failed** | Something went wrong. Publish again. |
| **Issue not found** | The issue was deleted or moved on GitHub. |
| **Reconnect GitHub** | GitHub rejected your saved token. Reconnect it in Settings. |
| **Not on GitHub** | This period has no issue. |

### The correlation report

On the Evidence page, the **GitHub** section lists each period with its
issue, linked PRs, grade and **Gaps**. Gaps are flagged as:

- **No evidence**: closed on GitHub, but nothing logged here.
- **Issue missing**: deleted or moved on GitHub.
- **Past due**: still open after the period's due date.
- **Not on GitHub**: logged here, but no issue.
- **Plan changed**: the plan changed after publishing. Publish again to
  update the issue.

When nothing is flagged, it reads "GitHub and eSpace agree on every
published period."

Your manager may post a 1:1 note or a grade as a comment on your issue,
using their own GitHub account.

---

## 12. Snapshots

A snapshot freezes one week of numbers. Next week's numbers are compared
with it to draw the up and down arrows on your goals.

Open **Snapshots** from the links under the home page title. The page is
titled **"Your trend, on record."**

### How snapshots are captured

- Each finished week is captured for you when you open the dashboard.
- If you didn't visit, a weekly server job captures it for you. That
  version only has your manual trackers, not your PR numbers. It is
  marked **Auto · partial**.
- **Snapshot now** adds a mid-week reading of the current week.

### On the page

- A trend chart. Pick the metric: **Merged PRs**, **Reviews given**,
  **Turnaround (hours)**, **Jira linkage** or **Rounds per MR**. It
  needs a few snapshots before it draws a line.
- A selected week, with **Compare to** another week, and a **Week note**
  (**Add note** / **Edit note**).
- **All snapshots**: one row per week. The **Source** column says
  **Auto**, **Auto · partial**, **Partial**, or manual.

If you use the desktop companion and it is offline, you are asked to open
it before capturing.

---

## 13. Reviews log (PR reviews)

Open **Reviews log** from the links under the home page title. The page
is titled **"Where review time goes."**

It lists every reviewed pull request of yours in the chosen date range,
newest merge first. For each one:

- **TTFR**: time to first review, from opening to the first reviewer
  comment.
- **ATTNR**: average time between one review round and the next. Needs
  two or more rounds.
- **Idle (Σ)**: total time the PR sat waiting on reviewers.
- **Reviewers**, and the comment threads. Line comments show the code
  they were left on.
- **Quick AI grade**: click **Grade with [provider]** for a **Pass** or
  **Needs work** verdict.

You need GitHub or GitLab connected. Otherwise the page shows **Connect
GitHub or GitLab**.

---

## 14. Shared goals

A manager can share one goal with many people.

- **Goals you fill**: they appear on your Goals page under **Assigned to
  you**. You log them like any other goal, but you can't edit them.
- **Analytics shared with you**: open **Shared with me** from the links
  under the home page title. The page is titled **"Shared with me."**

See [manager-guide.md](manager-guide.md) for how managers create them.

---

## 15. Notifications and email

### The bell

- The bell in the top bar shows your unread count.
- Click a notification to open the page it is about, for example that
  goal.
- **Mark all read** clears the count.
- **View all notifications** opens the full inbox. There you can filter
  **All** / **Unread** and click **Load older**.

You are notified when, for example:

- A manager grades one of your goals.
- A tracker you submitted is approved, or changes are requested.
- Grading criteria change on one of your goals.
- A goal is due within a week, is overdue, or hasn't been updated in a
  while.
- A shared goal is assigned to you, or is due.

### Email

Notifications are also emailed to you. Links in the email open the right
page in the app.

### Choosing what you get

Go to **Settings → Notifications**.

- **Email me**: turn email off or on. Password resets and invites always
  send.
- Under **Your goals**, **Reminders** and **Shared goals**, untick any
  kind you don't want. Unticked kinds don't reach your inbox, the bell
  or your email.
- Some kinds are locked on: "Always on — you're the one who acts on
  these".

Emails not arriving? See [faq.md](faq.md).

---

## 16. Settings

Settings has these tabs: **Goals & setup**, **Integrations**,
**Account**, **Notifications**, **Snapshots & privacy** and **Danger
zone**. If you use the Crealogix desktop app, there is also a
**Companion** tab.

### Integrations: connecting your tools

The tab is titled **"Your keys. Your terms."** The **Integration health**
table shows each tool as **Connected**, **Not connected** or **Needs
attention**, and what it feeds.

In the Dev Hub you can connect three tools:

**GitHub**

1. Click **Connect GitHub**.
2. Approve access on GitHub. You come back to this tab.

The app asks for the `repo` scope because GitHub has no read-only scope
for private repositories. It uses it to read your work, and to create
issues only when you publish a plan.

**GitLab**

1. Click **Create one on your GitLab**. The link fills in the token name
   and scopes for you: `read_api`, `read_user`, `read_repository`.
2. Paste it into **Personal access token**.
3. Click **Save & verify**.

**Jira**

1. Enter your Jira **Username** and **Password**: the same ones you use
   in the Jira website. (On the Crealogix engagement, it asks for an
   **Atlassian email** and an **API token** instead.)
2. Click **Save & verify**.

If GitLab or Jira says its URL "isn't set up yet", ask your admin.

Once connected, each tool has **Replace token** (or **Reconnect** for
GitHub) and **Disconnect**. Disconnecting deletes the saved token from
your account on every device. It does not cancel the token at GitHub,
GitLab or Jira. Do that there too.

If a token stops working, the card shows **Last error** and a
**Reconnect** link.

**How your tokens are kept**

- Tokens are stored encrypted on the server. They are never shown again
  after you save them.
- They are used only to fetch your own data.
- They follow your account, so a new device shows the same connections.
- Recent results (your PRs, tickets and builds, never tokens) are kept
  in your browser so pages load fast. They are cleared when you sign
  out.

**What the AI sees**

Text you type into AI features, and the text of documents you attach,
is sent to the AI provider you picked. Uploaded files are read in memory
and not kept. Don't attach anything you wouldn't send to that provider
directly.

### Account

- **Profile**: **Display name**, **Employee ID** and **Department**.
  Your **Email** is your sign-in. Ask your admin to change it. Click
  **Save changes**.
- **Security**:
  - **Two-factor authentication**: shows how many backup codes you have
    left. Use **Move to a new phone** or **Generate new codes**.
  - **Trusted browsers**: browsers that skip the code for up to 30 days.
    Click **Forget all** to make every browser ask again.
  - **Password**: **Reset password** sends a link to your email. A new
    password signs you out everywhere.
- **Preferences**:
  - **AI provider**: which model answers AI features.
  - **Last review date**: powers the "Since review" date range.

See [getting-started.md](getting-started.md) for two-factor and trusted
browsers in detail.

### Snapshots & privacy

- **Cycle history**: **Backfill now** rebuilds every finished week from
  your connected data. Snapshots you captured by hand are kept.
- **Snapshot schedule**: weekly. Kept for the whole calendar year. Stored
  in your account.
- **What we do and don't do with your data**:
  - No leaderboard. You are only compared with yourself.
  - Your manager can read your goals and packets. There is no org-wide
    dashboard.
  - No usage tracking.
  - At most two cookies: your session, and the trusted-browser cookie if
    you ticked "Trust this browser".

### Danger zone

Each action asks before it runs.

- **Export JSON**: download all your snapshots.
- **Clear snapshots**: delete all your snapshots, on every device.
- **Disconnect all**: remove every saved token.
- **Reset device**: wipe this browser's saved preferences, drafts and
  cached readings. Your goals, snapshots and grades are kept.

---

## Need more help?

- Troubleshooting: [faq.md](faq.md)
- Terms: [glossary.md](glossary.md)
- What your manager sees and does: [manager-guide.md](manager-guide.md)
- Admin tasks: [admin-guide.md](admin-guide.md)
- All manuals: [README.md](README.md)
