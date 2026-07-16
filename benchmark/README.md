# theke benchmark suite

Permanent, versioned regression-test question sets for the chat/RAG pipeline.
Unlike `backend/tests/`, these aren't pass/fail assertions runnable by
`pytest` - they're professional-scenario Greek-language questions that
require a qualitative read (PASS / PARTIAL / FAIL / HONEST GAP) against real
GPT-4o output, because the thing under test is answer *quality*, not code
correctness.

## The rule

**A benchmark run that isn't saved to `benchmark/results/` didn't happen**,
for the purposes of any future comparison. Scores mentioned in chat, in
`KNOWN_DECISIONS.md`, or anywhere else that aren't backed by a dated file in
`benchmark/results/` cannot be used as a "previous score" baseline - this
project has already hit that wall once (the original 105-question and
7-question benchmarks were run in an earlier session, never saved to the
repo, and turned out to be unrecoverable when a later regression sweep
needed to diff against them). Every run, without exception, gets a dated
result file before the session that ran it ends.

## Structure

- **`comprehensive-105.md`** - 105 questions across 5 sections (1A/1B/1C
  niche+common, 2A/2B complex scenarios), construction + tax/accounting.
  Baseline established `2026-07-16` (see below - the original run predates
  this directory and its exact question wording/scores were not recoverable,
  so this is a fresh baseline, not a reconstruction).
- **`stress-round-1.md`** - 7 questions (3 construction, 3 accounting) + one
  "killer prompt" (meta-instruction wrapper). Baseline established
  `2026-07-16`, same reason as above.
- **`stress-round-3.md`** - 10 scenarios (5 construction, 5 accounting) + 2
  nightmare-prompt runs (same meta-instruction wrapper as stress-round-1's
  killer prompt, applied to two of the 10 scenarios). This one *does* have a
  real prior baseline - reconstructed from `KNOWN_DECISIONS.md`'s per-question
  narrative, which recorded enough detail to diff against.

## Most recent result per set

| Set | Latest result file |
|---|---|
| comprehensive-105 | `results/2026-07-16-comprehensive-105.md` |
| stress-round-1 | `results/2026-07-16-stress-round-1.md` |
| stress-round-3 | `results/2026-07-16-stress-round-3.md` |

## Scoring rubric (all sets)

- **PASS** - answer is correct, complete, properly cited, and doesn't
  fabricate or omit anything material.
- **PARTIAL** - answer is correct as far as it goes but misses a sub-part of
  a multi-part question, or is right on the primary ask but weak/unclear on
  a secondary one.
- **FAIL** - answer asserts something false, fabricates a relationship or
  citation the sources don't support, or otherwise gets something material
  wrong with unwarranted confidence.
- **HONEST GAP** - the knowledge base genuinely doesn't have the content
  needed, and the answer says so explicitly rather than guessing. This is
  scored as an acceptable outcome, not a failure - fabricating past a real
  content gap would be worse than admitting it.
- **OUT OF SCOPE** (comprehensive-105 only) - a question the KB is
  deliberately not meant to answer (falls outside either vertical's actual
  coverage), correctly declined.

Stress-round-1's killer prompt and stress-round-3's nightmare prompts use an
additional 4-property rubric on top of the above - see those files for the
exact properties (article+ΦΕΚ citation per claim, amended-provision current
form, named conflicting circulars or explicit "none found", explicit
gap-naming).
