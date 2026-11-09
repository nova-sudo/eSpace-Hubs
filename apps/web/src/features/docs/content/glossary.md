# Glossary

The words you will see in eSpace Hubs, in plain language. Terms are in
alphabetical order. For pictures of every widget, see the
[widget gallery](widget-gallery.html).

**Approval.** A tracker you build yourself is not live until it is
approved. It goes to your manager. If you have no manager, or your
manager's account is disabled, it goes to the org admins. It is never
approved automatically. While waiting, the card shows **Pending
approval**. If the reviewer wants changes, it shows **Changes requested**
and a **Revise & resubmit** button. See the
[developer guide](developer-guide.md#5-build-your-own-tracker-and-manager-approval).

**Assigned goal (shared goal).** A goal a manager writes once and assigns
to many people. It appears in your goals as a read-only item with an
**Assigned by …** chip. You log on it, but it does not count toward your
own goal weights. See the [manager guide](manager-guide.md#shared-goals).

**Automatic widget.** A widget that reads its number from your tools
(GitLab, GitHub, Jira, Jenkins or GitHub Actions). You never type into
it. It counts from 1 January of the current year, shown as "YTD" (year
to date).

**Backfill.** Logging a window after it has passed. Click the window's
square in the cadence strip. Windows from before the tracker existed can
be backfilled too, but they never count as missed.

**BYO (build your own) tracker.** A tracker you describe in your own
words, which the AI turns into a form. Reach it through **Build my own
tracker** under a goal's **More** menu, or **None of these fit? Build
your own tracker**. It needs approval before you can log on it.

**Cadence.** How often a goal asks you to log: daily, weekly, every two
weeks, monthly, quarterly, per incident, once (a milestone) or
continuously. Weeks run Sunday to Thursday, and the week number (W45,
for example) is the same one used by snapshots.

**Cadence window (window).** One slot of a cadence, for example "W45" or
"Nov". Each window is in one of these states: **logged**, **missed**,
**current**, **upcoming**, **nothing to report** (you settled it because
nothing happened) or **before this tracker**.

**Companion.** A small desktop app for the Crealogix engagement only.
Crealogix's Jira and GitLab can only be reached from your own laptop, so
eSpace Hubs talks to them through the companion. When it is offline,
data from those tools stops (the app shows "Desktop companion offline")
rather than showing stale numbers.

**Composed plan (composed tracker).** A tracker built from a set of
fields (yes/no, count, 1–5, number, note, date, choice, link), with one
form per window. A plan imported from a document can give each window
its own name, due date, fields and **Brief** (focus, activities,
deliverables). Some fields read themselves from GitHub or GitLab. A plan
can also be published to GitHub as one issue per window.

**Cycle.** The period a goal runs over. By default this is the calendar
year. A composed plan can have its own start and end, taken from the
document it came from; check it with **Edit plan**.

**Data chip.** The small sky-coloured chip under an automatic widget, for
example "n=46 MRs · 2026 YTD · updated 4 min ago". It tells you what the
number is made of. It turns lemon when the number is partial or the last
refresh failed. Click it to refresh all your tool data.

**Delegated.** A goal you have handed to someone else to judge (for
example your manager), with **Delegate…** under **More**. Its tracker is
hidden and you stop logging on it. **Self-track** takes it back.

**Evidence.** Anything that backs up what you logged: the "Proof" next to
an answer, an evidence link, or a file attached to a window with **Attach
evidence**. The Evidence page gathers it all and can export it as `.md`
or `.pdf`.

**Floor (lower bound).** A number that can only be too low, never too
high. Label-based widgets are floors because a pull request nobody
labelled is invisible to them. Ticket-type widgets are floors because a
pull request with no Jira key can't be matched.

**Goal (L2).** One thing you are measured on. It sits under an
objective (L1) and has its own weight and, usually, a tracker.

**Goal Code.** The short code on a goal from the performance plan, for
example `DP-L0-2`. Managers use it to set tier policies that apply to
every goal with that code.

**Hub.** A workspace for one role. The Dev Hub is for engineers, the
Manager Hub for people leads, and the Admin Hub for org admins. Each has
its own top bar and home page. One person can have access to several.

**Ladder.** The set of four tier descriptions for a goal: what
"Not achieved", "Achieved", "Over achieved" and "Role model" mean. A goal
can have one ladder for the whole cycle and another for each window.

**Manual (logged) widget.** A widget you fill in yourself, such as a
counter, checklist, date log or composed plan. It shows a cadence strip
under the card.

**Objective (L1).** A heading from your performance plan. Goals (L2) sit
under it. Each objective has a weight.

**Partial.** A data chip marked "(partial)" means a fetch limit was hit.
Jira reads the 50 most recently updated tickets, CI reads the last 100
builds, and GitHub review comments are loaded for the 30 newest pull
requests. A partial snapshot is one the system captured for you
automatically, with your logged trackers only.

**Review packet.** A frozen copy of your goals, evidence and grades,
sent to your manager for a review conversation. It is shown as one of
four templates: scorecard, journey, deck or dossier.

**Snapshot.** A weekly freeze of your numbers. One is taken when you
visit your dashboard (or press **Snapshot now**). If you don't visit,
the system freezes the week for you with only your logged trackers.
Snapshots power the "on target · N of M weeks" lines on widgets.

**Spec.** The app's internal word for a tracker's setup. You will rarely
see it.

**Tier.** One of four achievement levels a goal (or one window) is graded
on: **Not achieved** (peach), **Achieved** (mint), **Over achieved**
(sky) and **Role model** (lilac).

**Tier policy.** A manager's rule that sets the ladder for every goal with
a given Goal Code, for a given year. A policy outranks the ladder the AI
suggested.

**Tracker.** The widget attached to a goal that measures it. The AI
picks one when you run **Analyze my goals**, or you build your own.

**Verdict.** A tier grade on a goal or window. The AI gives one when
asked. A manager's verdict outranks the AI's. Manager verdicts are kept
as a history. You can acknowledge one with **Mark as seen** or dispute
it with **I disagree**.

**Widget.** The card that shows a tracker. See the
[widget gallery](widget-gallery.html) for every kind.
