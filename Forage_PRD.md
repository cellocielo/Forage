# Forage: Product Requirements Document

*Draft v0.3 | November 2, 2026 | Status: Draft for validation | Working name, subject to change*

## 1. Summary

Forage is an ambient vocabulary system that turns words people recognize while reading into words they actually use when writing and speaking. Users capture a word in context with one tap. The system captures the word's meaning in context, part of speech, register, and definition. It schedules spaced repetition by bringing each word back to the user at crucial times that maximize memory recall. This is achieved by prompting short production practice (writing original sentences) that is graded by an LLM. Production practice is scaffolded. Prompts are supplemented with sentence frames, scenario prompts, and hints on demand to prevent users from facing a blank box. Scaffolding fades as a word gets stronger. Practice appears at natural breaks in the user's day, never mid-task, and users control when and how often it appears. A later phase detects real-world use of the word in the user's own writing.

The product is positioned as a daily habit that rides on existing reading and work routines, not as a study tool that requires its own session.

## 2. Problems

- People encounter many unfamiliar words while reading, then forget them. Recognition rarely converts into active use.
- Existing tools teach words the user didn't choose (Duolingo, Elevate, Vocabulary.com), test recognition rather than production (flashcards), or demand heavy setup (Anki).
- RhythmWord trains through sentence formation but words are chosen for users.
- Highlight tools capture words but do not follow up on retention with post-read training.
- Open "write a sentence" prompts leave users unsure where to start, because almost any sentence is possible.
- Reminder-based apps interrupt people at bad moments, so users mute them and the habit dies.

Result: no product cleanly combines in-context capture, spaced repetition, and graded production practice for improved English vocabulary.

## 3. Target users

**Target audiences:**

- Non-native English professionals who read and write English at work and want more precise, natural expression. They have real stakes, high motivation, and a clear willingness to invest in self-improvement.
- Everyday students and workers who want to expand their conversational vocabulary.

**Additional potential audiences:**

- Test-prep takers (GRE, IELTS, TOEFL): motivated but stop using the tool after the exam.
- Heavy readers and writers: familiar with paying for reading tools.

## 4. Goals and non-goals

### Goals

1. Make capture cost under 1 second with no follow-up questions.
2. Make each practice session finishable in 30 to 60 seconds.
3. Make LLM feedback trustworthy enough that users keep writing sentences.
4. Give every production prompt a starting point (a frame, scenario, or hint) so users never face a blank box.
5. Show practice only at natural breaks, with user control over timing and frequency, so users never feel the need to mute Forage.
6. Convert captured words into mastered words (produced correctly in multiple sessions).
7. Reach a sustainable free-to-paid conversion with LLM cost per active user well below subscription revenue.

### Non-goals (v1)

- Teaching foreign languages to beginners.
- Gamification-heavy mechanics (leagues, hearts, XP economies).
- Scraping Kindle or any platform against its terms of service.
- Pre-built word lists or curricula.
- Social or community features.

## 5. Success metrics

Targets are hypotheses to be calibrated by the validation phase, not commitments.

**Star metric:** weekly words activated per active user.

| Metric | Definition | Initial hypothesis |
| --- | --- | --- |
| Capture rate | Words saved per active user per week, unprompted | At least 5 |
| Capture-to-practice rate | Share of captured words practiced at least once within 7 days | At least 50% |
| Practice completion | Prompts answered divided by prompts delivered | At least 40% |
| Dismiss and mute rate by surface | Prompts dismissed, and surfaces turned off, per surface | Tracked per surface; cut or retime surfaces that underperform |
| Hint usage | Share of attempts that reveal at least one hint | Tracked; should fall as words strengthen |
| D7 / D30 retention | Users with a capture or practice event | To be set from Phase 0 data |
| Words activated | Words produced correctly in at least 2 separate sessions | Primary north-star input |
| Free-to-paid conversion | Paid users divided by active users | To be set from Phase 0 data |
| LLM cost per active user | Monthly model spend per active user | Under 20% of ARPU |
| Grade dispute rate | Disputes divided by graded attempts | Under 5% |

## 6. Core user journey

