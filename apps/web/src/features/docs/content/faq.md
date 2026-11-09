# FAQ and troubleshooting

Quick answers to the problems people hit most. If yours isn't here, ask your admin.

Other manuals: [index](README.md) · [getting started](getting-started.md) · [developer guide](developer-guide.md) · [manager guide](manager-guide.md) · [admin guide](admin-guide.md) · [glossary](glossary.md) · [widget gallery](widget-gallery.html)

## Signing up and email

### The confirmation email never arrived

1. Check your spam or junk folder. Mail filters sometimes catch it.
2. Make sure the address on **Check your inbox** is right. If not, press **Use a different email** and sign up again.
3. Press **Resend link**. You can do this once a minute, up to five times an hour.
4. Still nothing after a few minutes? Ask your admin. Admins can see your account as "Unverified" and resend the link for you.

The link lasts 24 hours and works on any device. You don't have to open it in the same browser.

### The link says "This link didn't work"

The link has expired (after 24 hours) or was already used. Some mail systems open links automatically to scan them, which can use up the link. If your account is already confirmed, just press **Sign in**. Otherwise press **Send a new link**.

### It asks me for a signup code

Only `@espace.com.eg` emails sign up without a code. Any other email needs a **Signup code** from your admin. If the code is rejected ("Signup code is invalid or expired"), ask for a current one.

### "An account with this email already exists"

You (or an admin, through an invite) already created it. Go to **Sign in**. If you don't know the password, use **Forgot password?**.

### I'm not getting notification emails

Open **Settings → Notifications**:

- **Email me** must be ticked. When it's off, eSpace Hubs sends you no notification emails at all. Password resets and invites still arrive.
- Each notice type below it can be muted. A muted type doesn't appear in your inbox, the bell, or your email. Some types are locked on ("Always on — you're the one who acts on these").

Then check your spam folder. If nobody on your team gets any email, tell your admin — the mail server may not be set up.

## Signing in

### "Invalid email or password", but I'm sure the password is right

Possible reasons:

- **Too many wrong tries.** After 5 wrong passwords in a row, the account is locked for 15 minutes. During that time even the right password shows this message. Wait, then try again.
- **Your account was disabled** by an admin. Ask your admin.
- **A typo in the email.** Check for an extra space or a different domain.

If you really don't remember the password, use **Forgot password?**.

### Why does it ask for a code again? I ticked "Trust this browser"

**Trust this browser for 30 days** only covers that one browser, on that one computer. You will be asked again when:

- 30 days have passed.
- You use another browser, a private or incognito window, or another computer.
- You cleared your cookies.
- You reset your password.
- You moved two-factor to a new phone, or an admin reset it.
- You (or an admin) pressed **Forget all** under **Settings → Account → Security → Trusted browsers**.
- An admin disabled your account.

Signing out does not remove the trust.

A browser is only trusted after a 6-digit code from your app. Signing in with a backup code never trusts the browser.

### "Code did not match"

- Wait for the next code — codes change every 30 seconds — and type it quickly.
- Check that your phone's clock is set automatically. A phone clock that is a few minutes off makes every code wrong.
- Make sure you are reading the eSpace Hubs entry in your app, not another account.

### I was signed out with "Your session expired"

After about 12 hours with no activity, you are signed out for safety. Sign in again. Your work is saved on the server, so nothing is lost.

## Two-factor and lost phones

### I lost my phone, or got a new one

If you still have a backup code:

1. On **Enter your code**, press **Use a backup code instead** and sign in with one.
2. Open **Settings → Account** and press **Move to a new phone**. The app also offers **Set up your new phone now** right after a backup-code sign-in.
3. Confirm with your password and a backup code, scan the new QR code, and save your new backup codes.

If you still have the old phone, you can use a code from it instead of a backup code.

If you have neither the phone nor a backup code, ask your admin to reset two-factor. Then sign in with your password and set up two-factor again.

### I lost my backup codes

