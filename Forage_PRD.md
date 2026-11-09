# Forage: Product Requirements Document

*Draft v0.1 | October 21, 2026 | Status: Draft for validation | Working name, subject to change*

## 1. Summary

Forage is an ambient vocabulary system that turns words people recognize while reading into words they actually use when writing and speaking. Users capture a word in context with one tap. The system captures the word's meaning in context, part of speech, register, and definition. It schedules spaced repetition by bringing each word back to the user at crucial times that maximize memory recall. This is achieved by prompting short production practice (writing original sentences) that is graded by an LLM. A later phase detects real-world use of the word in the user's own writing.

The product is positioned as a daily habit that rides on existing reading and work routines, not as a study tool that requires its own session.

The Forage logo is an acorn.

## 2. Problems

- People encounter many unfamiliar words while reading, then forget them. Recognition rarely converts into active use.
- Existing tools teach words the user didn't choose (Duolingo, Elevate, Vocabulary.com), test recognition rather than production (flashcards), or demand heavy setup (Anki).
- RhythmWord trains through sentence formation but words are chosen for users.
- Highlight tools capture words but do not follow up on retention with post-read training.

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
4. Convert captured words into mastered words (produced correctly in multiple sessions).
5. Reach a sustainable free-to-paid conversion with LLM cost per active user well below subscription revenue.

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
| D7 / D30 retention | Users with a capture or practice event | To be set from Phase 0 data |
| Words activated | Words produced correctly in at least 2 separate sessions | Primary north-star input |
| Free-to-paid conversion | Paid users divided by active users | To be set from Phase 0 data |
| LLM cost per active user | Monthly model spend per active user | Under 20% of ARPU |
| Grade dispute rate | Disputes divided by graded attempts | Under 5% |

## 6. Core user journey

1. **Read.** The user reads an article, book, or email and meets an unfamiliar or half-known word.
2. **Capture.** They select the word and tap or hotkey "Save." The word, sentence, and source are stored. Nothing else is asked.
3. **Enrich (async).** The system identifies the exact sense and part of speech and generates a simple definition and model sentences.
4. **Practice.** A low-friction trigger (new tab, push notification, widget) delivers a short task. The user writes an original sentence.
5. **Feedback.** The LLM returns a verdict, a corrected version, and a short reason. The score updates the review schedule.
6. **Reinforce.** The word returns at spaced intervals in varied task formats until activated.
7. **Activate (later phase).** The system notices the user using the word in real writing and surfaces it.

### Design principles

Execution matters more than the idea here. The loop only works if it fits into people's existing routines, and these five principles drive the requirements in section 7.

1. **Capture has to cost almost nothing.** If saving a word takes more than a second or two, or interrupts the reading, people stop doing it and the loop never starts. Everything downstream depends on this, which is why the browser extension and Android's text-selection menu come first, and why iOS and Kindle are weak spots that rely on share extensions and Readwise (C1 to C6).
2. **Practice has to be unobtrusive.**
   1. Practice cannot appear amid busy tasks.
   2. Prevent too many triggers, which may become noise and lead people to mute or uninstall, so fewer, better-timed prompts usually beat more (P1 to P6).
3. **Each session has to be short.** Finishable within 30 to 60 seconds. Long sessions feel productive in the short term but are unsustainable in the long term.
4. **The feedback has to be worth the effort.** LLM grading either builds trust or kills it. If someone writes a sentence and gets a vague or wrong correction, they stop writing sentences. A good response feels like a sharp editor, not a quiz scorer (G1 to G6).
5. **It has to show progress that matters.** Streaks keep people around for a while, but "you used ephemeral in an email this week" is the payoff that makes the whole thing feel real. That is why activation tracking (section 7.7) is the intended differentiator, and why words activated is the north-star metric.

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

### 7.3 Scheduling

