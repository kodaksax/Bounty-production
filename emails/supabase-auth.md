# Supabase Auth emails (v2)

Supabase Auth sends these itself, not Resend, so they are pasted into the
dashboard instead of deployed. Open **Supabase → Authentication → Emails**
(the Templates tab). For each template, set the subject, then replace the body
with the full contents of the file. Use the `.html` file; Supabase sends HTML
only.

| Dashboard template | Subject | Paste this file | Sent when |
|---|---|---|---|
| Confirm signup | `Confirm your email to start using Bounty` | `templates/auth-confirm-signup.html` | Rare: app and checkout accounts are created already confirmed, so only a confirmation resend triggers it |
| Magic link | `Your Bounty sign-in code` | `templates/auth-magic-link.html` | Sign-in by email code (`signInWithOtp`) |
| Reset password | `Your link to get into Bounty` | `templates/auth-reset-password.html` | Forgot password in the app **and** account access for people who paid for a bounty on bountyfinder.net |
| Change email address | `Confirm your new email for Bounty` | `templates/auth-change-email.html` | An email change (no app screen does this today) |
| Reauthentication | `Your Bounty confirmation code` | `templates/auth-reauthentication.html` | A confirmation code before a sensitive change (not used by the app today) |
| Invite user | `You're invited to Bounty` | `templates/auth-invite.html` | Someone is invited from the Supabase dashboard |

## Two things to get right

**Magic link must keep `{{ .Token }}`.** The app's sign-in form asks for the
6-digit code from the email (`verifyOtp` with type `email`). A template
without the code would make that sign-in impossible. The v2 template shows
the code large, plus a button for people on a computer.

**Reset password does two jobs.** The Stripe webhook uses the same email
(`resetPasswordForEmail`) to give people who just paid on bountyfinder.net a
way into their new account. The copy works for both: "Here's your way in",
plus a short note for new web posters.

## Placeholders used

`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` and
`{{ .NewEmail }}` are Supabase's own. Leave them exactly as written.

## After pasting

Send yourself one of each from a test account: a sign-in code, a password
reset, and, if you use it, an invite. Check that:
- the code works in the app
- the button opens the right screen
- the email looks right on your phone in light and dark mode

To undo, paste back the previous body. Supabase keeps no template history, so
copy the current bodies somewhere before replacing them.
