# P21 import template samples

Drop a sample of the **current P21 price/cost import file** here (the exact
layout P21's built-in import tool expects). Used to build the exporter in
**Phase 5** — the generated file must match this layout column-for-column.

## Known so far

- The import file P21 ingests is a **`.txt`** (delimited text — tab or comma to
  be confirmed from the sample), not `.xlsx`/`.csv`. The Phase 5 exporter emits
  this `.txt` layout exactly, from included + matched lines only.
- This file remains the **write path for v1** even after the P21 API is wired up
  in Phase 3: that API is **read-only** (item + supplier-cost reads into the
  local mirror for matching). Writing costs back via the P21 Transaction API is
  out of scope for v1 — a human loads this `.txt` through P21's import tool and
  clicks "Mark applied."

## When you add the sample

Note here: the delimiter, whether there's a header row, and what each column is
(e.g. `item_id`, `supplier_id`, `new_cost`, `effective_date`, …) so the exporter
maps `pu_lines` → these columns correctly.
