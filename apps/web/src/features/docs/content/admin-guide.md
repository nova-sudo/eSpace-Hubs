# Admin guide

This guide is for people who run eSpace Hubs for the organisation. It covers members, signup codes, approvals with no manager, the org chart, hub and page settings, and the audit log.

New here? Start with [getting-started.md](getting-started.md). Words in this guide are defined in [glossary.md](glossary.md). The manager side of approvals and grading is in [manager-guide.md](manager-guide.md).

## Finding your way around

You need the `admin` role to open the **Admin** hub. Its pages are listed in a side menu called **Administration**, and in the top bar:

| Menu item | What it is |
|---|---|
| **Overview** | What needs you today, and what changed. |
| **Members** | Everyone with an account, with their status, roles and manager. Signup codes are at the bottom of this page. |
| **Org chart** | Who reports to whom. |
| **Approvals** | Build-your-own trackers from people with no manager to approve them. |
| **Hubs & pages** | Which hubs and pages the org can see, and which integrations each hub offers. |
| **Audit log** | A history of every privileged action. |
| **Settings** | Your own account settings. |

If an admin hides one of these pages in Hubs & pages, it disappears from the menu as well.

## Overview

The page is titled "Org administration."

**Four counters at the top:**

- **Members** — the total, with how many are active and invited.
- **Unverified signups** — people who signed up but haven't opened their verification email. Shows "everyone confirmed" when there are none.
- **Without two-factor** — people who haven't set up an authenticator. Shows "everyone enrolled" when there are none.
- **Events today** — audited actions today, including configuration changes.

**Three gap cards below**, each linking to the matching list:

- People with no manager. Their tracker approvals come to admins.
- Reports whose manager is disabled. Reassign them from the manager's row on Members.
- Trackers waiting on admins.

**Needs a decision** lists unverified signups (each with a **Resend link** button) and any hub hidden from the org. **Recent changes** shows the latest audit entries.

## Members

The page is titled "Members of your org." Everyone appears exactly once. Status is a filter, not a separate list.

### Statuses

| Status | Meaning |
|---|---|
| **Active** | Can sign in and use the app. |
| **Invite sent** | An admin invited them. They haven't used their one-time setup link yet. (The filter for this is called **Invited**.) |
| **Unverified** | They signed up themselves but haven't opened the verification email yet. |
| **Disabled** | Signed out and blocked from signing in. Their data is untouched. |

There is no admin approval step for new accounts. A self-signup becomes **Active** as soon as they open the link in their verification email. The link lasts 24 hours.

### Finding people

- Click a status chip (**All**, **Active**, **Invited**, **Unverified**, **Disabled**) to filter.
- Use **Search name or email**.
- Links from the Overview and Org chart can add a filter such as "People with no manager". Click the × to clear it.
- **Load more** fetches the next 50.

### Two views

- **Table** — columns **Member**, **Status**, **Roles**, **Manager**, **Last seen**. Tick rows to act on several people at once.
- **Detail** — the list with a side panel for the person you pick.

Click any row to open that person's panel.

### Inviting people

1. Click **Invite**.
2. Type one or more **Email addresses**, separated by commas or spaces.
3. Pick the **Roles**. Everyone in this batch gets the same roles.
4. Pick the **Hubs they can reach**. At least one is required.
5. Optionally choose who they **Reports to**. This puts them on that manager's team.
6. Check **What they will see** on the right. It shows what the chosen roles unlock, and warns about any hub the roles don't grant.
7. Click **Send invite** (or **Send N invites**).

Each person gets a one-time setup link by email. If someone with that email already exists, you'll be asked to edit them from the list instead.

### Resending a verification link

For an **Unverified** person, open the **⋯** menu on their row and choose **Resend verification link**. You can also use **Resend link** on the Overview.

Ask them to check their spam folder too. See [faq.md](faq.md).

### Editing one person

Open their panel. It has three tabs: **Details**, **Access** and **Activity**. Edit what you need and click **Save changes**. Changes apply on their next click. They don't need to sign out.

**Details tab:**

- **Display name**.
- **Status** — set Active or Disabled here too. You can't disable yourself.
- **Engagement** — eSpace or Crealogix. This decides which company's Jira and other tools their data comes from.
- **Manager** — who they report to. Only active members with the manager role can be picked. With no manager, their tracker approvals go to admins. The app refuses a reporting loop.
- Read-only facts: **Two-factor** (Enrolled or Not enrolled), **Password**, **Onboarding**, **Last seen**, **Added**.

**Access tab:**

- **Roles** — a person can hold several. What they can do is everything their roles allow, combined. You can't remove your own admin role, and everyone needs at least one role.
- **Allowed hubs** — the hubs they can switch into. Ticking a hub their roles don't unlock has no effect.
- **Primary hub** — where they land after signing in.
- **Recovery and cleanup** — **Reset two-factor** and **Wipe dashboard data**.

**Activity tab** shows that person's audit history.

### Roles

| Role | What it unlocks |
|---|---|
| `admin` | The Admin hub, members, hub settings, the audit log, and creating shared goals. |
| `dev` | The Dev Hub. |
| `qa` | The QA Hub. |
| `manager` | The Manager Hub and their reports' data. |
| `hr`, `po` | Reserved. They unlock nothing yet. |
| `member` | Older accounts may carry it. It unlocks nothing. |

A manager who also tracks their own goals needs both `manager` and `dev`.

### Resetting two-factor (lost authenticator)

Use this when someone has lost their authenticator app and their backup codes.

