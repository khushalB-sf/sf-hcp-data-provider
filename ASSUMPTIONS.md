# Assumptions

Things I found in the data that the brief didn't mention, and what I decided to
do about each one. I found most of these by writing a small script to look at
the generated rows before I started building, which turned out to be the most
useful hour I spent on this.

---

## 1. `record.id` is not unique

**What I found.** There are 50,000 rows but only 49,995 different ids. Five ids
appear twice. Looking at the generator, this line does it:

```js
if (i > 0 && i % 9973 === 0) id = rows[i - 1].id;
```

It's not just neighbouring rows either — some of the duplicated pairs are in
completely different regions. For example `HCP-009973` is Priya Iyer in West,
and also David Khan in National.

**Why it mattered.** My first instinct was to key edits by `record.id`, which is
what I'd normally do. That would have meant editing one HCP silently changed a
different HCP in another region, and threw off two regions' totals. I only
noticed because I wrote the duplicate-id check before writing any UI.

**What I did.** I use the row's **index in the array** as its id, everywhere —
edits, selection, undo. I called the type `RowId` so it's obvious what it is.
This works because I never sort or filter the array itself; I only build lists
of indexes and sort those. The source array is created once and left alone.

If this data came from an API where the order could change between requests,
this approach would break. That's worth saying out loud. For a deterministic
generator it's safe, and there isn't a better option given the ids aren't
unique.

**Knock-on effect.** For FR-2's "HCP count", I count **rows**, not distinct ids.
Counting distinct ids would make five territories report one fewer HCP than they
actually have.

---

## 2. `calls` is sometimes a string

**What I found.** The type is `number | string`, and 236 rows really do arrive as
strings like `"23"`. They all look like numbers — none of them are `"n/a"` or
anything awkward.

**Why it mattered.** I nearly shipped a sort that compared them directly. Mixing
the two types goes wrong in ways that don't throw an error:

- `9 > 10` is `false`, but `"9" > "10"` is `true`
- `23 + "17"` gives `"2317"`, not `40` — so a total silently becomes a very long
  string instead of a number

**What I did.** One function, `toNumber()`, converts it, and I call it at the
edge so nothing downstream ever sees the union type. Sorting uses the numeric
value, so `"9"` sits between 8 and 10 where you'd expect.

I show these values in italics with a tooltip, so you can tell they came in as
text — but that's a display thing only. It doesn't affect where they sort. It
felt wrong to punish a row for how its value was typed in the source.

---

## 3. 515 rows have `specialty: null`

**What I did.** I render the word `null` in italics rather than leaving the cell
empty. An empty cell looks like the grid failed to draw something; showing
`null` says "we know, and this is what the data says".

For sorting, rows with a null specialty always go **last**, whichever direction
you sort. I nearly put them first when sorting descending, but then realised
that flipping the sort direction would fill the whole screen with 515 blanks and
hide the data you just asked to see. Excel puts blanks last both ways, so I did
the same.

---

## 4. 112 rows have `trx: 0`, which breaks CPI

**What I found.** CPI is Calls / TRx × 100, and 112 rows have TRx of 0.

**What I did.** CPI returns `undefined` for those, shown as an em dash. Not 0,
because 0 would claim the HCP costs nothing per prescription, which is a
different (and wrong) statement from "we can't work this out".

Those rows sort last in both directions too, same reasoning as the nulls.

---

## 5. Some rows have `calls: 99999`

**What I found.** A handful of rows have exactly 99999 calls. Given the validator
caps calls at 60, this looks like a "no data" placeholder rather than a real
number.

**What I did.** I left them in. It's not my call to decide someone else's data is
wrong and silently drop it — the totals would then not match the source. But I do
flag them: a group containing one shows a small `!1` chip next to its Calls total,
explaining why the number looks off.

Side effect: one of them (TRx of 62) works out to a CPI of 161,289%. That's a
real, finite number, so `Number.isFinite` doesn't catch it, but it stretches the
column and looks like a bug. I cap the **display** at `>999%` with the real value
in the tooltip. Sorting still uses the uncapped number.

Also worth knowing: because 99999 is already over the cap of 60, **any** edit to
one of those rows will be rejected by the validator. That's the validator's rule,
not mine, so I let it happen and show the reason.

---

## 6. A +10% bulk edit doesn't change about 11% of rows

**What I found.** This one surprised me. `Math.round(v * 1.1) === v` is true for
v of 0, 1, 2, 3 and 4 — rounding eats the increase. That's roughly 5,600 rows,
about 11% of the dataset. A whole-territory +10% typically leaves ~120 rows
untouched.

**What I did.** The bulk report has three numbers, not two: **applied /
rejected / skipped**, and they have to add up to how many rows you selected.
Without the third number the report looks like rows went missing. There's even
a warning chip in the UI if they don't add up, in case I've got the counting
wrong somewhere.

---

## Decisions that weren't about the data

**Aggregates and pending edits.** FR-2 says totals must not include edits that
are still being validated. Rather than remembering to filter them out in each
place, I made the value a cell reads be `committed ?? source` — and the value
that's still in flight lives in a *different* field that expression can't reach.
So it isn't possible to accidentally count one.

**Editing a cell that's already validating.** I refuse the second edit rather
than queueing it. With 300-900ms of latency, queueing would mean a chain of
edits where it's unclear what the final value should be if one in the middle
fails. Refusing is simpler to explain to a user.

**Undo doesn't re-check, redo does.** Undo puts back a value the validator
already accepted. Since the validator fails 10% of the time at random,
re-checking on undo would mean undo could just refuse to work, which is worse
than not having it. Redo is the user asking to make the change *again*, and the
cap could in principle have changed on the server, so redo does re-check — which
means redo can fail, and I show that when it happens.

**Row order after an edit.** Totals update straight away, but rows don't
re-sort. If they did, a row could jump off screen the moment you finished typing
in it. You can click the column header again to re-sort.

**Bulk edits apply to hidden rows too.** If you select rows and then change the
filter, the bulk action still applies to everything you selected. You picked
those rows on purpose, and having a filter quietly shrink the target seemed
worse. The report tells you how many of the changed rows are currently hidden.

---

## What I didn't do

- **Column pinning and resizing.** Not in the brief; I focused on what was asked.
- **Full keyboard navigation of the grid.** You can Tab to a Calls cell and press
  Enter to edit it, and Ctrl+Z / Ctrl+Shift+Z work anywhere. Proper arrow-key
  movement between cells is the next thing I'd add.
- **Saving edits anywhere.** Refreshing the page loses them. The brief says no
  server, and I didn't want to invent a persistence story that wasn't asked for —
  though localStorage would be a small addition.
- **Variable row heights.** Every row is 32px, which is what makes the scroll
  maths simple. Would need rethinking if a row could wrap.
