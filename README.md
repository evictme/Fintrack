# FinTrack PWA

FinTrack is a mobile-first, offline personal finance PWA. Schema version 4 keeps the dependency-free architecture and local browser storage while adding per-source balance baselines and dedicated manual adjustments.

## Dashboard

The dashboard stays intentionally compact:

- Four balance-source cards for SoFi, Capital One, Cash App, and Cash
- Current Total Balance, which opens a full source breakdown
- Running Income and Running Expenses (posted transactions after their source baseline)
- Due Today for unpaid expenses due on the current date
- A floating `+` button for fast transaction entry

Tap a source card to open Transactions with that source filter already selected. The bottom navigation switches between Dashboard and Transactions.

## Settings

Open the cog beside the FinTrack title. Each action remains independent so future settings can be added without changing the dashboard:

- Install App appears only when the browser can install the PWA, or when iOS Add to Home Screen instructions apply.
- Export Data downloads the complete version 4 JSON data set, including baselines and adjustments.
- Import Current Backup validates and restores a v3 or v4 backup.
- Import Legacy Backup opens the same preview-first migration workflow with a configurable fallback balance source.
- Set Initial Balances records all four real-world balances and one cutoff at once. After setup it becomes Review Balance Baselines and requires explicit replacement confirmation.
- Adjust Source Balances creates a non-transaction correction from the calculated balance to an entered actual balance.
- Balance Adjustment History can safely reverse or delete corrections.
- Reset Data clears local FinTrack data after confirmation.

Data continues to live in `localStorage`. Upgrading from the previous app migrates the existing base amount to SoFi and converts its income and expenses into unified transactions.

## Initial balances and running calculations

When balances have never been initialized, FinTrack opens **Set Current Balances**. All four values start at zero, the combined total updates while typing, and setup can be skipped until later. Saving stores a separate baseline amount, timestamp, initialization flag, and update timestamp for every source. It does not create income transactions.

Each current source balance is derived as:

```text
baseline + posted income after cutoff - posted expenses after cutoff + active adjustments after cutoff
```

Received income and Paid expenses are posted. Pending income and Unpaid expenses are not. Changing status, editing, or deleting a transaction changes the derived result once; no separate mutable account total exists to double-apply it. Adjustments never appear in Running Income or Running Expenses.

Replacing initialized baselines requires a confirmation checkbox and creates an automatic local safety snapshot first. The optional negative-balance rule remains in the baseline dialog.

## Manual balance adjustments

Adjust Source Balances shows the selected source's calculated balance, the new actual balance, and the resulting difference. Saving records ID, source, previous calculated balance, new actual balance, difference, date, reason, created timestamp, and effective timestamp. A repeated submission is rejected once the calculated balance already matches.

Adjustment History displays the source, difference, previous/new balances, date, reason, and reversal state. Reversing excludes the record from calculations while retaining its audit history. Deleting removes it and recalculates from the remaining immutable inputs.

## Backup compatibility and migration

Version 4 exports include schema version, transactions, categories, the backward-readable `base` object, all four source baselines, initialization state, balance adjustments, and settings. Restoring a v4 backup recreates the same derived balances without running setup again. V3 backups are migrated into initialized source baselines. The separate legacy importer remains part of the application and offline cache indefinitely.

No import writes to storage immediately. After selecting a file, FinTrack validates the entire backup and displays:

- Detected backup format
- Total transactions found and the number that will be imported
- Existing or within-file duplicates that will be skipped
- New categories discovered
- Legacy field mappings
- Transactions requiring the configured default source

The default source starts as SoFi and can be changed to Capital One, Cash App, or Cash before confirmation. Changing it recalculates the preview. A recognized legacy `source`, `account`, `balanceSource`, or `accountName` value takes precedence over the default.

Duplicate detection uses transaction date, numeric amount, displayed category, and transaction type. It applies against current data and earlier records in the same backup. The final summary reports imported, duplicate, failed, and total processed counts.

Legacy conversion preserves transaction and due dates, numeric amounts, category values, notes, recognized status values, existing timestamps, IDs, and metadata. The complete original transaction object is also retained in `legacyMetadata`, preserving older fields such as paid dates, bill names, and permanent flags. When a field was not present, the converter applies these defaults:

- Source: selected default source
- Income status: Received
- Expense status: Paid
- Due date: transaction date
- Created and updated timestamp: the single import timestamp

