# Getting started

This page takes you from "no account" to your first look at your hub. It takes about five minutes. Have your phone with you, because you will set up an authenticator app.

Other manuals: [index](README.md) · [developer guide](developer-guide.md) · [manager guide](manager-guide.md) · [admin guide](admin-guide.md) · [FAQ](faq.md) · [glossary](glossary.md) · [widget gallery](widget-gallery.html)

## The steps at a glance

1. Create your account.
2. Confirm your email.
3. Turn on two-factor authentication and save your backup codes.
4. Fill in a short profile.
5. You land on your hub.

There is no waiting for an admin to approve you. As soon as you open the email link, you are in.

## 1. Create your account

Open the sign-in page and choose **Create one** (under "Don't have an account?"). The page is titled **Create account**.

Fill in:

- **Display name** – the name your manager and teammates will see.
- **Email** – use your eSpace email.
- **Password** – at least 12 characters.

Then press **Create account**. If the button is greyed out, the line under it ("Still needed: …") tells you which field is empty.

### Signing up with a non-eSpace email

An `@espace.com.eg` address needs nothing extra. Any other email domain also needs a **Signup code**. The field appears on its own once you type a non-eSpace email. Ask your admin for a code.

Messages you may see:

- "This email isn't an eSpace address, so it needs a signup code from your admin."
- "Signup code is invalid or expired. Ask your admin for a current one."
- "An account with this email already exists. Try signing in instead."

### If you were invited instead

An admin can also invite you. In that case you get an email with a link to a page called **Activate account**. Pick a password (12 characters or more), confirm it, and press **Activate account**. Invite links last 7 days. After that you go straight to step 3 — you do not need to confirm your email again.

## 2. Confirm your email

After you create your account you see **Check your inbox**. We have sent a link to the email you used.

- The link works for 24 hours.
- You can open it on any device, for example your phone's mail app.
- The **Check your inbox** page notices on its own when you have opened the link, and moves on. You don't need to refresh it.

Nothing in your inbox? Look in your spam or junk folder first. Then press **Resend link**. You can ask for a new link once a minute (the button shows a countdown) and up to five times an hour.

Typed the wrong email? Press **Use a different email** to go back and sign up again.

If you open an old or already-used link you see **This link didn't work**. Press **Send a new link** to get a fresh one, or **Sign in** if your account is already confirmed.

## 3. Set up two-factor authentication

Every account uses two-factor authentication. This means that, as well as your password, you type a 6-digit code from an app on your phone.

You need an authenticator app, for example Google Authenticator, Microsoft Authenticator, 1Password or Authy.

On the **Two-factor** page:

1. Open your authenticator app and scan the QR code. (If you can't scan, type in the secret shown under the code instead.)
2. Your app now shows a 6-digit code for eSpace Hubs. Type it into **Code from your app**.
3. Leave **Trust this browser for 30 days** ticked if this is your own computer. Untick it on a shared computer.
4. Press **Verify & enable**.

If the code is rejected ("Code did not match"), wait for the next code in your app and try again. Codes change every 30 seconds.

### Save your backup codes

Next you see **Two-factor is on** and a list of 10 backup codes. Each code looks like `xxxx-xxxx` and works once, instead of the 6-digit code.

**This is the only time they are shown.** Press **Copy all** or **Download .txt**, and keep them somewhere safe — a password manager is ideal.

Below the codes is your **Authenticator secret**. It lets you add eSpace Hubs to a new authenticator app later. Keep it safe too.

When you have saved them, press **I've saved these — continue**.

## 4. Fill in your profile

The **Welcome to eSpace Hubs** page asks for three things:

- **Display name** (required) – filled in for you; change it if you like.
- **Department** (required) – tap one of the quick picks (Engineering, QA, Platform, DevOps, Frontend) or type your own. This is only for the org chart. Which hubs you can use is set by your admin, not by this field.
- **Employee ID** (optional) – whatever your HR system calls it.

Press **Finish setup**. You only do this once. You can change all three later under **Settings → Account**.

### Crealogix engagement only

If you work on the Crealogix engagement, there is one more step: **Connect the companion**. Crealogix's Jira and GitLab can only be reached from your own laptop, so eSpace Hubs talks to them through a small desktop app called the companion. Install it, pair it with your account and leave it running. The page shows "Companion connected." when it works. Then press **Enter eSpace Hubs**. Press **Check now** if it doesn't notice by itself.

## 5. Your first visit

You land on your home hub. Which hub depends on the role your admin gave you:

| Role | Where you land | First menu item |
|---|---|---|
| Developer | Dev hub | **Intelligence** |
| Manager | Manager hub | **Team** |
| Admin | Admin hub | **Overview** |
| QA | QA hub | **Overview** |

Good first things to do:

- **Connect your tools.** Open **Settings → Integrations** and connect Jira, GitLab and GitHub (and Jenkins if your team uses it). Without these, the automatic widgets stay empty. See the [developer guide](developer-guide.md) for details.
- **Add your goals.** See the [developer guide](developer-guide.md).
- **Check your notifications.** Under **Settings → Notifications** you choose which notices you get and whether we email you.

## Signing in next time

1. On **Sign in**, enter your **Email** and **Password**, then press **Continue**.
2. On **Enter your code**, type the 6-digit code from your app into **Authentication code** and press **Verify code**.

If you ticked **Trust this browser for 30 days**, that browser skips step 2 for 30 days. A different browser, a private window, or clearing your cookies will ask for the code again.

Signed into the wrong account at the code step? Press **Use a different account**.

You stay signed in while you use the app. After about 12 hours without any activity you are signed out, and you see "Your session expired — sign in to continue."

### Using a backup code

On **Enter your code**, press **Use a backup code instead**, type one of your codes and press **Use backup code**. Each code works once. After you use one, the app offers **Set up your new phone now** — use it if you have lost or replaced your phone.

## Lost or new phone

You can move two-factor to a new phone yourself:

1. Sign in (with a backup code if the old phone is gone).
2. Open **Settings → Account**. Under **Security → Two-factor authentication**, press **Move to a new phone**.
3. Confirm with your **Password** and either a code from your current app or a **Backup code**, then press **Continue**.
4. Scan the new QR code with your new phone, type the code into **Code from your new phone**, and press **Confirm new phone**.
5. You get a fresh set of backup codes. Save them.

Running low on backup codes? On the same page, press **Generate new codes**. You need a code from your app. The old codes stop working at once.

If you have neither your phone nor a backup code, ask your admin to reset two-factor. You will set it up again the next time you sign in.

## Forgot your password

1. On **Sign in**, press **Forgot password?**
2. On **Reset password**, enter your email and press **Send reset link**.
3. You see **Check your inbox**. For privacy, this page looks the same whether or not the email has an account.
4. Open the link in the email. It is valid for one hour and works once.
5. On **New password**, type your new password twice (12+ characters) and press **Update password**.
6. You see **Password updated**. For safety, every device is signed out. Sign in again with the new password.

Resetting your password also clears all your trusted browsers, so every browser asks for a 6-digit code next time.

You can also start a reset while signed in: **Settings → Account → Security → Password → Reset password**.

## Managing trusted browsers

Under **Settings → Account → Security → Trusted browsers** you see how many browsers currently skip the code. Press **Forget all** to clear them. You'll then be asked for a code on every browser next time.

Trusted browsers are also cleared when you reset your password, when you move or reset two-factor, or when an admin disables your account. Signing out does not clear them.

Having trouble? See the [FAQ](faq.md).
