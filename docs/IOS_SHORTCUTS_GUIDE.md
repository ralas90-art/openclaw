# iOS Shortcuts Setup Guide for Jarvis Personal Assistant

This guide describes how to configure native iOS Shortcuts to upload screenshots and photos to approved storage providers first and then register them into the Jarvis Mobile Intake API.

---

## 🔒 SECURITY WARNING: Protect Your Secrets

> [!CAUTION]
> **NEVER paste database URLs (DATABASE_URL), Supabase service-role keys (SERVICE_ROLE), Railway project secrets, or Telegram bot tokens into iOS Shortcuts.**
> 
> iOS Shortcuts are stored locally on your device and can easily be shared, exported, or synced via iCloud. If you use Supabase Storage, only use a **dedicated public bucket with an anon-key-safe public storage policy**. 

---

## Prerequisites
1. **Your API Token**: Obtain your active mobile shortcut token (e.g., generated during setup).
2. **Your API Base URL**: `https://openclaw-runtime.up.railway.app/api/jarvis`
3. **Approved Storage Access**:
   - **Google Drive (Recommended)**: Logged into the Google Drive app on your iOS device.
   - **Supabase**: Your project URL (`https://[PROJECT-ID].supabase.co`) using the **anon key** only (never service role).

---

## Shortcut 1: Send Screenshot to Jarvis

This shortcut is accessible from the Share Sheet when viewing an image or automatically pulls the latest screenshot.

### Step-by-Step Configuration

1. **Receive Image Input**
   - At the top of the shortcut, set:
     > **Receive** `Images` **from** `Share Sheet` **and** `Quick Actions`
   - Add a fallback conditional block:
     - If `Shortcut Input` has no value:
       - **Get Latest Screenshots** (limit to `1`)
       - Set variable `MediaFile` to the screenshot.
     - Otherwise:
       - Set variable `MediaFile` to `Shortcut Input`.

2. **Generate Unique Filename**
   - **Get Current Date**
   - **Format Date** using Custom template: `yyyyMMdd_HHmmss`
   - **Text** action: `screenshot_FormatDate.png`
   - Set variable `Filename` to the text.

3. **Upload to Supabase Storage (Anon Bucket)**
   - **Get Contents of URL** action:
     - **URL**: `https://[PROJECT-ID].supabase.co/storage/v1/object/[PUBLIC-BUCKET-NAME]/Filename`
     - **Method**: `POST`
     - **Headers**:
       - `Authorization`: `Bearer [SUPABASE-ANON-KEY]`
       - `Content-Type`: `image/png`
     - **Request Body**: Choose `File` and select variable `MediaFile`.

4. **Construct Public URL**
   - After the upload succeeds, the public file URL will be:
     `https://[PROJECT-ID].supabase.co/storage/v1/object/public/[PUBLIC-BUCKET-NAME]/Filename`
   - Save this URL string to a variable named `PublicMediaUrl`.

5. **Post Intake Payload to Jarvis**
   - **Get Contents of URL** action:
     - **URL**: `https://openclaw-runtime.up.railway.app/api/jarvis/mobile-intake`
     - **Method**: `POST`
     - **Headers**:
       - `Authorization`: `Bearer [YOUR-SHORTCUT-TOKEN]`
       - `Content-Type`: `application/json`
     - **Request Body** (JSON):
       - `intake_source` (Text): `shortcut`
       - `task_type` (Text): `screenshot`
       - `media_url` (Text): `PublicMediaUrl`

6. **Show Result**
   - **Show Notification**: "Jarvis: Screenshot processed successfully!"

---

## Shortcut 2: Send Photo to Jarvis

This shortcut invokes the iPhone camera or prompts you to pick a photo from your gallery, uploads it to Google Drive, and registers it.

### Step-by-Step Configuration

1. **Source Photo**
   - **Choose from Menu**:
     - Option 1: *Take Photo*
       - **Take Photo** with camera.
       - Set variable `PhotoFile` to the image.
     - Option 2: *Pick from Library*
       - **Select Photos** (limit to 1).
       - Set variable `PhotoFile` to the selected photo.

