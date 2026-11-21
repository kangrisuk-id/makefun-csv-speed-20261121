# makefun-csv-speed-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kangrisuk-id/makefun-csv-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kangrisuk-id/makefun-csv-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in replacement for csv-reader 1.0.0. `solve.js`
exports `run(input)`, which returns exactly csv-reader's answer
`{columns, rows, errors}` for a broken-CSV input `{text, header}` — same
BOM handling, same stray-CR / quote-junk / unterminated-quote policy, same
short_row / long_row errors — while scanning with `indexOf` and slicing
whole runs of ordinary characters instead of walking character by
character. On the kit's practice set its parser runs about 3.8× faster
than the reference reader, with byte-identical output. `main.ts` is the
driver: it reads every case from `/input/cases.json`, answers each with
`run`, and writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

Outside the grader's container, point `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` at local folders holding `cases.json` and receiving
`answers.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
