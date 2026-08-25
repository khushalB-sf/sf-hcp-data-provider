# SF HCP Data Explorer

A grid for 50,000 healthcare provider records — grouped by region and territory
with live totals, virtualized scrolling, inline editing with async validation,
bulk edits, undo/redo, and runtime theming. React 18 + TypeScript + Vite,
everything client-side.

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # 63 tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build
```

Try `?tenant=meridian` in the URL, or the Tenant dropdown — that config is
deliberately broken and shows how the theming handles bad input.

---

## Contents

1. [What I built](#1-what-i-built)
2. [How it's put together](#2-how-its-put-together)
3. [Libraries I used, and why](#3-libraries-i-used-and-why)
4. [The tricky parts](#4-the-tricky-parts)
5. [Performance](#5-performance)
6. [Testing](#6-testing)
7. [What I'd do next](#7-what-id-do-next)
8. [Time spent](#8-time-spent)

---

## 1. What I built

All eight requirements are implemented and working — including FR-5 and FR-6,
which the brief said could be design-only. I decided to build them because
describing concurrency on paper is a lot easier than making it actually work,
and I wanted to find out where the hard bits really were.

| | |
|---|---|
| FR-1 | Virtualized grid, ~26 rows in the DOM out of 50,054 |
| FR-2 | Region → Territory grouping, totals update live, shown even when collapsed |
| FR-3 | Three-state sorting, search on name/ID, region filter |
| FR-4 | Inline editing with async validation, undo/redo |
| FR-5 | Bulk ±10% with per-row results and a report that adds up |
| FR-6 | One undo step per bulk operation, scrolls to what it changed |
| FR-7 | CPI column, computed not stored |
| FR-8 | Runtime tenant theming from untrusted config |

---

## 2. How it's put together

```
src/
  vendor/       the three provided files, unchanged
  lib/          data, cpi, rowModel, theme — plain functions, no React
  store/        Redux Toolkit slice + the actions that dispatch to it
  components/   Grid, DataRow, GroupRow, CallsCell, Toolbar, BulkBar, Footer