1. **Read.** The user reads an article, book, or email and meets an unfamiliar or half-known word.
2. **Capture.** They select the word and tap or hotkey "Save." The word, sentence, and source are stored. Nothing else is asked.
3. **Enrich (async).** The system identifies the exact sense and part of speech and generates a simple definition, model sentences, and practice scaffolding (frames, scenarios, and hints).
4. **Practice.** At a natural break (finishing an article, returning from idle, or the spare-minute window the user chose at onboarding), Forage offers a short task through a toolbar badge, a small corner reminder, a widget, or one daily push. The user writes a sentence, starting from a frame or scenario, and can tap "Stuck?" for a hint.
5. **Feedback.** The LLM returns a verdict, a corrected version, and a short reason. The score, adjusted for hints used, updates the review schedule.
6. **Reinforce.** The word returns at spaced intervals in varied task formats, with less scaffolding each time, until activated.
7. **Activate (later phase).** The system notices the user using the word in real writing and surfaces it.

### Design principles

Execution matters more than the idea here. The loop only works if it fits into people's existing routines, and these six principles drive the requirements in section 7.

1. **Capture has to cost almost nothing.** If saving a word takes more than a second or two, or interrupts the reading, people stop doing it and the loop never starts. Everything downstream depends on this, which is why the browser extension and Android's text-selection menu come first, and why iOS and Kindle are weak spots that rely on share extensions and Readwise (C1 to C6).
2. **Practice has to be unobtrusive.**
   1. Practice appears only at natural breaks, never mid-task, and stays silent during meetings, presentations, and Focus modes.
   2. Users decide when and how often practice appears, and Forage backs off on its own when prompts are ignored. Fewer, better-timed prompts beat more (P1 to P7, T1 to T10).
3. **Each session has to be short.** Finishable within 30 to 60 seconds. Long sessions feel productive in the short term but are unsustainable in the long term.
4. **Writing never starts from a blank page.** Every prompt narrows the space with a frame or scenario, and help is one tap away. Structure fades as a word gets stronger, so the user ends up producing it freely (P8 to P12).
5. **The feedback has to be worth the effort.** LLM grading either builds trust or kills it. If someone writes a sentence and gets a vague or wrong correction, they stop writing sentences. A good response feels like a sharp editor, not a quiz scorer (G1 to G7).
6. **It has to show progress that matters.** Streaks keep people around for a while, but "you used ephemeral in an email this week" is the payoff that makes the whole thing feel real. That is why activation tracking (section 7.8) is the intended differentiator, and why words activated is the north-star metric.

## 7. Functional requirements

Priority key: P0 required for MVP, P1 required for paid launch, P2 later.

### 7.1 Word Capture

| ID | Requirement | Priority |
| --- | --- | --- |
| C1 | Browser extension (Chrome first, Manifest V3) saves selected word, surrounding sentence, page title, and URL via context menu and configurable hotkey | P0 |
| C2 | Capture completes with a single action and confirms with a non-blocking verification message | P0 |
| C3 | Captures queue offline and sync when connectivity returns | P0 |
| C4 | Android: "Save to Forage" appears in the system text-selection menu | P1 |
| C5 | iOS: share extension and Safari web extension | P1 |
| C6 | Kindle highlights imported through Readwise integration (no direct Amazon scraping) | P1 |
| C7 | Manual add (type a word) and bulk import from CSV | P1 |
| C8 | Firefox and Safari desktop extensions | P2 |

### 7.2 Adding Details

| ID | Requirement | Priority |
| --- | --- | --- |
| E1 | Lemmatize the captured word and detect sentence boundaries | P0 |
| E2 | LLM returns structured JSON: lemma, part of speech, sense definition for this context, register (formal, informal, literary, technical), plain-language paraphrase, and 2 model sentences in different contexts | P0 |
| E3 | Cache results keyed on lemma and sentence hash, and reuse sense data across users where privacy allows | P0 |
| E4 | Enrichment runs asynchronously and never blocks capture | P0 |
| E5 | User can correct or replace the chosen sense | P1 |
| E6 | Detect and merge duplicate captures of the same lemma, preserving each context | P1 |
| E7 | Generate and cache practice scaffolding per sense: 2 sentence frames, 3 scenario prompts across registers, and a 3-step hint ladder | P0 |

### 7.3 Scheduling

| ID | Requirement | Priority |
| --- | --- | --- |
| S1 | Each word becomes an FSRS card using the open-source ts-fsrs library | P0 |
| S2 | Practice score (1 to 4) maps to FSRS ratings Again, Hard, Good, Easy, after any hint cap (P11) is applied | P0 |
| S3 | Daily practice cap is user-configurable (default 5 words) | P0 |
| S4 | Smart prioritization favors recent captures and overdue cards | P1 |
| S5 | Pause, snooze, and "I know this" (archive) controls | P0 |

### 7.4 Ambient practice