2. **Upload to Google Drive**
   - **Upload File** action (native Google Drive shortcut block):
     - **File**: Choose variable `PhotoFile`
     - **Destination**: Choose folder (e.g. `/Jarvis Uploads`)
   - **Get Share Link** action:
     - **File**: Choose the output of the Upload File action.
   - Save this link to a variable named `DriveMediaUrl`.

3. **Post Intake Payload to Jarvis**
   - **Get Contents of URL** action:
     - **URL**: `https://openclaw-runtime.up.railway.app/api/jarvis/mobile-intake`
     - **Method**: `POST`
     - **Headers**:
       - `Authorization`: `Bearer [YOUR-SHORTCUT-TOKEN]`
       - `Content-Type`: `application/json`
     - **Request Body** (JSON):
       - `intake_source` (Text): `shortcut`
       - `task_type` (Text): `photo`
       - `media_url` (Text): `DriveMediaUrl`

4. **Show Result**
   - **Show Notification**: "Jarvis: Photo recorded successfully!"

---

## Shortcut Expansion 1: Save with Caption

To prompt for an optional text caption before uploading:

1. Add an **Ask for Input** action right after sourcing the media:
   - *Prompt*: "Enter optional caption/notes (or leave blank):"
   - *Input Type*: Text
   - Set variable `UserCaption` to the response text.
2. In the final **Get Contents of URL** payload to Jarvis, add the `text_content` field:
   - `text_content` (Text): `UserCaption`

---

## Shortcut Expansion 2: Save to Project

To associate the media directly with an active Jarvis project:

1. Add a **Choose from List** action to list your active project slugs (e.g., `septivolt`, `new-era-solar`, `cresca-os`, `g-g-cleaning`):
   - *Prompt*: "Select project for this task (optional):"
   - Include an option: "None"
   - Set variable `SelectedProject` to the chosen item.
2. Add a conditional block:
   - If `SelectedProject` is NOT "None":
     - Save to variable `ProjectSlug` (e.g., `septivolt`).
   - Else:
     - Set `ProjectSlug` to empty.
3. In the final **Get Contents of URL** payload to Jarvis, add the `project_slug` field:
   - `project_slug` (Text): `ProjectSlug`

---

## Shortcut Expansion 3: Get Morning Brief (Siri Voice)

You can create a Shortcut to play your Daily Morning Brief out loud via Siri:

1. **Get Contents of URL** action:
   - **URL**: `https://openclaw-runtime.up.railway.app/api/jarvis/daily-brief?format=siri`
   - **Method**: `GET`
   - **Headers**:
     - `Authorization`: `Bearer [YOUR-SHORTCUT-TOKEN]`
2. **Speak Text** action (native iOS Action):
   - **Text**: Choose the output of the URL action.
   - *Voice Options*: Adjust rate, pitch, or voice language as desired.

---

## Troubleshooting

### 1. `401 Unauthorized`
- **Reason**: The API token in the `Authorization` header is missing, malformed, or expired.
- **Fix**: Check that the header value is exactly `Bearer <token>` (with a single space) and matches the active token in the `jarvis_mobile_tokens` table.

### 2. `400 Bad Request` with `invalid media_url`
- **Reason**: The domain used in `media_url` is not in the strict approved list, or uses `http` instead of `https` in a production environment.
- **Fix**: Verify your URL is hosted on Google Drive (`drive.google.com`, `docs.google.com`) or your exact configured Supabase Storage project domain. Non-HTTPS links are blocked in production.

### 3. `400 Bad Request` with `missing media_url`
- **Reason**: A screenshot or photo intake payload was sent without a `media_url` field, or the field value was empty.
- **Fix**: Ensure that your shortcut completes the storage upload step first and retrieves a valid URL string before making the API post.

---

## Telegram Inbox & Command Verification

Once sent, you can verify and process these uploads inside Telegram:

1. **Check Inbox**
   - Send `/jarvis_mobile_inbox` in Telegram.
   - You will see the new entries with **clickable attachment links**:
     ```text
     • *[SHORTCUT]* `[screenshot]` at _2026-06-17 08:47_
       *Content:* Screenshot caption text
       *Media:* [View Attachment](https://[project-id].supabase.co/storage/v1/object/public/media/screenshot_...)
     ```

2. **Process and Map to Project**
   - Assign to a project and mark processed using:
     `/jarvis_process_inbox [Upload-UUID] [project-slug]`
   - Verify that the item is successfully marked processed.
