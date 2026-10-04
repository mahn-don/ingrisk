# Phase 1 — Content data preparation

Goal: a re-runnable script turning raw inputs into three server-side JSON assets. No app code.

## Commands

```sh
npm run content:tatoeba-pairs   # tool/raw/tatoeba-full/* -> tool/raw/tatoeba-eng-vie.tsv (only when the exports change)
npm run content:prepare         # tool/raw/* -> src/lib/server/content/*.json + tool/pseudowords-review.txt
```

Both are deterministic: re-running leaves `git status` clean. Pure logic is in `tool/lib/` and
tested in `tool/lib/*.spec.ts`; the entry scripts only read and write files.

## Raw inputs

Sources, licenses and regeneration steps are in [`tool/raw/README.md`](../tool/raw/README.md).

- NGSL 1.2 from newgeneralservicelist.com: `NGSL_1.2_stats.csv`,
  `NGSL_1.2_lemmatized_for_research.csv`, `SUP_lemmatized.csv` (committed).
- Tatoeba per-language exports `eng_sentences`, `vie_sentences`, `eng-vie_links` from
  downloads.tatoeba.org (gitignored in `tool/raw/tatoeba-full/`), joined into the committed
  `tool/raw/tatoeba-eng-vie.tsv`.
- English word list: npm `word-list` 4.1.0 (MIT).

## Outputs (`src/lib/server/content/`)

Each file has `{ source, license, attribution, count, items }`.

| File | Items | Count |
|---|---|---|
| `ngsl.json` | `{ headword, pos, rank, band, forms }`, plus top-level `supplementary: [{ headword, forms }]` | 2,809 + 52 supplementary |
| `tatoeba-en-vi.json` | `{ tatoeba_id_en, tatoeba_id_vi, en, vi, word_count, ngsl_band_max, off_list_count }` | 19,198 |
| `pseudowords.json` | `{ form }` | 120 |

Nothing imports these files yet; Phase 5 (import) and Phase 8 (placement) will.

## NGSL

- 2,809 ranked headwords; 10,307 forms loaded in total (10,126 from the lemmatized list,
  181 from the supplementary list), headwords included.
- Bands: `ceil(rank / 352)`, i.e. bands 1–7 hold 352 words and band 8 holds 345.
- Cross-check, stats vs lemmatized: **0 mismatches** in either direction.
- `pos` is `null` for every item: none of the files has a part-of-speech column.

## Tatoeba counts

Join: 23,175 links → 23,167 pairs (7 links point at deleted English sentences, 4 at deleted
Vietnamese ones; three links are missing both).

| Step | Removed | Remaining |
|---|---:|---:|
| Before filtering | | 23,167 |
| 1. Empty English or Vietnamese | 0 | 23,167 |
| 2. English longer than 15 words | 424 | 22,743 |
| 3. English has characters outside basic Latin, digits and common punctuation | 51 | 22,692 |
| 4. Vietnamese identical to English | 1 | 22,691 |
| 5. Vietnamese without diacritics (3+ words) | 4 | 22,687 |
| 6. Duplicate English sentence | 3,489 | **19,198** |

`ngsl_band_max` distribution: band 1: 5,736 · 2: 3,485 · 3: 2,645 · 4: 2,404 · 5: 1,574 ·
6: 1,276 · 7: 1,075 · 8: 904 · null (no NGSL word at all, e.g. "Congratulations!"): 99.

## Pseudo-words

- Seed `20261002`. Template: onset + vowel + medial cluster + rime, 5–9 letters. The medial
  cluster (the first syllable's coda plus the second syllable's onset) comes from a whitelist of
  clusters English uses, e.g. pl+u+**rth**+y, d+i+**sp**+one.
- Rejected if: on `tool/pseudowords-exclude.txt`; any NGSL form or supplementary word; in the
  word list; a real word after adding or removing -s, -ed, -ing, -er or -y (with simple e-drop);
  `q` without `u`; three identical letters; ending in v, j or q; a blocked offensive substring.
- The final 120 are in `tool/pseudowords-review.txt`. To remove a word, add it to
  `tool/pseudowords-exclude.txt` and re-run `content:prepare`. Only that word is replaced; the
  rest keep their places.
- **Manual review done (2026-10-02).** The owner excluded 11 words (toprope, eldon, thepet,
  thurush, stringock, earthast, hourlon, hourgule, skinide, gridow, clipond). The same rule was
  then applied to the replacements: any starting with a real word of 4+ letters (in `word-list`
  or NGSL) was excluded too, over four more rounds (choupot, hishey, hemplate, snogrey, doobane,
  flabule, fronthen, tounky, fountet, torthot). Final replacements: cezey, coodide, daclot,
  flaincule, frouspen, gurgond, nengible, slosock, sloubix, vuskel, wuskid.

## Judgement calls

1. **Band size:** `ceil(2809 / 8) = 352` words per band, so band 8 is the short one (345).
2. **Supplementary overlap:** `may` and `march` are both ranked headwords and supplementary
   words. Both entries are kept; for levelling, a form takes the lowest band of any headword
   listing it.
3. **Form conflicts:** some forms belong to several headwords (e.g. `found` is a headword and a
   form of `find`). The form index uses the lowest, i.e. most frequent, band.
4. **Levelling heuristic** (documented in `analyzeLevel`): known words are matched before
   proper-noun detection, so "Monday" and "I" count as known. Contractions are reduced to their
   first word ("don't" → "do", "won't" → "will"). Hyphenated words are split. Pieces containing
   digits are skipped. A sentence-initial unknown name ("Tom ...") counts as off-list, because
   only non-initial capitalized words are treated as proper nouns.
5. **Allowed English characters:** letters, digits, space and `. , ! ? ; : ' " ( ) -`. Symbols
   such as `$`, `%`, `&`, `/` and the em dash count as outside the set (51 pairs dropped).
6. **Word count** is the number of space-separated pieces after normalization, numbers included.
7. **Deduplication** compares English case-insensitively after normalization and keeps the pair
   with the lowest Vietnamese id (ties: the lowest English id).
8. **Derived TSV** has a header row; the parser accepts files with or without it.
9. **Pseudo-word order** is generation order, which the seed already fixes. It is not re-shuffled
   after the fact, so adding a word to the exclude list replaces only that word.
10. **Pseudo-word license:** the generated list is marked CC0 1.0; there is no upstream source.
11. **Content warning:** Tatoeba includes profanity and crude sentences (e.g. "Fuck!",
    "Bastard!"). Phase 1 does not filter them. Phase 5 should consider a blocklist before items
    reach the learner.