| ID | Requirement | Priority |
| --- | --- | --- |
| P1 | Toolbar badge shows the number of words ready (e.g., "2"). Clicking it opens one practice card in the extension popup. This is the default desktop surface and never interrupts | P0 |
| P2 | End-of-reading card: when the user closes a tab where they captured a word, a small dismissable card offers a prompt for that word | P0 |
| P3 | Corner reminder: a small popup in the corner of the screen at most every few hours (default 5), showing the actual prompt (e.g., "Use egregious in a complaint"), not a generic reminder. Clicking opens an inline answer box; it fades out after about 10 seconds if ignored and has "Later today" and "Not today" buttons | P0 |
| P4 | New-tab mode (opt-in only): a practice card below a focused search bar, so typing goes straight to search | P1 |
| P5 | One daily push notification at the user's chosen time, sent only when words are due, with inline reply where iOS and Android support it | P1 |
| P6 | Home-screen and lock-screen widgets (iOS, Android) showing the word and prompt, with tap to answer | P1 |
| P7 | Optional daily email digest with one-tap answer link (off by default) | P1 |
| P8 | Task types rotate: (a) complete a sentence frame, (b) write a sentence for a stated scenario, (c) choose the correct usage of two sentences, (d) rewrite a bland sentence using the word, (e) write an original sentence with no scaffold | P0 (a, b, c), P1 (d, e) |
| P9 | Sentence frames: a partial sentence with one blank (e.g., "The late fee was so egregious that ___."), so the user supplies only the meaning | P0 |
| P10 | Scenario prompts: a one-line situation naming the listener and goal (e.g., "Email your landlord about an unfair repair bill"), in at least two registers, one based on the capture context | P0 |
| P11 | Hints on demand: a "Stuck?" button reveals common word partners, then an example on another topic, then a sentence starter. Step 1 is free, step 2 caps the score at Good, step 3 at Hard | P0 |
| P12 | Scaffold fading: new words get frames, mid-stability words get scenarios, strong words get open prompts. An "Easier, please" control drops one level | P0 (fading), P1 (control) |

**Design constraints:** one task per screen, no required setup, answerable with one hand, completable in under 60 seconds.

### 7.5 Timing and user controls

Practice meets people where they already are. Each surface is added one at a time and cut if it raises mute or uninstall rates.

| ID | Requirement | Priority |
| --- | --- | --- |
| T1 | Wait for natural breaks: when a reminder is due, hold it until the user pauses (stopped typing, returned from idle via chrome.idle, or just closed a tab), never mid-task | P0 |
| T2 | Stay quiet when it matters: no popups during fullscreen video, presentations, or screen sharing, and respect macOS Focus and Do Not Disturb by using system notifications | P0 |
| T3 | Only prompt when a word is due: the timer sets the earliest time a reminder can appear, and FSRS decides whether there is anything to show | P0 |
| T4 | Onboarding asks "When do you usually have a spare minute?" (morning coffee, commute, lunch, evening). The answer sets the push time and the preferred reminder window | P0 |
| T5 | Frequency setting: users choose how often reminders can appear (e.g., every 3, 5, or 8 hours, or once a day) and their daily word cap | P0 |
| T6 | Weekend toggle: practice on or off on Saturdays and Sundays (default off) | P0 |
| T7 | Quiet hours: no reminders outside a user-set window (default 9 PM to 8 AM) | P0 |
| T8 | Snooze: "Later today" and "Not today" on every reminder, plus a "Pause for a week" option in settings | P0 |
| T9 | Back off when ignored: after 3 ignored reminders on a surface, show that surface less often. After several days of no responses anywhere, send one "Still want these?" check-in instead of more prompts | P0 |
| T10 | Gentle ramp-up: 1 to 2 prompts a day in week one, rising toward the user's cap as they keep answering. Skipping never breaks a streak or lowers a score | P0 |

### 7.6 LLM evaluation

| ID | Requirement | Priority |
| --- | --- | --- |
| G1 | Grader returns structured JSON: grammar verdict, sense accuracy, collocation naturalness, tone fit, corrected sentence, one-sentence rationale, and score 1 to 4 | P0 |
| G2 | Deterministic rubric, low temperature, versioned prompts | P0 |
| G3 | One-tap "I disagree with this grade" that routes to a stronger model for a second opinion and logs the case | P0 |
| G4 | Feedback tone is that of a concise editor: specific, never generic praise, never condescending | P0 |
| G5 | Regression eval set of at least 200 labeled attempts, covering every task type, run before every prompt or model change | P0 |
| G6 | Cheap model by default, frontier model only for disputes and low-confidence cases | P0 |
| G7 | Rubric adapts to the scaffold: frames are graded on meaning fit, scenarios also on tone fit for the stated listener, open prompts on the full sentence | P0 |

