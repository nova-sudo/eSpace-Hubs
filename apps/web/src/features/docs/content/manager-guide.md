# Manager guide

This guide is for team leads who use the **Manager Hub**. It covers seeing your team, approving trackers, grading goals, setting tier policies, sharing goals, keeping 1:1 notes and reading review packets.

New here? Start with [getting-started.md](getting-started.md). Words in this guide are defined in [glossary.md](glossary.md). To recognise a goal widget, see the [widget gallery](widget-gallery.html).

## Before you start

- **You need the manager role.** An admin gives it to you on the Members page. See [admin-guide.md](admin-guide.md).
- **Your team is whoever has you as their manager.** An admin sets each person's manager. If nobody is assigned to you, the Team page says "No direct reports are assigned to you yet."
- **Your own goals live in the Dev Hub.** The Manager Hub is for your team. The **My goals** card on your Team page has an **Open my goals** button if you can reach the Dev Hub. If you can't, ask an admin to add the `dev` role. Your own manager grades you the same way you grade your team.
- **Connect GitHub if you want to post on issues.** The only integration the Manager Hub offers is GitHub. With it connected you can post a shared note or a grade on a report's GitHub issue, using your own account. Go to **Settings**, then the integrations section. See [developer-guide.md](developer-guide.md) for how tokens work.

## Finding your way around

The top bar of the Manager Hub has these pages:

| Menu item | What it is |
|---|---|
| **Team** | Your home page. Everyone who reports to you, and what they need from you. |
| **Delegated** | Goals your reports handed to you to judge. |
| **Approvals** | Trackers your reports built themselves, waiting for your yes or no. |
| **Goals & policies** | Shared goals you author, and tier policies by Goal Code. |
| **Shared with me** | Shared goals someone else lets you watch. |
| **Settings** | Your account, notifications and GitHub connection. |

There is no separate "Employees" item in the top bar. The Team page is the roster. Opening one person takes you to their board.

## Team page

The page is titled "Your team, at a glance."

### The overview strip

Three cards sit at the top:

- **Grading progress** shows how many of your team's goals you have graded this year, for example "4 of 11". It also shows how many grades your reports have seen and how many they disputed. **Compare the team** switches the list below to the Calibration view.
- **My goals** points you to your own goals (see above).
- **Team trend** shows one small chart per person: merged pull requests per week over the last 12 weeks. It comes from each person's weekly snapshots. If someone has none yet, the card says so. Snapshots are taken when a person opens their home page, and frozen weekly by the system.

### Search and filters

Use **Search name, email, role…** and **All departments** to narrow the list. The line beside them sums up the team, for example "6 reports · 24 goals · 9 graded · 2 approvals awaiting you". When nothing is waiting, it says "nothing awaiting you".

### Four views

Pick a view with the switch at the top right. The app remembers your choice on this device.

- **Table** — one row per person. People who need you most are at the top: open disagreements and unopened review packets first, then people falling behind. Columns are **Report**, **Logging** (their weakest goal, in the same words they see), **Last check-in**, **Packet** (New, Seen or None), **Graded**, **Your grades**, **Needs setup** and **Tier spread**.
- **Queue** — what you owe, grouped by person. Each item says what to do: **Disagrees**, **New packet**, **Grade**, **Approve** or **Delegated**. Only people with something outstanding appear.
- **People** — a list of your **Direct reports** on the left. Pick one to see where they stand on the right. A dot marks anyone who needs attention. The **Team tools** links go to Delegated, Approvals and Goals & policies.
- **Calibration** — everyone side by side for one **Grading period**. It counts your grades per tier, plus how many each person **Disputed** and has **Seen**. Use it to check that your "Achieved" means the same thing for everyone. Every column can be sorted.

## One person's board

Click a person on the Team page to open their board. The header shows their name, role and department, and how many goals still need your grade. Use **Team** to go back.

The header buttons:

