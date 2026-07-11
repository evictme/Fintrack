# FinTrack PWA

FinTrack is a dependency-free, mobile-first personal finance PWA. Schema version 4 stores data locally, works offline, and combines source baselines, derived transaction balances, manual corrections, legacy migration, and Siri transaction entry.

## Dashboard and transactions

The dashboard contains SoFi, Capital One, Cash App, and Cash balance cards; combined current balance; posted income and expense totals; Due Today; and a floating transaction button. Tap a source to open filtered transaction history.

The unified form supports Income or Expense, source, date, due date, amount, flexible status, built-in/custom category, and notes. Transaction rows expand to show details, Edit, and Delete.

Received income and Paid expenses affect their source. Pending income and Unpaid expenses do not. Balances are derived, so status changes, edits, and deletions reverse and reapply effects without double counting.

## Balance baselines and corrections

When balances are uninitialized, **Set Current Balances** asks for all four real-world balances and one cutoff timestamp. Values start at zero, the combined total updates while typing, and setup can be skipped. No starting-balance income transactions are created.

Each source is calculated as:

```text
baseline + posted income after cutoff - posted expenses after cutoff + active adjustments after cutoff
```

After setup, Settings shows **Review Balance Baselines**. Replacing initialized baselines requires explicit confirmation and creates a local safety snapshot.

**Adjust Source Balances** shows calculated balance, actual balance, difference, date, and optional reason. Corrections are stored separately from transactions and excluded from income/expense totals. **Balance Adjustment History** can reverse or delete them safely.

## Settings and backups

Settings includes Install App when applicable, Export Data, Import Current Backup, Import Legacy Backup, initial/review balances, source adjustments, adjustment history, and Reset Data.

Version 4 exports include schema version, transactions, categories, base compatibility data, per-source baselines and initialization state, adjustment history, and settings. V3 backups migrate to initialized baselines. Current restores recreate the same derived balances.

The legacy importer permanently supports backups with separate `income` and `expenses` arrays. It preserves dates, amounts, categories, notes, IDs, timestamps, metadata, and the complete original record in `legacyMetadata`. Missing sources use the selected default. Missing statuses become Received or Paid, and missing due dates use transaction date.

Before commit, the importer shows totals, duplicates, categories, mappings, default-source assignments, and post-baseline records. Duplicate matching uses date, amount, displayed category, and transaction type. Legacy records are historical by default; post-cutoff records affect balances only when explicitly selected. Initialized baselines are never overwritten by a later legacy import.

Imports validate completely and commit atomically. FinTrack retains up to five local safety snapshots before imports, baseline changes, adjustments, reversals/deletions, and reset.

## Structured deep links

Existing structured links remain supported:

```text
?action=expense&amount=24.50&category=Rent&source=SoFi
?action=income&amount=1800&category=NGC%20Payroll&source=SoFi
```

They validate and save through the same `saveTransaction` service used by the form.

## Natural-language Siri entry

The voice format is:

```text
?action=voice&text=Expense%2C%2024.50%20for%20Amazon%20from%20SoFi
```

`voice-parser.js` runs entirely on-device without an AI API or network request. It deterministically parses:

- Income/expense language with precedence for “paid me,” payroll, payout, and ordinary paid expenses
- Numeric, comma-separated, dollar/cents, and common number-word amounts
- SoFi, Capital One, Cash App, and Cash aliases
- Built-in categories and likely Siri variations, matching longer names first
- Custom phrases such as “for groceries” and “from freelance work”
- Paid, Unpaid, Received, and Pending
- Today, yesterday, tomorrow, weekdays, and named local dates

Complete high-confidence drafts save automatically through `saveTransaction`; the existing balance engine handles the result. Incomplete drafts open the unified form with recognized values prefilled, missing fields blank, a concise explanation, and focus on the first missing field.

Successful entries show transaction type plus category, amount, and source, with an eight-second Undo action. Undo removes only that transaction and recalculates derived balances.

A hashed fingerprint covers parsed type, amount, source, category, date, and normalized dictated text. It is held briefly in `sessionStorage`. The query is removed with `history.replaceState`, and centralized startup, `pageshow`, and visibility handling prevents duplicate lifecycle submissions.

Dictated text is never logged, sent to an AI/external API, placed in notes, or exported. Only `inputMethod: "siri-voice"` is retained. Once the PWA is service-worker controlled, action-query navigations are served from the local shell and are not forwarded to the network. A first browser visit before service-worker control inherently requests the supplied URL from its hosting origin, so deploy FinTrack only on an origin you trust.

## Apple Shortcut: Record FinTrack Transaction

1. Create a Shortcut and add **Dictate Text**.
2. Set the prompt to `What transaction would you like to record?`.
3. Set **Stop Listening** to **After Pause** or another practical option.
4. Add a **URL** action using your deployed FinTrack URL.
5. Append `?action=voice&text=`.
6. Insert **Dictated Text** immediately after `text=`.
7. If your iOS version does not encode it reliably, apply **URL Encode** to Dictated Text and insert that result.
8. Add **Open URLs**.
9. Name the Shortcut exactly `Record FinTrack Transaction`.
10. Say `Hey Siri, Record FinTrack Transaction`.

iOS may open the installed PWA or Safari depending on version and site handling. The transaction is recorded in whichever browser/PWA storage context owns the FinTrack data.

### Suggested spoken examples

```text
Expense, 24 dollars and 50 cents for Amazon from SoFi.
I spent 18 dollars on Netflix from Cash App.
Paid 72 dollars for Xfinity Mobile from Capital One.
Unpaid expense, 95 dollars for Peoples Gas from SoFi, due Friday.
Income, 1,850 dollars from NGC Payroll into SoFi.
I received 280 dollars from Lyft Payout into Cash App.
Deposit 500 dollars from freelance work into Capital One.
Expense, 40 dollars for groceries from Cash.
```

## Offline behavior

The service worker serves the canonical shell for navigation while leaving the query visible to the page. It never caches a separate shell for each dictated phrase. Static assets remain cache-first, and the cache version changes whenever application modules change.

## Tests and extension points

Run the dependency-free test modules with Node:

```text
node tests/voice-parser.test.mjs
node tests/deep-link.test.mjs
```

`data.js` owns schema normalization, validation, persistence, and transaction saving. `balance.js` owns derived balances. `adjustments.js` owns corrections. `backup.js` owns conversion and import analysis. `voice-parser.js` owns natural-language parsing. `deep-link.js` owns URL normalization and short-lived fingerprint claims. `app.js` owns UI and lifecycle orchestration.
