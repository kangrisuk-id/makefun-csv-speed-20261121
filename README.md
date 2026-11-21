[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kangrisuk-id/makefun-csv-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kangrisuk-id/makefun-csv-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Read Broken CSV Files Faster — v2

A fast drop-in replacement for **csv-reader 1.0.0**, built for make.fun's
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` exports `run(input)` and returns, for every input
`{text, header}`, exactly csv-reader's answer `{columns, rows, errors}` —
the same records, the same broken-row policy, the same errors in the same
order — in a fraction of the CPU time.

## What v2 fixes

The first version of this entry scanned with `indexOf`, but two of its
searches were unbounded: checking a record for quotes or carriage returns
could scan to the end of the whole text, once per record. On quote-free
files that made the reader *quadratic* — doubling the input quadrupled the
time, and on large plain files it ran far slower than the baseline it was
meant to beat.

v2 bounds every search by the segment it scans:

- a record that lives on one line is sliced out whole, and the quote / CR
  tests run on that slice, so they cost the length of the line and never
  touch the rest of the text;
- an unquoted field is read by finding its nearest comma or LF, then
  handling any CRs inside that one sliced segment;
- inside a quoted field, each stretch between structural characters is
  processed the same way, CRs included.

No search ever runs to the end of the text looking for a character the
current field does not contain, so the whole read is linear in the size of
the input.

## Measured locally (Node 22, best of 3)

| Input | csv-reader 1.0.0 | this entry | v1 of this entry |
| --- | ---: | ---: | ---: |
| 200k rows × 8 cols, plain | 470 ms | **260 ms** | 67,249 ms |
| 50k rows × 40 cols, plain | 482 ms | **181 ms** | 21,538 ms |
| 60k rows × 8 cols, quoted fields | 231 ms | **122 ms** | 119 ms |
| 100k rows × 8 cols, broken rows | 284 ms | **157 ms** | 196 ms |

Answers verified identical to csv-reader 1.0.0 on the kit practice set and
on 6,000+ generated and fuzzed inputs (quoted fields with embedded commas,
line breaks and CRs, stray CRs, unterminated quotes, short and long rows,
empty lines, BOM, CRLF and LF endings, trailing CRs).

## The broken-row policy (identical to csv-reader)

- a U+FEFF at the very start of the text is dropped;
- a record ends at LF or CRLF; a line left with no characters is no record;
- outside quotes a CR not followed by LF is dropped (`stray_cr`);
- a quoted field runs to the next quote that is not doubled (`""` inside it
  is one quote; each CRLF or lone CR inside it is read as LF); what follows
  the closing quote is appended as it stands (`quote_junk`); a quote that
  never closes is a literal character and the text after it is read again
  as unquoted (`unterminated_quote`);
- fields stay strings, never trimmed or converted;
- rows are padded with `""` (`short_row`) or cut (`long_row`) to the first
  record's width; each error is `{code, line, row}` in the order met.

## Files

| File | What it is |
| --- | --- |
| `solve.js` | the reader itself: a dependency-free ES module exporting `run(input)` |
| `main.ts` | the harness driver: reads `/input/cases.json`, writes `/output/answers.json` |
| `LICENSE` | MIT |

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```