Expected income maps to Pending. Other supported legacy statuses are retained. A legacy base amount is applied to its recognized or configured default source, and equivalent negative-balance settings are retained. Invalid JSON, missing required transaction fields, invalid dates, invalid amounts, and unsupported future schemas fail before confirmation. Committing builds a separate merged data object and saves it once, preventing partial imports.

Legacy imports never overwrite initialized source baselines. Imported transactions default to historical balance impact. If an import contains non-duplicate transactions dated after an existing source cutoff, the preview warns with a count and lets the user explicitly choose whether those records should affect balances. After the first successful legacy import, an uninitialized app prompts for current real-world balances; transactions before that new cutoff stay visible but are not added on top of the baseline.

Before an import, baseline change, adjustment, reversal, deletion, or full reset, FinTrack keeps an automatic rolling local safety snapshot. Up to five snapshots are retained separately from the active data.

## Unified transaction entry

Use either `+` button to add Income or Expense. Date and due date default to today. Income defaults to Received; expense defaults to Paid. Status can also be Paid, Unpaid, Received, or Pending.

Posted transactions affect balances as follows:

- Received income increases its selected source.
- Paid expenses decrease its selected source.
- Pending, Unpaid, and mismatched flexible statuses do not affect the balance.

Changing a posted transaction back to a non-posted status reverses its derived balance effect. Posting it again records a new effective timestamp. Because source balances are derived from baselines, transactions, and adjustments, Mark Paid cannot deduct twice.

The supplied category lists change with transaction type. Select `Custom...` to store an additional custom category value. Notes are available now and the storage model retains created and updated timestamps.

## Transaction history

Transactions can be filtered by type, source, status, and category, then sorted by date, amount, or category. Newest date is the default sort.

Collapsed rows show category, amount, date, and status only. Tap a row to expand its complete details and reveal Edit and Delete. Due Today uses the same expandable details, with a visible Mark Paid shortcut.

## Deep links and Apple Shortcuts

FinTrack accepts these query parameters on its installed or hosted URL:

```text
?action=expense&amount=24.50&category=Rent&source=SoFi
?action=income&amount=1800&category=NGC%20Payroll&source=SoFi
```

Parameter names and behavior:

| Parameter | Required | Accepted value |
| --- | --- | --- |
| `action` | Yes | `income` or `expense` |
| `amount` | Yes | A number greater than zero |
| `category` | Yes | A built-in or custom category; URL-encode spaces/symbols |
| `source` | Yes | SoFi, Capital One, Cash App, or Cash (case-insensitive) |

Income deep links save as Received; expense deep links save as Paid. FinTrack saves the transaction immediately, refreshes the dashboard, shows a confirmation, and removes the query string with `history.replaceState`. A short session lock rejects rapid duplicate launches, and removing the query prevents a browser refresh from submitting again. Invalid links show an error and create no transaction.

### Suggested Apple Shortcut

1. Add **Choose from Menu** with Income and Expense choices and store the result in `action`.
2. Add **Ask for Input**, choose Number, and store it as `amount`.
3. Add **Choose from List** for your categories and store the result as `category`.
4. Add **Choose from List** with SoFi, Capital One, Cash App, and Cash; store it as `source`.
5. Add a **URL** action using your deployed FinTrack address. Insert the four variables as query parameters in the format above. Shortcuts URL-encodes inserted variables.
6. Add **Open URLs**. When the installed PWA is associated with that address, it opens FinTrack and creates the transaction without another form submission.
7. Name the Shortcut (for example, “Add FinTrack Transaction”) and enable **Use with Siri** / invoke it by name.

Whether iOS opens the standalone PWA or Safari can depend on the installed site and iOS version, but transaction creation works in either context because it uses the same hosted URL and local storage for that context.

## Extension points

`data.js` owns schema normalization, on-device migration, validation, persistence, transaction saving, and local safety snapshots. `balance.js` owns baseline state and all derived balance calculations. `adjustments.js` owns correction preview, creation, reversal, and deletion. `backup.js` owns version detection, conversion, duplicate analysis, cutoff choices, and atomic restore/merge construction. `app.js` owns rendering and interactions.

Future recurring rules, budgets, analytics, reports, tags, attachments, and bank synchronization can add normalized fields or separate top-level collections. New on-device schemas belong in `normalizeData`; new backup versions add a converter and detection branch in `backup.js`. Balance-affecting features should feed `balance.js` rather than editing totals directly.
