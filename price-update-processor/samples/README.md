# P21 import template samples

The exact layout P21's built-in import tool expects. The **Phase 5 exporter must
match this column-for-column.** Real data files here are **gitignored** (they're
confidential cost data — see `.gitignore`); only this README is tracked.

## Confirmed format (from `GAT2026.txt`, a real Gates import)

- **Tab-delimited `.txt`**, **CRLF** line endings, **with a header row**.
- Exactly **4 columns**, in this order:

  | Column | Source in our data | Notes |
  |---|---|---|
  | `Item ID` | `pu_lines.p21_item_id` | The **prefixed P21 item number** (see below) |
  | `List Price` | `pu_lines.new_list` | plain decimal, no `$`/commas |
  | `New Cost` | `pu_lines.new_cost` | plain decimal |
  | `Supplier ID` | vendor's `p21_supplier_id` | e.g. Gates = `10638` |

- Header line: `Item ID⇥List Price⇥New Cost⇥Supplier ID`
- Example rows (illustrative):
  `GAT QD12/8V71.00⇥63590.97⇥29658.83⇥10638`
- **No effective-date column.** Effective date is metadata we track on the batch
  (and the user keys into P21's import UI); it is *not* part of the export file.

## The P21 item-number prefix (important for Phase 3 matching)

P21 item IDs are `<3-letter vendor prefix><space><vendor part number>`, e.g.
`GAT QD12/8V71.00` = prefix **`GAT `** + vendor part **`QD12/8V71.00`**. The
prefix is per-vendor. To match a vendor's price-file line (bare part number) to a
P21 item we bridge the two:
- strip the vendor prefix from the P21 item id → compare to the vendor part, **or**
- prepend the prefix to the vendor part → look up the P21 item id.

Plan: store the literal prefix per vendor (e.g. `pu_vendors.p21_item_prefix = 'GAT '`)
in a Phase 3 migration and use it in the matching normalization. The `strip_prefix`
parse transform is a *different* thing (it strips noise from the vendor's own file);
this prefix is the P21 side. "Usually the same part number" per Porter — the
exceptions are exactly what a historical crosswalk (see build notes) would capture.