- **Review packet** opens the latest review packet they submitted. For older packets it downloads a file instead.
- **Grade N ungraded** opens the grading panel on the first goal you haven't graded.

The board has four tabs: **Board**, **Consistency**, **Notes** and **GitHub**.

### Board

Goals are grouped under their objective, with the objective's weight (for example "Weight 20%"). Each goal has a **Grade** button, or **Regrade** if you already graded it. Goals your report handed to you carry a **Delegated to you** badge.

A side panel called **Where they stand** shows counts for **Goals**, **Graded**, **Needs setup** and **Delegated to you**. Their **Review packet** card is there too.

### Consistency

The same goals as a table: **Goal**, **Weight**, **AI verdict**, **Your grade** and **Delta**. Delta is how far your grade sits from the AI's suggestion. A goal you haven't graded reads "Not set". **Accept AI verdict** records a real grade that matches the AI's tier. The report is told, as with any grade.

### Notes (1:1 notes)

This is your running journal of 1:1s with this person.

1. Type in the **New note** box.
2. Choose who can read it: **Only you**, or **Shared with** the person.
3. Click **Add note**.

Notes appear newest first. Each one can be edited (**Edit**) or deleted (**Delete**). Deleting can't be undone. "Only you" notes are private to you. Not even a future manager can read them. You can change who sees a note at any time.

If you have GitHub connected and the person has published goals to GitHub, a shared note also offers **Post to GitHub…**. Pick the issue and click **Post**. It is posted under your own GitHub account. A note can only be posted once per issue.

### GitHub (correlation report)

This tab compares GitHub and eSpace for every goal the person published to GitHub, period by period. Columns are **Period**, **Due**, **GitHub issue**, **PRs**, **eSpace** (what they logged), **Grade** and **Gaps**.

A line at the top sums up the gaps, or says "GitHub and eSpace agree on every published period." The gap badges mean:

| Badge | Meaning |
|---|---|
| **No evidence** | Closed on GitHub, but nothing logged in eSpace: no text, no file, no merged pull request. |
| **Issue missing** | The issue was deleted or moved on GitHub. |
| **Past due** | Still open on GitHub after the period's due date. |
| **Not on GitHub** | Logged in eSpace, but this period has no GitHub issue. |
| **Plan changed** | The plan changed after the period was published. The issue needs republishing. |

If they have published nothing, the tab says "Nothing published to GitHub yet."

## Grading a goal

Click **Grade**, **Regrade** or **Grade this goal** to open the grading panel. It has two halves. You decide on the left. The evidence stays on the right.

**Left side, top to bottom:**

1. What the goal is and what the AI suggested, with its reasoning. If the AI hasn't graded the goal yet, the panel says so.
2. **Your grade** — pick one of four tiers:
   - **Not achieved** — below the agreed bar for the cycle.
   - **Achieved** — met the expectation for the role.
   - **Over achieved** — clearly exceeded the target.
   - **Role model** — set the standard others should follow.

   The AI's pick is marked **AI**. If you choose differently, the panel shows "You are overriding the AI" and how many steps apart you are. **Accept AI verdict instead** switches back.
3. **Note to the engineer (optional)** — explain what earned the tier. They see it with the grade.
4. If the goal has a GitHub issue and you have GitHub connected, you can tick **Also post this grade on the GitHub issue**.
5. Click **Save grade**. If nothing changed, the button reads **No changes**.

**Right side** has three tabs:

- **Numbers** — what was logged in each window, and how up to date they are.
- **Evidence** — files they attached, their GitHub issues per period, and the goal's own rubric.
- **History** — every grade ever given on this goal, by whom, when and why.

**What happens when you save:**

- Your grade replaces the AI's tier. The engineer is notified.
- Grades are never overwritten. Each new grade is added to the history.
- The grade is stored against the current grading period.

### When a report sees or disputes your grade

On their side, your report can click **Mark as seen** or **I disagree**. Disagreeing asks them to write what doesn't fit, and sends it to you.