```

The main idea is that the **50,000 rows are not in the store**. They're in a
module variable in `lib/data.ts`, generated once and never changed. What the
store holds is small: which cells have been edited, the undo stack, what's
selected, and the current sort/filter/collapse state.

I did it this way after a first attempt where I put the rows in state and every
single edit felt sluggish — React was checking 50,000 objects on every update,
when only one of them mattered. Edits are stored as an overlay:

```ts
const callsFor = (rowId) => edits[rowId]?.committed ?? sourceValue(rowId);
```

Everything — the cells, the sorting, the totals, the CPI column — reads through
that one function, so there's only one place where "what is this row's value?"
is answered.

`lib/` has no React imports in it at all, which meant I could test the sorting
and grouping logic on its own without rendering anything.

---

## 3. Libraries I used, and why

**react-window** for the virtualization. I did start writing my own — the maths
isn't that bad for fixed-height rows — but I stopped. Getting scroll behaviour
right at 50,000 rows across browsers is exactly the sort of thing a
well-tested library has already sorted out, and I'd rather spend the time on the
parts of this brief that are actually unusual: the async validation and the undo.
I'd give a different answer if rows had variable heights, because that's where
libraries start disagreeing with each other.

The bit I did have to work out myself is how grouping fits into a flat list.
react-window wants one array of the same-height items. So I flatten the whole
group tree into a single array:

```
[region header, territory header, data, data, data, territory header, data, …]
```

Collapsing a group just makes that array shorter. Region headers, territory
headers and data rows are all just "an item at an index" as far as the
virtualizer is concerned, which turned out much simpler than trying to nest
scroll containers.

**Redux Toolkit** for state (edits, history, selection, view). This started on
Zustand — for a store this small, RTK felt like more ceremony than the problem
needed — and moved to Redux Toolkit afterwards. The shape of the store didn't
change: one slice (`appSlice.ts`) holds everything, `actions.ts` and
`history.ts` still read `store.getState()` and dispatch directly from plain
async functions without any component in the loop, which the bulk edit needs a
lot, and components still subscribe to just the one field they need via
`useSelector`.

Two things changed in the move. `markSaved`/`markRejected` used to return a
boolean straight out of the store call (dispatch doesn't give you a return
value), so that check — "is this reply still the one we're waiting for?" — now
happens as a plain read of `getState()` immediately before deciding whether to
dispatch. And `selected`/`collapsed` went from `Set`s to arrays, because Redux
state is supposed to stay plain and serializable; components that need `.has()`
build a `Set` locally with `useMemo` where it's actually on a hot path (Grid's
per-row render).

The thing I flagged about Zustand — nothing stops you putting the 50,000 rows
in the store by mistake — is exactly what RTK's dev-mode `serializableCheck`
middleware catches. That's now a real safety net instead of just discipline.

**No CSS framework.** Plain CSS with custom properties. FR-8 wants runtime
theming, and CSS variables do that natively — switching tenant is a handful of
`setProperty` calls, no re-render at all. Adding Tailwind on top would have meant
the colours lived in two places.

---

## 4. The tricky parts

### Totals must not include edits that are still validating

FR-2 asks for this, and my first thought was to filter out pending edits
wherever I add things up. That felt fragile — I'd have to remember to do it in
four places and never forget.

Instead the pending value is stored in a **different field** from the committed
one:

```ts
{ status: 'pending', committed: 15, pendingValue: 22, requestId: 7 }
```

Everything that reads a value uses `committed ?? source`. `pendingValue` isn't
in that expression, so there is no path by which a pending edit could reach a
total. It's not that I remembered to handle it — it just can't happen.

### Two replies coming back out of order

The validator takes a random 300-900ms, so a request sent second can come back
first. Every request gets a number, and when a reply arrives I check that the
cell is still waiting on *that* number:

```ts
if (edit?.status !== 'pending' || edit.requestId !== requestId) return false;
```

I nearly didn't bother, because I already lock a cell while it's validating so
you can't start two at once. But there's one case where it genuinely happens:
you start a bulk edit, cancel it, the app releases those rows, you edit one of
them again — and then the old cancelled request finally arrives. Without the
check it would overwrite your newer edit. That's a real test in
`editing.test.ts`.

### Undo has to work after you've sorted or filtered

This is the requirement I thought about most, because it sounds like it needs
special handling and actually doesn't — if you get one thing right.

The undo stack holds **what changed**, not a copy of the data:

```ts
{ rowId: 9973, from: 15, to: 22 }
```

Three fields, about 40 bytes. Copying 50,000 rows per undo step would be a lot of
memory, and restoring a copy would also put the sort and filter back, which isn't
what "undo my edit" means.

The part that makes it work regardless of the view: `rowId` is the row's index in
the source array. Sorting doesn't reorder that array — it builds a list of
indexes and sorts *that*. Filtering builds a shorter list. Collapsing a group
just leaves rows out of the flattened list. None of them touch the source. So an
undo entry points at the same HCP no matter what the grid is currently showing,
and there's no code in my undo function that looks at the sort or the filter at
all.

If I'd keyed it on the row's position on screen, every undo entry would be wrong
the moment you clicked a column header — and it would fail silently, changing
whichever row happened to be in that slot.

Four tests cover this: undo after sorting, undo after collapsing the group, undo
while the filter is hiding the row, and a check that the entry really is just
`{rowId, from, to}`.

### Undo doesn't re-validate, but redo does

Undo puts back a value the validator already said yes to. Since the validator
fails 10% of the time at random, re-checking on undo would mean sometimes you
just can't get back to a state you were in five seconds ago. That's worse than
useless.

Redo is different — that's asking to make the change *again*, and the cap of 60
is a business rule a real server could have changed. So redo does re-check, which
means redo can fail, which means it's async and needs a flag to stop two
overlapping. It felt inconsistent at first, but I think the asymmetry is right:
they're different questions.

One small thing that came out of this: a value put back by undo shows a **blue
dot**, not the green tick a saved value gets. It's a real change, but the
validator never saw it, so showing the same tick would be a bit of a lie.

### Undo when you can't see the row

The change happens regardless — the data is the data, whatever the grid is
showing. But an invisible change looks exactly like a broken button, so:

- row is on screen → scroll to it and flash it
- row is in a collapsed group → open the group, then scroll to it
- filter is hiding it → show a message with a "Clear filter and show me" button

I deliberately don't clear the filter automatically. Wiping out someone's search
because they pressed Ctrl+Z felt too pushy.

### Bulk edit with partial failure

Each row is validated on its own, so some succeed and some fail. The report is
**applied / rejected / skipped**, and those three have to equal the number of
rows you selected.

The "skipped" number is the one I nearly missed. See ASSUMPTIONS.md §6 — +10%
doesn't change anything for values of 0-4, which is about 11% of the dataset. If
I'd only reported applied and rejected, a whole-territory edit would look like
120 rows just vanished.

Cancel doesn't wait for requests that are already out. A promise can't be
cancelled, so waiting would mean the Cancel button does nothing for up to a
second. Instead it stops sending new ones and unlocks the rows; the request-id
check throws away the answers when they eventually arrive.

The whole bulk operation is **one** undo step, holding only the rows that
actually succeeded. If none succeeded, there's no undo entry at all — an undo
that undoes nothing would just be confusing.

### Theming from a config you can't trust

The brief says tenant configs come from customers and can't be trusted, and the
provided `meridian` config proves the point: `primary` is `"#ZZ8800"` (not a
colour) and `radius` is the string `"huge"`.

I check **each field on its own** rather than rejecting the whole config. Meridian
has a perfectly good background and surface colour, and throwing those away
because two other fields are broken seemed unfair to the customer.

I only accept plain hex colours — no `url(...)`, no `var(...)`, no named colours.
The values go through `element.style.setProperty()` with a property name I
control, never into innerHTML or a generated stylesheet, so a bad value can at
worst fail to parse. And the Diagnostics panel lists every rejected field with
what it was given and what was used instead, because otherwise nobody would ever
find out their config was broken.

---

## 5. Performance

I checked these in Chrome with the production build, at 1400×900.

| | |
|---|---|
| Rows in the DOM | 26 at rest, 30 while scrolling, out of 50,054 |
| Scrolling | smooth, no visible stutter dragging the scrollbar quickly |
| Initial load | under a second including generating the 50,000 rows |
| Editing one cell | instant to type, ~300-900ms for the validator (that's the mock) |
| Bulk edit, full territory (1,072 rows) | around 8 seconds, which is the validator's latency, not my code |
| Switching tenant | no visible delay — it's just CSS variables |

Things I actually changed after looking at it:

1. **`memo` on the row component, subscribing to only its own edit.** Before
   this, every visible row re-rendered whenever any cell anywhere finished
   validating. During a bulk edit that was hundreds of pointless renders per
   second.
2. **Debouncing the search box by 200ms.** Filtering 50,000 rows on every
   keystroke made typing feel laggy.
3. **Sorting within each territory rather than sorting all 50,000 at once.**
   48 sorts of ~1,000 rows instead of one big one. It's also automatically
   stable within a group, which I got for free.

The most expensive thing left is rebuilding the row model after an accepted
edit — a few milliseconds, because it re-walks all 50,000 rows to redo the
totals. It only happens once per accepted edit rather than per keystroke, so it
doesn't show. If it became a problem I'd keep the totals and adjust them by the
difference instead of recomputing.

---

## 6. Testing

63 tests, `npm test`.

The provided validator waits a random 300-900ms and fails 10% of the time, which
is fine for the app but impossible to write reliable tests against. So tests swap
in a fake one where I decide when each call finishes and whether it succeeds. The
app just calls `validate()` and doesn't know the difference.

| File | What it covers |
|---|---|
| `data.test.ts` | The things I found in the data — duplicate ids, string calls, nulls, trx of 0, the 99999 values. These are really tests of my assumptions. |
| `rowModel.test.ts` | Grouping, totals, sorting (including nulls and no-CPI going last), search, filtering, collapsing |
| `editing.test.ts` | pending → saved and pending → rejected, totals not moving while pending, a locked cell refusing a second edit, the bulk report adding up, one undo entry per bulk |
| `history.test.ts` | Undo after sorting, after collapsing, while filtered; undo not calling the validator and redo doing so; a failed redo clearing the stack; the stack cap |
| `theme.test.ts` | Per-field fallback on the broken config, unknown tenant, rejecting dodgy colour values |
| `Grid.test.tsx` | Row count stays small, aria-rowcount is the real total, no NaN/Infinity on screen, empty state |

I focused on `lib/` and `store/` because that's where a bug can be wrong without
looking wrong. Testing that a div has the right class felt like less value for
the time.

---

## 7. What I'd do next

1. **Proper keyboard navigation in the grid.** Right now you can Tab to a Calls
   cell and press Enter, and Ctrl+Z works, but there's no arrow-key movement
   between cells. This is the biggest gap and I'd do it first.
2. **Adjust totals instead of recomputing them.** After an accepted edit I
   rebuild the whole row model. Adding the difference to the affected groups
   would be much less work.
3. **Save edits to localStorage** so a refresh doesn't lose them.
4. **A test for the out-of-order replies with real timing**, not just my
   controlled fake. I've reasoned it's correct and tested it deterministically,
   but I haven't watched it happen with real random latency.
5. **Sticky group headers** while scrolling inside a big territory, so you can
   see which group you're in.
6. **Look at whether the flattened array can be built incrementally.** Right now
   collapsing a group rebuilds the whole list. It's fast enough, but it's
   O(everything) for a change that only affects one group.

---

## 8. Time spent

About a day and a half, roughly:

- Looking at the data and writing the probe script — half a morning, and the
  best-spent time of the whole thing. The duplicate-id finding changed how I
  keyed everything.
- Grid, grouping, sorting — most of the first day
- Editing, bulk, undo — most of the second day. The concurrency took longer than
  I expected, mainly because I kept finding cases I hadn't thought about.
- Tests and this README — the rest

Where I lost the most time: my first attempt kept the row data in the store and
was slow, and I spent a while adding memoization before working out that the real
problem was the data being in there at all. Moving it out fixed it in one go. The
lesson I took from that is to look at *what* is re-rendering before trying to
make renders cheaper.

See **[ASSUMPTIONS.md](./ASSUMPTIONS.md)** for everything I found in the data and
what I decided about each one.
