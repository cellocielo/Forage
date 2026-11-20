# Chrome Web Store listing

Paste these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).
Upload `.output/forage-<version>-chrome.zip` from `npm run zip`.

## Store listing

**Name:** Forage

**Summary** (132 characters max):
Save words while you read, then practice using them in your own sentences, graded by AI.

**Description:**
Forage turns words you recognize while reading into words you actually use.

- Save any word in one step: select it, then right-click → "Save to Forage" or press Alt+Shift+S.
  Forage keeps the sentence you found it in and shows what the word means there.
- Practice with short prompts that ask you to use the word in a sentence of your own. Claude
  grades each answer and explains what worked.
- Spaced repetition brings each word back just before you'd forget it.
- Gentle reminders when you're at your computer, never over full-screen video or a locked screen.
- Works offline: words saved without a connection sync later.
- Same account on your phone at the Forage web app.

**Category:** Education
**Language:** English (United States)

**Images:**
- Icon: `public/icon/128.png` (already in the build)
- Screenshot: at least one, 1280×800 or 640×400. Good ones: the meaning panel after saving a
  word, and a practice card with its grade.
- Small promo tile (optional): 440×280.

## Privacy practices

**Single purpose:**
Save words from web pages with their sentence and practice using them, so readers grow their
active vocabulary.

**Permission justifications:**

| Permission | Why |
| --- | --- |
| `contextMenus` | Adds "Save to Forage" to the right-click menu for selected text. |
| `activeTab` | Lets Forage read the selected word and its sentence on the current tab, only when the user saves a word. |
| `scripting` | Injects the capture script into the current tab when the user saves a word, to read the selection and show the word's meaning. No content scripts run on pages otherwise, and there are no host permissions. |
| `storage` | Keeps the sign-in session, words saved while offline, and reminder timing. |
| `alarms` | Syncs offline saves every few minutes and schedules practice reminders. |
| `notifications` | Shows practice reminders with "Later today" and "Not today" buttons. |
| `idle` | Holds reminders while the screen is locked or the user is away, so they appear only when someone is at the computer. |

**Remote code:** No, the extension does not use remote code.

**Data usage** (check these):
- Personally identifiable information (email address for the account)
- Authentication information (password, sent to the sign-in service)
- Website content (the selected word, its sentence, and the page title, only when the user saves)
- Web history: check this too, because each saved word stores the address of its page. It's
  collected only on save, not for every visit.

Then certify: not sold to third parties, not used for unrelated purposes, not used for
creditworthiness or lending.

**Privacy policy URL:** `https://<your web app domain>/privacy.html`
(the page is `web/public/privacy.html`; replace `CONTACT_EMAIL` before deploying).

## Distribution

**Visibility:** Unlisted for testers (anyone with the link can install), then Public.
