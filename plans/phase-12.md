# Phase 12 — Learner profiles

Netflix-style profiles behind the one app password. One branch, one PR.

## 1. Data (migration 0010, hand-written)
- **New tables:**
  - `profiles(id, name UNIQUE 1–30, emoji, created_at, archived_at)`;
  - `profile_settings(profile_id PK)` with the five learning settings and their CHECKs.
- **Moved out of `settings`:** the learning settings. `settings` keeps only `active_provider_id`.
- **`profile_id` NOT NULL → profiles** on user_profile, placement_results, placement_attempts, cards, review_logs, sessions, writing_submissions and drill_results.
  - Added with `ADD COLUMN … DEFAULT 1`, so no rebuild is needed.
  - The only rebuilds are `settings` and `user_profile`, which are copied and lose nothing.
- **Indexes:** on `(profile_id, …)`. The in-progress unique indexes, and the card uniqueness, are per profile.
- **Nullable owners:**
  - `profile_id` on `sentences` and `cloze_items`: mined rows are owned, everything else is shared;
  - `llm_calls.profile_id`: grading calls made for a learner;
  - `auth_sessions.profile_id`: the profile picked after login.
- **Backfill:** profile 1, "Hồ sơ 1", owns every existing row, including the mined sentences and cloze items.

## 2. Scoping
- **Learner repositories take `profileId`:** `cardsRepo(db, profileId)` and the others. Every query filters on it, and inserts set it.
  - `learnerRepositories(db, profileId)` groups them.
  - `createRepositories(db)` keeps only the shared repositories.
- **The cloze pool vs. a learner's view of it:**
  - `clozeItemsRepo(db)` is the shared pool;
  - `learnerClozeRepo(db, profileId)` is shared items plus the learner's own mined items. "No card yet" means no card of this learner.
- **Services take `profileId` after `db`:** session start, finish and compose, focus, anchors, drills, counts, mining, grading, placement, progress, the review book and the settings.
- **Mining:** the `content_hash` of a mined item includes its owner (profile 1 keeps the old format), so two learners making the same mistake each get an item.
- **Routes:** use `profileIdOf(locals)`.

## 3. Auth and UI
- **Hooks:** `hooks.server.ts` resolves the session's profile into `locals.profile`. An archived profile counts as none.
- **No profile picked:**
  - pages go to `/profiles?next=…`;
  - `/api/*` answers 409 (`needsProfile()`);
  - the public allowlist is unchanged.
- **`/profiles`:**
  - a grid with emoji, name, level and streak;
  - "+ Thêm hồ sơ" (name and emoji);
  - "Sửa": rename, and "Ẩn hồ sơ" with a confirm dialog (archive, no hard delete);
  - "Đăng xuất".
- **A new profile:** is selected right away and starts on Home with the placement-or-basics card.
- **Header:** the tab layout shows "Hồ sơ: …" and "Đổi hồ sơ".
- **Settings:** split into "Riêng cho …" (Học tập with the placement, and this profile's AI grading usage) and "Chung cho mọi hồ sơ" (theme, content, providers, all AI usage, data, account).

## 4. Background jobs
- **Prefetch:** one shared stock. The bands come from the highest `known_band_ceiling` among the non-archived profiles. A band's cloze stock is the minimum over those profiles of the validated shared items without a card of theirs. Same budget as before.
- **Queued writings:** graded for every profile. Each call is logged with its learner's `profile_id`.
- **Streaks and freezes:** recomputed per profile on read. There is no per-day job.

## 5. Tests
- **Unit:**
  - `profiles/leakage.spec.ts`: 2 profiles with data, checked across the due queue, Home counts, session compose and finish, progress, the review book, writing history and feedback, and the placement result;
  - `db/migration-profiles.spec.ts`: a pre-0010 file database is copied, then migrated. Row counts are equal, every row belongs to profile 1, the settings are moved, shared content stays shared, and `foreign_key_check` is clean;
  - `profiles.spec.ts`: profile creation and selection;
  - the guard: `needsProfile`;
  - prefetch across profiles.
- **e2e (progress server):**
  - a second profile is created and does a session; back on profile 1, the due counts and the streak are unchanged;
  - rename, and archive with the dialog (the data stays);
  - with no profile picked, a page goes to `/profiles?next=` and the API answers 409.

## Judgement calls
- **The theme is a cookie, so it is per device, not per profile.** It is listed under "Chung".
- **An archived profile's name stays taken.** The unique index includes archived profiles, and the message says so.
- **There is no "restore" for archived profiles.** It was not asked for. The data stays in the database.