### 7.7 Word bank and dashboard

| ID | Requirement | Priority |
| --- | --- | --- |
| D1 | Web dashboard lists all words with sense, source context, status (new, learning, activated), and next review date | P0 |
| D2 | Per-word history of attempts and feedback | P1 |
| D3 | Weekly summary: words captured, practiced, activated | P1 |
| D4 | Export to CSV and Anki | P1 |
| D5 | Full account and data deletion | P0 |
| D6 | Settings page for all timing controls in 7.5 (frequency, weekends, quiet hours, snooze, surfaces on or off) | P0 |

### 7.8 Activation tracking (Phase 3)

This is the intended differentiator and the highest-risk feature on privacy, platform policy, and technical grounds. It must not block earlier phases.

| ID | Requirement | Priority |
| --- | --- | --- |
| A1 | Opt-in connection to writing surfaces (Gmail, Google Docs, Notion, or a desktop or keyboard companion) | P2 |
| A2 | On-device or privacy-preserving matching of the user's captured lemmas against their own text, without storing full content server-side | P2 |
| A3 | Notify the user when a target word is used in real writing and credit the card | P2 |
| A4 | Clear controls to disconnect and delete all derived data | P2 |

## 8. Non-functional requirements

- **Latency:** capture confirmation under 300 ms perceived. Grading response under 4 seconds at p90. Hints appear instantly because they are pre-generated (E7).
- **Reliability:** no captured word is ever lost. Offline queue plus idempotent sync.
- **Privacy:** captured sentences and writing samples are personal data. Minimize collection, encrypt in transit and at rest, apply row-level security, publish a plain-language data policy, and honor deletion requests. Define LLM provider data-retention terms before launch. Natural-break detection uses only idle state and tab events, never page content or keystrokes.
- **Cost control:** per-user daily LLM budget, aggressive caching, small models by default, and alerting on cost per active user. Scaffolding is generated once per sense and cached, adding no per-attempt cost.
- **Compliance:** follow Chrome Web Store, Apple, and Google Play policies. Request minimal extension permissions. Evaluate GDPR and CCPA obligations before public launch.
- **Accessibility:** keyboard-operable extension and dashboard, screen-reader labels, and adjustable text size.
- **Observability:** Sentry for errors and PostHog for product analytics, with events for every funnel stage and every prompt shown, answered, dismissed, or snoozed per surface.

## 9. System architecture (summary)

- **Clients:** browser extension (TypeScript, WXT or Plasmo), mobile app (React Native with Expo, plus native widgets), and a web dashboard (Next.js).
- **Backend:** Supabase (Postgres, auth, row-level security, edge functions) with a job table or pg_cron for the enrichment queue.
- **LLM layer:** provider-agnostic wrapper, versioned prompts, structured-output validation, and per-task model routing.
- **Notifications:** chrome.notifications and chrome.idle for desktop reminders, FCM and APNs for push, and a transactional email provider for digests.
- **Integrations:** Readwise API for Kindle highlights.

### Core data model

| Table | Purpose |
| --- | --- |
| users | Account, settings, spare-minute window, frequency, weekend and quiet-hour preferences, enabled surfaces |
| captures | Raw word, sentence, source URL, device, timestamp |
| lemmas | Normalized word entries |
| senses | Sense data and practice scaffolding per lemma and context (cached) |
| cards | FSRS state and current scaffold level per user and word |
| attempts | User text, task type, scaffold level, hints used, surface, LLM verdict, score, dispute flag |
| prompt_events | Each prompt shown, answered, dismissed, or snoozed, by surface (drives back-off) |
| review_log | Immutable history of ratings and schedule changes |

## 10. Monetization

Pricing is a hypothesis to be tested with founding-member offers.

- **Free:** unlimited capture, FSRS reviews, desktop practice (badge, end-of-reading card, corner reminder) with scaffolding and hints, all timing controls, and a small number of AI-graded attempts per day.
- **Pro** (hypothesis: roughly $7 to $10 per month, or $60 to $80 per year): unlimited AI grading, widgets and push, Readwise and Kindle sync, analytics, exports, and later activation tracking.
- **Later:** team and B2B plans for ESL programs, language schools, and companies with non-native-speaker staff.