| ID | Requirement | Priority |
| --- | --- | --- |
| S1 | Each word becomes an FSRS card using the open-source ts-fsrs library | P0 |
| S2 | Practice score (1 to 4) maps to FSRS ratings Again, Hard, Good, Easy | P0 |
| S3 | Daily practice cap is user-configurable (default 5 words) | P0 |
| S4 | Smart prioritization favors recent captures and overdue cards | P1 |
| S5 | Pause, snooze, and "I know this" (archive) controls | P0 |

### 7.4 Ambient practice

| ID | Requirement | Priority |
| --- | --- | --- |
| P1 | New-tab page shows one practice card at a time with inline answer field | P0 |
| P2 | Task types rotate: (a) write an original sentence, (b) rewrite a bland sentence using the word, (c) choose the correct usage of two sentences, (d) write a one-line reply in a stated tone | P0 (a, c), P1 (b, d) |
| P3 | Push notification trigger with user-chosen time window and daily maximum | P1 |
| P4 | Home-screen and lock-screen widgets (iOS, Android) | P1 |
| P5 | Optional daily email digest with one-tap answer link | P1 |
| P6 | A session can be skipped without penalty, and the user can say "too hard" or "not useful" | P0 |

**Design constraints:** one task per screen, no required setup, answerable with one hand, completable in under 60 seconds.

**Design principle:** practice meets people where they already are. The triggers above follow from the Design principles in section 6, and each new trigger is added one at a time and cut if it raises mute or uninstall rates.

### 7.5 LLM evaluation

| ID | Requirement | Priority |
| --- | --- | --- |
| G1 | Grader returns structured JSON: grammar verdict, sense accuracy, collocation naturalness, tone fit, corrected sentence, one-sentence rationale, and score 1 to 4 | P0 |
| G2 | Deterministic rubric, low temperature, versioned prompts | P0 |
| G3 | One-tap "I disagree with this grade" that routes to a stronger model for a second opinion and logs the case | P0 |
| G4 | Feedback tone is that of a concise editor: specific, never generic praise, never condescending | P0 |
| G5 | Regression eval set of at least 200 labeled attempts, run before every prompt or model change | P0 |
| G6 | Cheap model by default, frontier model only for disputes and low-confidence cases | P0 |

### 7.6 Word bank and dashboard

| ID | Requirement | Priority |
| --- | --- | --- |
| D1 | Web dashboard lists all words with sense, source context, status (new, learning, activated), and next review date | P0 |
| D2 | Per-word history of attempts and feedback | P1 |
| D3 | Weekly summary: words captured, practiced, activated | P1 |
| D4 | Export to CSV and Anki | P1 |
| D5 | Full account and data deletion | P0 |

### 7.7 Activation tracking (Phase 3)

This is the intended differentiator and the highest-risk feature on privacy, platform policy, and technical grounds. It must not block earlier phases.

| ID | Requirement | Priority |
| --- | --- | --- |
| A1 | Opt-in connection to writing surfaces (Gmail, Google Docs, Notion, or a desktop or keyboard companion) | P2 |
| A2 | On-device or privacy-preserving matching of the user's captured lemmas against their own text, without storing full content server-side | P2 |
| A3 | Notify the user when a target word is used in real writing and credit the card | P2 |
| A4 | Clear controls to disconnect and delete all derived data | P2 |

## 8. Non-functional requirements

- **Latency:** capture confirmation under 300 ms perceived. Grading response under 4 seconds at p90.
- **Reliability:** no captured word is ever lost. Offline queue plus idempotent sync.
- **Privacy:** captured sentences and writing samples are personal data. Minimize collection, encrypt in transit and at rest, apply row-level security, publish a plain-language data policy, and honor deletion requests. Define LLM provider data-retention terms before launch.
- **Cost control:** per-user daily LLM budget, aggressive caching, small models by default, and alerting on cost per active user.
- **Compliance:** follow Chrome Web Store, Apple, and Google Play policies. Request minimal extension permissions. Evaluate GDPR and CCPA obligations before public launch.
- **Accessibility:** keyboard-operable extension and dashboard, screen-reader labels, and adjustable text size.
- **Observability:** Sentry for errors and PostHog for product analytics, with events for every funnel stage.

