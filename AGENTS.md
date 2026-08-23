# Repository agent instructions

## Local authenticated dashboard testing

Use the development login helper when an authenticated dashboard check is needed:

```bash
pnpm dev:login -- <existing-firebase-email-or-uid>
```

- Start the web app on `http://localhost:3000` and the API on
  `http://localhost:3001` first.
- Prefer the `DEV_AUTH_USER` value from `apps/web/.env.local` when it is already
  configured; with that value present, run `pnpm dev:login` without an identity.
- If `DEV_AUTH_USER` is absent and the intended account is not clear from the
  user's request, ask which existing Firebase Authentication user to use. Do not
  guess an account or create one solely to bypass sign-in.
- Use `--from=/dashboard/...` to open a specific dashboard route.
- The default command opens the login URL without printing its short-lived
  Firebase custom token. Prefer this mode for manual testing.
- Use `--print` only when a controlled browser must navigate to the generated
  URL. Treat the entire printed URL as a secret: do not quote it in commentary or
  final responses, save it to a repository file, include it in screenshots, or
  commit it. Navigate once and allow the login page to remove the fragment.
- Never weaken the production authentication path to make local testing easier.
  The helper and the login-page token exchange must remain development-only and
  restricted to loopback HTTP URLs.
- The helper requires `FIREBASE_SERVICE_ACCOUNT_KEY` in
  `apps/web/.env.local` or working Google Application Default Credentials.