**Unit economics assumption:** a heavy user costs roughly $1 to $3 per month in LLM spend if small models and caching are used. Validate with real usage before fixing price.

## 11. Go-to-market

- **Launch audience:** non-native professionals reached through ESL and career communities, LinkedIn, Reddit, and workplace networks.
- **Distribution channels:** Chrome Web Store search, Readwise-adjacent reading communities, and a content angle (for example, "words you read but never use").
- **First 100 users:** recruited manually from the Phase 0 pool and related communities, with direct feedback loops.
- **Referral:** invite credits for a free Pro month, introduced only after retention is proven.

## 12. Validation plan (Phase 0)

Before building the MVP, run a concierge test.

- Recruit 20 to 30 strangers in the target segment.
- Capture through a shared form, email, or Telegram. Practice prompts and feedback are delivered manually or by script plus LLM.
- Ask each participant for their spare-minute window and deliver prompts only then.
- Split prompts between open and scaffolded tasks to compare completion and how often users get stuck.
- Run for 3 to 4 weeks.
- Measure unprompted capture, practice completion, hint requests, snoozes and opt-outs, weekly drop-off, and willingness to pay (including founding-member payments).
- Decision rules, set in advance: define the minimum week-4 active share and minimum paying users that justify proceeding. If results are mixed, narrow the audience and rerun. If discouraging, stop or pivot.

A concierge test flatters the product through personal attention, so a pass is a green light to build a thin automated prototype, not proof of scalable retention.

## 13. Release plan

| Phase | Timeline | Scope | Exit criteria |
| --- | --- | --- | --- |
| 0: Validate | 1 to 2 weeks setup, 3 to 4 weeks run | Concierge test | Pre-set retention and payment thresholds met |
| 1: MVP | 6 to 8 weeks | Chrome extension, backend, enrichment, FSRS, dashboard and settings, toolbar badge, end-of-reading card, corner reminder with timing controls, scaffolding and hints, LLM grading | Private beta users retain at target levels |
| 2: Mobile and monetization | 2 to 3 months | Android and iOS capture, widgets, push, new-tab mode, Readwise sync, paid tier | Paying users and stable unit economics |
| 3: Activation and expansion | After Phase 2 | Writing-activity detection, teams, additional languages | Activation shown to lift retention |

## 14. Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Low retention typical of vocabulary apps | High | Narrow wedge, tiny sessions, few well-timed triggers, concierge test first |
| Reminders interrupt at bad moments and users mute or uninstall | Medium | Natural-break detection, quiet modes, quiet hours, snooze, back-off when ignored, ramp-up in week one, track dismiss and mute rates per surface |
| Scaffolding becomes a crutch and users never produce words freely | Medium | Fade scaffolds as words strengthen, cap scores for late hints, require open prompts at high stability |
| LLM grading errors erode trust | Medium | Rubric, dispute button, second-opinion routing, regression eval set |
| Capture friction on iOS and Kindle | High | Start with web and Android, integrate via Readwise, avoid scraping |
| Competitor adds a similar feature (Readwise, Grammarly) | Medium | Build the activation moat, own the non-native professional niche |
| Privacy concerns around writing integrations and idle detection | Medium | Strict opt-in, on-device matching where possible, no page content or keystrokes used for timing, transparent policy |
| Platform policy changes (extension stores, API access) | Low to Medium | Minimal permissions, no dependence on scraping |
| Low willingness to pay | Medium | Test with real payments in Phase 0, pick stakes-driven segment |

## 15. Open questions

1. Which desktop surface drives the most completed practice: toolbar badge, end-of-reading card, or corner reminder? Phase 0 and MVP data should decide the default mix.
2. Should English be the only language at launch, or should the data model support multiple languages from day one?
3. What is the right default daily practice volume and reminder interval before users feel nagged?
4. How much sense data can be safely shared across users without privacy or licensing issues?
5. Which writing surface is the best first target for activation tracking?
6. Is a B2B motion realistic to pursue before consumer retention is proven?
7. At what FSRS stability should a word move from frames to scenarios to open prompts?

## 16. Assumptions to verify

- Competitor positioning and pricing described in this document come from general market knowledge and should be re-checked before commitments are made.
- LLM cost estimates depend on model choice, prompt length, and caching rates and must be measured with real usage.
- Platform capabilities (iOS text selection, Readwise API scope, extension store policies, chrome.idle and chrome.notifications behavior, inline notification replies) should be confirmed against current documentation during technical discovery.