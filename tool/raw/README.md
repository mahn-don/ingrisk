# Raw content inputs

Inputs for `npm run content:prepare` (see `tool/prepare-content.ts`). The project owner downloaded
them by hand on **2026-10-02**: the build container cannot reach these sites. The committed files
are the originals, unchanged.

## NGSL 1.2 (New General Service List)

- Source: https://www.newgeneralservicelist.com/ (NGSL 1.2 downloads)
- License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: Browne, C., Culligan, B., & Phillips, J. (2013). The New General Service List.

| File | Contents | Used for |
|---|---|---|
| `NGSL_1.2_stats.csv` | `Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)`, 2,809 rows. The only file with ranks. | `rank`, `band` |
| `NGSL_1.2_lemmatized_for_research.csv` | 15 `##` comment lines, then `headword,form,form,...`, 2,809 rows | `forms`; form lookup for Tatoeba levels and pseudo-word rejection |
| `SUP_lemmatized.csv` | 52 supplementary words (days, months, number words) with forms; no rank | `supplementary` array; counted as band 1 |

The stats file contains `TRUE` at rank 478: a spreadsheet turned the word `true` into a boolean.
Headwords are lowercased, which restores it.

## Tatoeba (English–Vietnamese)

- Sources (per-language exports on https://tatoeba.org/en/downloads):
  - https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
  - https://downloads.tatoeba.org/exports/per_language/vie/vie_sentences.tsv.bz2
  - https://downloads.tatoeba.org/exports/per_language/eng/eng-vie_links.tsv.bz2
- Export: the weekly export dated **2026-09-26**.
- License: CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/); some sentences are CC0.
- Attribution: sentences and translations from Tatoeba (https://tatoeba.org), by its contributors.

The exports are large (the English file is ~100 MB uncompressed), so they are **not committed**:
they live in `tool/raw/tatoeba-full/`, which is gitignored. Only the derived pairs file is committed:

- `tatoeba-eng-vie.tsv`: header row, then `eng_id, eng_text, vie_id, vie_text` (tab-separated),
  sorted by `eng_id`, then `vie_id`. Texts are exactly as exported; normalization happens in
  `content:prepare`. Links pointing at deleted sentences are skipped.

To regenerate it:

```sh
mkdir -p tool/raw/tatoeba-full
# download the three .bz2 files above into tool/raw/tatoeba-full/, then:
bunzip2 -k tool/raw/tatoeba-full/*.bz2
npm run content:tatoeba-pairs
npm run content:prepare
```

## English word list (pseudo-word filtering)

- npm devDependency `word-list` 4.1.0 by Sindre Sorhus, ~274,000 words.
- License: MIT (package `license` field and bundled `license` file, checked 2026-10-02).
- Its README says the words come from https://github.com/atebits/Words (`Words/en.txt`). The
  upstream repository's license could not be checked from the build container. The list is only
  used at build time to reject candidates and is not redistributed.