1. Confirm the request is genuine, in person or on a video call.
2. Open the **⋯** menu on their row, or their **Access** tab, and choose **Reset two-factor**.
3. Confirm.

Their old authenticator stops working at once. They set up a new one at next sign-in. Resetting two-factor also removes their trusted browsers, so they will be asked for a code again.

You can't reset your own two-factor here. The option only appears for people who have one set up.

### Disabling and re-activating

- Open the **⋯** menu and choose **Disable account**, then confirm. They are signed out and can't sign back in. Their data stays.
- If they manage people, you are asked to move their team first. Choose a new manager in **Move the team to** and click **Reassign & disable**. Or click **Disable only**, and their reports' approvals go to admins.
- To undo, choose **Re-activate** from the same menu.

### Reassigning a manager's team

For anyone with reports, the **⋯** menu offers **Reassign N reports…**. Pick the new manager in **Move the team to** and click **Reassign**. Everyone moves in one step, pending approvals included. You can also choose "No manager (approvals go to admins)".

### Wiping dashboard data

**Wipe dashboard data** deletes a person's goals, snapshots, AI verdicts, trackers, answers and logged entries. Their account, integrations and sessions stay. This can't be undone.

### Deleting an account

There is no way to delete an account in the app today. The closest options are **Disable account** (blocks sign-in, keeps data) and **Wipe dashboard data** (removes goal data, keeps the account).

### Acting on several people

Tick the boxes in Table view. A dark bar appears with **Add role…**, **Reset two-factor**, **Activate**, **Disable** and **Clear**. You are left out of any action that can't apply to you, such as disabling yourself.

## Signup codes

Scroll to the bottom of **Members** and open **Signup codes**.

People with an `@espace.com.eg` email can sign up without a code. Anyone else needs a code from you.

1. Type a **Code**, for example `ESPACE-2026`.
2. Optionally set **Expires (optional)**.
3. Click **Mint code**.
4. Share the code with the person yourself, outside the app.

Each code shows how many times it was used and when it expires. **Disable** stops a code working. **Enable** turns it back on. Expired and disabled codes are refused at signup.

## Approvals with no manager

Open **Approvals**. The page is titled "Trackers with no manager to approve them."

Build-your-own trackers never go live without review. When the owner has no manager, or their manager is disabled, the decision comes to admins. Any admin can decide.

Each card shows the tracker, the person, and why it is here: **No manager** or **Manager disabled**.

- **Achievement levels** — edit the **Whole cycle** and per-window levels before approving, just as a manager would. See [manager-guide.md](manager-guide.md).
- **What they'll log** and **Plan** show the fields and periods.
- **Approve with these levels** puts the tracker live.
- **Request changes** asks for a note under **What should change?**, then **Send back**.
- **Assign a manager** takes you to that person on Members. Once they have a manager, future trackers go to the manager instead.

Admins also get a reminder when a tracker has waited more than a day, and when the queue has had something waiting more than three days.

## Org chart

Open **Org chart**. The page is titled "Who reports to whom." It is built from each member's manager.

Four counters sit at the top: **No manager**, **Disabled manager**, **Reporting loops** and **Largest team**. Click **No manager**, **Disabled manager** or **Largest team** to see those people on Members. Any reporting loops are listed below the counters.

Below is the tree. Click the arrow next to a manager to open or close their team. Click a name to open that person on Members. Use **Find a person** to search.

Badges in the tree flag problems:

| Badge | Meaning |
|---|---|
| **No manager** | Their approvals go to admins. |
| **Manager disabled** | Their manager can't sign in. |
| **Manager not found** | Their manager's account no longer exists. |
| **Manager lacks role** | Their manager doesn't have the manager role. |
| **Reporting loop** | The chain circles back on itself. |

## Hubs & pages

Open **Hubs & pages**. The page is titled "What each hub exposes."

There is a checkbox for each hub and each page. Switch between **By hub** and **By page** to see the grid either way.

- **Untick a page** to hide it from a hub. You are asked to confirm (**Hide the page**). Everyone loses that page on their next page load, and links to it stop working.
- **Hide a whole hub** with its **Visible** / **Hidden** switch, then **Hide the hub**. Everyone loses the hub. Anyone whose primary hub it was is moved to another. Nothing is deleted.
- **Integrations per hub** — choose which providers (GitHub, GitLab, Jira, Jenkins) each hub offers.
- **Revert to defaults** drops every change on that hub and goes back to the shipped settings.

A hub you changed shows a **Custom** badge. A hidden hub shows **Hidden**, and also appears under **Needs a decision** on the Overview.

## Audit log

Open **Audit log**. The page is titled "Privileged-action history."

The log can't be edited. It records invites, role and manager changes, hub changes, password resets, connecting and disconnecting integrations, manager grades, tracker approvals, tier-policy edits and snapshot changes. It also records when an admin opens someone's review packet.

- Columns: **When**, **Action**, **Actor**, **Target**.
- Filter with **Action**, **Actor** and **Target type**. Filters need an exact match, so a typo returns nothing.
- Open a row to see **Before** and **After**, plus the IP address and browser.
- **Load older** fetches more. **Export CSV** downloads every row that matches your filters.

## Shared goals as an admin

Admins can see shared goals they were made a viewer of on **Shared with me**. The page for creating shared goals and tier policies (**Goals & policies**) is only in the Manager Hub. An admin who needs to author them should also hold the `manager` role.

More answers in [faq.md](faq.md).