## 9. System architecture (summary)

- **Clients:** browser extension (TypeScript, WXT or Plasmo), mobile app (React Native with Expo, plus native widgets), and a web dashboard (Next.js).
- **Backend:** Supabase (Postgres, auth, row-level security, edge functions) with a job table or pg_cron for the enrichment queue.
- **LLM layer:** provider-agnostic wrapper, versioned prompts, structured-output validation, and per-task model routing.
- **Notifications:** FCM and APNs for push, and a transactional email provider for digests.
- **Integrations:** Readwise API for Kindle highlights.

### Core data model

| Table | Purpose |
| --- | --- |
| users | Account, settings, trigger preferences |
| captures | Raw word, sentence, source URL, device, timestamp |
| lemmas | Normalized word entries |
| senses | Sense data per lemma and context (cached) |
| cards | FSRS state per user and word |
| attempts | User text, task type, LLM verdict, score, dispute flag |
| review_log | Immutable history of ratings and schedule changes |

## 10. Monetization

Pricing is a hypothesis to be tested with founding-member offers.

- **Free:** unlimited capture, FSRS reviews, new-tab practice, and a small number of AI-graded attempts per day.
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
- Run for 3 to 4 weeks.
- Measure unprompted capture, practice completion, weekly drop-off, and willingness to pay (including founding-member payments).
- Decision rules, set in advance: define the minimum week-4 active share and minimum paying users that justify proceeding. If results are mixed, narrow the audience and rerun. If discouraging, stop or pivot.

A concierge test flatters the product through personal attention, so a pass is a green light to build a thin automated prototype, not proof of scalable retention.

## 13. Release plan

| Phase | Timeline | Scope | Exit criteria |
| --- | --- | --- | --- |
| 0: Validate | 1 to 2 weeks setup, 3 to 4 weeks run | Concierge test | Pre-set retention and payment thresholds met |
| 1: MVP | 6 to 8 weeks | Chrome extension, backend, enrichment, FSRS, dashboard, new-tab practice, LLM grading | Private beta users retain at target levels |
| 2: Mobile and monetization | 2 to 3 months | Android and iOS capture, widgets, push, Readwise sync, paid tier | Paying users and stable unit economics |
| 3: Activation and expansion | After Phase 2 | Writing-activity detection, teams, additional languages | Activation shown to lift retention |

## 14. Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Low retention typical of vocabulary apps | High | Narrow wedge, tiny sessions, few well-timed triggers, concierge test first |
| LLM grading errors erode trust | Medium | Rubric, dispute button, second-opinion routing, regression eval set |
| Capture friction on iOS and Kindle | High | Start with web and Android, integrate via Readwise, avoid scraping |
| Notification fatigue | Medium | One trigger at launch, user-controlled caps, measure mute and uninstall rates |
| Competitor adds a similar feature (Readwise, Grammarly) | Medium | Build the activation moat, own the non-native professional niche |
| Privacy concerns around writing integrations | Medium | Strict opt-in, on-device matching where possible, transparent policy |
| Platform policy changes (extension stores, API access) | Low to Medium | Minimal permissions, no dependence on scraping |
| Low willingness to pay | Medium | Test with real payments in Phase 0, pick stakes-driven segment |

## 15. Open questions

1. Is the primary surface a new tab, a push notification, or a messaging app? Phase 0 observation should decide this.
2. Should English be the only language at launch, or should the data model support multiple languages from day one?
3. What is the right default daily practice volume before users feel nagged?
4. How much sense data can be safely shared across users without privacy or licensing issues?
5. Which writing surface is the best first target for activation tracking?
6. Is a B2B motion realistic to pursue before consumer retention is proven?

## 16. Assumptions to verify

- Competitor positioning and pricing described in this document come from general market knowledge and should be re-checked before commitments are made.
- LLM cost estimates depend on model choice, prompt length, and caching rates and must be measured with real usage.
- Platform capabilities (iOS text selection, Readwise API scope, extension store policies) should be confirmed against current documentation during technical discovery.