You will see this in several places:

- In the grading panel, next to **Your grade**: "Not seen yet", "[Name] saw this on [date]" or "[Name] disagrees", with their note.
- On the Team page, as a **Disagrees** item in the Queue and a "disagreement" badge in the Table.
- In the Calibration view, under **Disputed**.

To respond, open the goal and grade it again. You can keep the same tier or change it. Either way, a new grade clears their acknowledgement, and they are told whether you kept or changed the tier.

## Delegated goals

Open **Delegated** from the top bar. The page is titled "Goals only you can score."

When a report uses **Delegate…** on one of their goals, they stop tracking it themselves. It lands here for you to judge.

- Filter with **Awaiting you**, **Graded** or **All**.
- Each card shows who, how long it has waited and any note they left (**Their note**).
- Click **Grade this goal**, or **Change grade** for one you already graded. It opens the same grading panel.
- A graded card shows **You graded**, the tier, the date and your note.

## Approvals (build-your-own trackers)

Open **Approvals** from the top bar. The page is titled "Custom trackers, on hold."

When a report builds their own tracker, it does not go live until you approve it. Nothing goes live behind your back.

The list on the left is oldest first. A badge shows how long each one has waited. It turns yellow after a week.

For each tracker you see:

- **Achievement levels** — the tiers the report will be graded against. There are two sets: **Whole cycle**, and one per window (for example **Each week**). Each set has four boxes, one per tier. Levels the AI wrote are marked **Suggested by AI**.
- **Fields captured each period** — what the report will fill in.
- **Fields read automatically** — fields that read themselves from GitHub or GitLab, each described in a plain sentence. Check these carefully. The AI picked them, partly from documents the report uploaded.
- The plan's periods, all shown, each with its own ask.

### Editing the tier levels before you approve

You can rewrite any level right there. Just type in the box. **Reset to AI** (or **Reset**) undoes your edits. If you clear a set completely, the suggested levels are kept.

What you see is exactly what gets saved. Once you approve, these levels are locked. Re-analysing the goal later will not overwrite them.

### Deciding

- **Approve with these levels** — the tracker goes live for the report with the levels shown.
- **Request changes** — write what should change, then click **Send back**.

Either way, the report is notified. If someone else already decided, you'll see "Already decided".

If a tracker waits more than a day, you get a reminder. If your queue has had something waiting more than three days, you get a "queue is going stale" reminder.

People with no manager, or whose manager is disabled, have their trackers sent to admins instead. See [admin-guide.md](admin-guide.md).

## Goals & policies

Open **Goals & policies** from the top bar. It has two tabs: **Shared goals** and **Tier policies**.

### Tier policies by Goal Code

A Goal Code is the short code on a goal, for example `DP-L0-2`. A tier policy sets the achievement levels for every goal carrying that code, across the whole org.

1. Type a code in **Goal Code — governs cycle [year]**. Matching codes appear with how many goals and people carry them. Pick one, or click **+ Govern code**.
2. If no goal carries that code, a yellow note warns you. It applies to nobody until a goal carries it.
3. Pick the code from the list on the left. You can open two codes side by side to compare them word for word.
4. Fill in the two ladders:
   - **Whole goal** — one grade across every period.
   - **Per window** — graded once per cadence window, for example one quarter.
5. Click **Save**. Everyone affected is notified.

Things to know:

- A policy applies to one year. This year's levels never grade next year's goals.
- A code on an L2 goal wins over its parent L1's code, field by field.
- A goal with no policy keeps its own levels, from the AI or written by its owner.
- A code that governs nobody shows a yellow **0 goals** or **matches no goals** badge.
- **Remove policy** sends matching goals back to their own levels.

### Shared goals

A shared goal gives a group of people the same thing to fill in, such as a weekly update or a monthly checklist. You see who is on time, who is late and who hasn't started.

**To create one:**

