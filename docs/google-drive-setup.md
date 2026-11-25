# Google Drive setup for share links

Share links store a session's clips in a Google Drive so anyone with the link can
download their own copy into the app. This is a one-off setup in Google Cloud,
about 15 minutes. You end up with two values to put in the app: a **client ID**
and an **API key**. Both are meant to be public; they only work from the app's
own web address.

Do every step signed in as **the Google account whose Drive will hold the shared
sessions**. That's also the account to sign in with in the app when sharing: the
app can only upload to the Drive of whoever signs in.

Google rearranges this console from time to time, so names may differ slightly.

## 1. Create a project

1. Go to <https://console.cloud.google.com/> and accept the terms if asked.
2. Click the project picker at the top → **New project**.
3. Name: `Killeshin Match Analysis`. Leave the location as it is. **Create**.
4. Make sure the new project is selected in the project picker.

## 2. Turn on the Google Drive API

1. Go to <https://console.cloud.google.com/apis/library/drive.googleapis.com>
   (check the new project is selected at the top).
2. Click **Enable**.

## 3. Set up the sign-in screen

This is what Google shows when you sign in from the app to share.

1. Menu (☰) → **Google Auth Platform** → **Branding**. If it says "not configured yet", click **Get started**.
2. **App information**: App name `Killeshin Match Analysis`; User support email: your address. **Next**.
3. **Audience**: choose **External**. **Next**.
4. **Contact information**: your email address. **Next**.
5. Tick the agreement to the Google API Services User Data Policy, then **Continue** → **Create**.
6. Menu → **Google Auth Platform** → **Data Access** → **Add or remove scopes**.
   In "Manually add scopes" paste `https://www.googleapis.com/auth/drive.file`,
   click **Add to table**, tick it, **Update**, then **Save**.
   This lets the app see and change **only the files it creates itself**, nothing
   else in your Drive. Google rates it as non-sensitive, so no app review is needed.
7. Menu → **Google Auth Platform** → **Audience**. Leave **Publishing status** on
   **Testing** (publishing needs a home page and privacy policy, which this app
   doesn't need). Under **Test users** → **Add users**, add the Google account
   whose Drive holds the shared sessions → **Save**.
   Testing only limits who can *sign in to share*, which is just you. People
   opening links never sign in, so it doesn't affect them.
   When you sign in from the app, Google shows "Google hasn't verified this app":
   click **Continue** (or **Advanced** → **Go to Killeshin Match Analysis**).
   Don't upload a logo: it triggers Google's brand check.

## 4. Create the sign-in key (OAuth client ID)

1. Menu → **Google Auth Platform** → **Clients** → **Create client**.
2. Application type: **Web application**. Name: `Match Analysis web app`.
3. **Authorized JavaScript origins** → **Add URI** for each of these (no slash at the end):
   - `https://lawlordylan.github.io`
   - `http://localhost:5173` (the dev server)
   - `http://localhost:4174` (the preview build)
4. Leave "Authorized redirect URIs" empty. **Create**.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). There's no
   client secret to keep: web apps don't use one.

## 5. Create the download key (API key)

People who open a link don't sign in; the app downloads the shared files with this key.

1. Menu → **APIs & Services** → **Credentials** → **Create credentials** → **API key**.
2. Click the new key's name (or **Edit API key**) to restrict it:
   - **Application restrictions**: **Websites**, and add
     `https://lawlordylan.github.io/*`, `http://localhost:5173/*` and `http://localhost:4174/*`.
   - **API restrictions**: **Restrict key** → tick **Google Drive API** only.
3. **Save**, then copy the key (starts with `AIza`).

## 6. Send the two values

Send the **Client ID** and the **API key**. They go into the app's build
settings (`src/lib/share-config.ts`) and are safe in a public repository
because of the restrictions above.

## Sharing from the app

In a session, tap **Share** → **Share**. Sign in with the Google account above and
allow access. The dialog shows the upload, then the link. **Update copy** sends
later changes to the same link; **Stop sharing** deletes the session from Drive.

## What lands in your Drive

- A folder **Killeshin Match Analysis – shared sessions**, with one subfolder per
  shared session: the clips, plus `session.json` (titles, shortcuts and drawings).
- Each shared session is set to **Anyone with the link: Viewer**. Links don't
  expire; **Stop sharing** in the app deletes the files and the link stops working.
- The files count towards your Drive storage. A free Google account has 15 GB
  across Gmail, Drive and Photos.

## Things to know

- **Links can be forwarded.** Anyone who gets a link can download the session.
  Match footage may show under-18s, so follow the club's safeguarding policy on
  what's shared and with whom.
- **Signing in to share** opens a Google pop-up each time the app needs a fresh
  permission (about once an hour while you're sharing). People opening links
  never sign in.
- **Another person sharing** needs to sign in with the same Google account, or
  be added under **Test users** too (then their shares go to *their* Drive).
- To revoke the app's access entirely: <https://myaccount.google.com/permissions>
  → Killeshin Match Analysis → **Remove access**. Shared files stay in Drive until
  you delete them.