If you can still sign in with your phone, open **Settings → Account** and press **Generate new codes**. You'll need a code from your app. The old codes stop working at once. The account page shows how many codes you have left, and you'll see a warning at sign-in when none are left ("You have no backup codes").

### "That backup code didn't work"

It may be mistyped, or already used. Each backup code works only once. Try another one.

## Passwords

### The reset email didn't arrive

The **Check your inbox** page looks the same whether or not the email has an account. This protects your privacy. So first check that you typed the email you signed up with. Then check spam, and press **Forgot password?** again.

### "Reset link is invalid or expired"

Reset links last one hour and work once. Request a fresh one from **Forgot password?**.

### After resetting, I'm signed out everywhere

That's on purpose. A new password signs out every device, including the one you're using, and clears your trusted browsers. Sign in with the new password.

## Missing or odd numbers

### A widget is empty, or says a provider is not connected

The automatic widgets read your work from Jira, GitLab, GitHub and Jenkins. They need you to connect each tool first:

1. Open **Settings → Integrations**.
2. Under **Integration health**, check the status of each provider: **Connected**, **Not connected** or **Needs attention**.
3. For **Not connected**, fill in the form on that provider's card and press **Save & verify** (Jira, GitLab, Jenkins), or press **Connect GitHub**.
4. For **Needs attention**, read the "Last error" line. Usually the token has expired or been revoked. Press **Reconnect** or **Replace token** and paste a new one.

Each provider card lists what it "Affects", so you can see which widgets depend on it.

Some providers are hidden in hubs that don't use them. If you can't find one, the Integrations tab tells you how many are hidden and suggests switching hubs.

### I saw "Desktop companion offline"

This only applies to the Crealogix engagement. Your Jira and GitLab are reached through the companion app on your laptop. When it is closed, asleep, or lost its connection, the app can't fetch your PRs, tickets or reviews. Reopen the companion and leave it running. Press **How to fix** on the message, or open **Settings → Companion**, for setup help.

### The number looks old

Under each automatic widget there is a small chip. It shows how many items the number is based on and when it was last fetched (for example "updated 5 min ago"). Click the chip to fetch fresh data for every widget at once. If it says "last refresh failed" or "rate limited until …", the number you see is the last good one; try again later.

### Why does it say a number is "a floor" or a "lower bound"?

Some widgets can only count what they can see. The real number may be higher, never lower.

- **Labelled PRs** and **assisted PRs** count merged PRs that carry a certain label. A PR nobody labelled is invisible, so it isn't counted.
- **Ticket-type PRs** (for example "share of PRs that fix bugs") need a Jira key in the PR's title, description or branch. PRs without one are shown as "unresolved", not as "not a bug".

To make these numbers more complete, label your PRs and put the Jira key in them.

### Why does a chip say "(partial)"?

Some sources are capped, so the number is a sample:

- **Ticket cycle time** uses your 50 most recently updated Jira tickets.
- **CI/CD widgets** (deploy frequency, lead time, pass rate) use the last 100 builds.
- **GitHub review comments** are read for your 30 most recent PRs.

The chip turns yellow and says "(partial)" when a cap was reached.

### A tracker says "Pending approval"

Trackers you build yourself wait for your manager to approve them. If you have no manager, they go to your admins. They are never approved automatically. If it says "Changes requested", open it to read what your reviewer asked for. See the [developer guide](developer-guide.md).

### Some check-in windows show as "before"

Windows that start before you created the tracker (or before your hire date) are marked "before". You can fill them in if you like, but they never count as missed. See the [widget gallery](widget-gallery.html) for what each state looks like.

### A weekly snapshot says "partial"

If you don't open the app in a given week, the server saves that week for you. It can only save the numbers you log yourself, not the automatic provider numbers, so it is marked partial. A snapshot taken while you're using the app always has the full set.

## Profile

### How do I change my name, department or employee ID?

**Settings → Account → Profile**. Change the field and press **Save changes**.

### How do I change my email?

You can't change it yourself. Ask your admin.

### I can't see a hub I need

Which hubs you can use comes from the roles your admin gives you, not from your department. Ask your admin.