1. Click **New shared goal**.
2. Fill in **Title**. Optionally add a **Goal code (optional)** and a **Description (optional)**. If a tier policy already governs the code, it grades this goal.
3. Under **What people fill in**, click **Design the plan**. Describe what to track and how often, or attach a document. The AI drafts the form and schedule. Review it, then click **Use this plan**.
4. Set the **Grace period (hours)**. A submission counts as late after the due date plus this many hours.
5. Choose the **Deadline time zone**. "Due on the 25th" means the end of the 25th in that zone.
6. Pick **Assignees · fill it in** and **Viewers · see progress only**. You can pick anyone in the org.
7. Click **Share goal**.

**What assignees see:** the goal appears in their own goals under **Assigned to you**. It is read-only for them apart from filling it in. It never adds weight to their own goals.

**Tracking it:** pick the goal from your list. You see totals (**Assignees**, **Submitted**, **On time**, **Missing**) and a grid called "Who filled what, and when". Each cell is one person in one period:

| Cell | Meaning |
|---|---|
| **On time** | Submitted before the due date plus grace. |
| **Late** | Submitted after that. |
| **Missing** | Due and passed, nothing submitted. |
| **Open** | Due now, still time. |
| **Upcoming** | Not due yet. |
| **Before assigned** | Before this person was assigned. Never counted against them. |

Lateness is based on when the person first submitted for that period. Click a cell to see what they submitted. Sort with **Needs attention** or **Name**.

**Grading:** use the **Grade** button on a person's row, pick a tier and click **Save grade**.

**GitHub:** **Ask assignees to publish** asks every assignee to publish this goal's periods as GitHub issues. You give the repository in `owner/name` form.

**Reminders:** assignees get reminders when a period is due soon and when it is overdue. After each period's deadline, you and your viewers get a short report, for example "3 on time · 1 late · 1 missing".

**Editing and archiving:** **Edit** changes the goal. Plan changes apply to everyone. If people already submitted and the schedule changes, you are asked to confirm (**Keep schedule** or **Change schedule**). **Archive** removes it from everyone's goals and stops reminders. Its history stays under **Include archived**.

### Shared with me

If someone else made you a viewer of a shared goal, it appears on **Shared with me**. You can see its progress, but not edit it.

## Review packets

A review packet is a frozen record a report builds on their Evidence page and sends with **Submit for review**. It does not change after it is submitted.

- On the Team page, a new packet shows as **New** in the Table and **New packet** in the Queue.
- On a person's board, the **Review packet** card shows when it was submitted, how many goals it covers and the tier counts. **Open packet** opens it. **Download .md** saves it as a file.
- Older versions are listed below as "earlier versions".

A packet comes in one of four layouts, chosen by the person who submitted it:

| Layout | What it shows |
|---|---|
| **Scorecard** | Every goal on one page, tier and reading side by side. |
| **Journey** | The cycle window by window, showing how each goal moved. |
| **Deck** | One goal per slide, for walking through in a review meeting. |
| **Dossier** | The full record: ladders, reasoning and every piece of proof. |

On the packet page, **Copy link** copies its address. The link works for the owner, their current manager and admins. Anyone else sees "This packet isn't yours to see."

## Notifications

The bell in the top bar shows your notifications. As a manager you are told about trackers waiting for approval, stale approval queues, disagreements with your grades, and shared-goal period reports. You can mute kinds or turn off email in **Settings**, under notifications. See [developer-guide.md](developer-guide.md).

## Common questions

- **My team is empty.** An admin needs to set you as each person's manager on the Members page.
- **I can't see a person's board.** You get "That teammate isn't on your team." They no longer report to you.
- **No AI suggestion in the grading panel.** The AI hasn't graded the goal yet, or the goal has no scored levels. Grade from the numbers and the rubric.
- **I don't see the GitHub checkbox or Post to GitHub….** Connect GitHub in Settings. The report also needs to have published that goal to GitHub.

More answers in [faq.md](faq.md).
