# Google Connector Reconnect Guide for Jarvis

This document describes how to connect and authorize Jarvis to access Google APIs (Gmail and Google Drive) securely using the automated OAuth connect flow.

---

## 🔒 Security Best Practices

> [!CAUTION]
> **Credential Exposure Warning**
> * **Never paste tokens** (access tokens, refresh tokens, auth codes, client secrets) into the Telegram chat, Discord, Git commits, issues, or emails.
> * **Never check in `.env.local`** to Git.
> * Keep all scopes **strictly read-only** (`gmail.readonly` and `drive.metadata.readonly`).

---

## 🚀 Why We Do Not Use OAuth Playground Manually

We previously relied on the Google OAuth 2.0 Playground to generate refresh tokens manually. This is **unstable and discouraged** for production because:
1. **Scope and Client Mismatches**: If you forget to configure "Use your own OAuth credentials" under the Playground settings, Google registers the refresh token to the Playground's own Client ID, returning `unauthorized_client` when your app tries to use it.
2. **Short Token Lifespans**: Google automatically expires refresh tokens in 7 days if your OAuth consent screen is configured as "Testing" with "External" user types.
3. **Configuration Friction**: Manually copying refresh tokens into `.env.local` and database tables is highly prone to copy-paste errors and exposes secrets in plaintext.

The automated connect flow registers tokens directly into the database securely and dynamically, completely bypassing the Playground.

---

## 🔗 How to Connect / Reconnect Google from Jarvis

If you see a connector status of `Revoked`, `Needs Reconnect`, `Not Authorized`, or `Decryption Error`, follow these steps:

### 1. Configure the Redirect URIs in Google Cloud Console
Ensure your OAuth Client ID has the correct **Authorized redirect URIs** configured in the [Google Cloud Credentials Console](https://console.cloud.google.com/apis/credentials):
* **Staging / Production**: `https://your-domain.up.railway.app/api/jarvis/google/callback`
* **Local Development**: `http://localhost:3000/api/jarvis/google/callback`

### 2. Request a Reconnect Link in Telegram
Run the reconnect command for the specific connector:
```text
/jarvis_reconnect_google gmail
```
or
```text
/jarvis_reconnect_google google_drive
```

*Jarvis will verify your administrator permissions and return a secure redirect link.*

### 3. Click the Link to Authorize
1. Click the link returned in your Telegram chat.
2. You will be redirected to Google's consent screen.
3. Select your Google account and authorize access.
4. Google will redirect you back to Jarvis, which exchanges the authorization code server-side, encrypts the credentials using **AES-256-GCM**, and saves them securely in the database.
5. You will see a success page: **"Google connector connected successfully. You can return to Telegram."**

### 4. Force Reconnection (If Google does not return a refresh token)
If you have previously authorized Jarvis, Google may skip returning a refresh token. If you see a warning about a missing refresh token, run the command with the `force` parameter to force Google's consent screen:
```text
/jarvis_reconnect_google gmail force
```
or
```text
/jarvis_reconnect_google google_drive force
```
Click the link to complete authorization and regenerate your refresh token.
