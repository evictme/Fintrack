import {
  CATEGORIES,
  SOURCES,
  STATUSES,
  createId,
  displayCategory,
  normalizeData,
  resolveSource
} from './data.js';
import { SOURCES as BALANCE_SOURCES, areBalancesInitialized, dateToTimestamp } from './balance.js';

export class BackupImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupImportError';
  }
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const finiteNumber = value => {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const numberAmount = value => {
  const amount = finiteNumber(value);
  return amount !== null && amount >= 0 ? amount : null;
};
const normalizedCategory = transaction => displayCategory(transaction).trim().toLocaleLowerCase();
const duplicateKey = transaction => [transaction.date, Number(transaction.amount), normalizedCategory(transaction), transaction.type].join('|');

export function detectBackupFormat(raw) {
  if (!isObject(raw)) throw new BackupImportError('This file is not a valid FinTrack backup object.');
  if (Array.isArray(raw.transactions)) {
    if (Number(raw.schemaVersion || 3) > 4) throw new BackupImportError('This backup was created by a newer, unsupported FinTrack version.');
    return Number(raw.schemaVersion || 3) >= 4 ? 'current-v4' : 'current-v3';
  }
  if (Array.isArray(raw.income) || Array.isArray(raw.expenses)) return 'legacy-v2';
  throw new BackupImportError('FinTrack transaction data is missing from this backup.');
}

function requireTransactionFields(item, label, category, date) {
  if (!isObject(item)) throw new BackupImportError(`${label} is not a valid transaction record.`);
  if (!validDate(date)) throw new BackupImportError(`${label} has a missing or invalid date.`);
  if (numberAmount(item.amount) === null) throw new BackupImportError(`${label} has a missing or invalid amount.`);
  if (!String(category || '').trim()) throw new BackupImportError(`${label} has a missing category.`);
}

function legacyStatus(item, type) {
  const status = String(item.status || '').toLowerCase();
  if (STATUSES.includes(status)) return status;
  if (status === 'expected') return 'pending';
  return type === 'income' ? 'received' : 'paid';
}

function inferredLegacySource(item, defaultSource) {
  return resolveSource(item.source || item.account || item.balanceSource || item.accountName) || defaultSource;
}

// Each version-specific converter returns the same neutral payload. A future
// schema only needs another converter and a branch in detectBackupFormat.
function convertLegacyV2(raw, options) {
  const importedAt = options.importedAt;
  const defaultSource = resolveSource(options.defaultSource) || 'SoFi';
  const transactions = [];
  let defaultSourceCount = 0;
  const incomes = raw.income || [];
  const expenses = raw.expenses || [];
  if (!Array.isArray(incomes) || !Array.isArray(expenses)) throw new BackupImportError('Legacy income or expense data is corrupted.');

  incomes.forEach((item, index) => {
    const label = `Legacy income #${index + 1}`;
    const category = item?.description || item?.category || item?.name;
    const date = item?.date;
    requireTransactionFields(item, label, category, date);
    const inferred = resolveSource(item.source || item.account || item.balanceSource || item.accountName);
    if (!inferred) defaultSourceCount += 1;
    transactions.push({
      id: String(item.id || createId()),
      date,
      dueDate: validDate(item.dueDate) ? item.dueDate : date,
      type: 'income',
      source: inferredLegacySource(item, defaultSource),
      category: String(category),
      customCategory: String(item.customCategory || ''),
      amount: numberAmount(item.amount),
      status: legacyStatus(item, 'income'),
      notes: String(item.notes || ''),
      metadata: isObject(item.metadata) ? clone(item.metadata) : {},
      legacyMetadata: clone(item),
      createdAt: validTimestamp(item.createdAt) ? item.createdAt : importedAt,
      updatedAt: validTimestamp(item.updatedAt) ? item.updatedAt : importedAt
    });
  });

  expenses.forEach((item, index) => {
    const label = `Legacy expense #${index + 1}`;
    const category = item?.category || item?.name;
    const transactionDate = validDate(item?.date) ? item.date : (validDate(item?.paidDate) ? item.paidDate : item?.dueDate);
    requireTransactionFields(item, label, category, transactionDate);
    const inferred = resolveSource(item.source || item.account || item.balanceSource || item.accountName);
    if (!inferred) defaultSourceCount += 1;
    transactions.push({
      id: String(item.id || createId()),
      date: transactionDate,
      dueDate: validDate(item.dueDate) ? item.dueDate : transactionDate,
      type: 'expense',
      source: inferredLegacySource(item, defaultSource),
      category: String(category),
      customCategory: String(item.customCategory || ''),
      amount: numberAmount(item.amount),
      status: legacyStatus(item, 'expense'),
      notes: String(item.notes || ''),
      metadata: isObject(item.metadata) ? clone(item.metadata) : {},
      legacyMetadata: clone(item),
      createdAt: validTimestamp(item.createdAt) ? item.createdAt : importedAt,
      updatedAt: validTimestamp(item.updatedAt) ? item.updatedAt : importedAt
    });
  });

  const basePatch = null;
  let resolvedBasePatch = basePatch;
  if (isObject(raw.base) && raw.base.amount !== undefined) {
    const amount = finiteNumber(raw.base.amount);
    if (amount === null) throw new BackupImportError('The legacy base income amount is invalid.');
    const baseSource = resolveSource(raw.base.source || raw.base.account || raw.base.balanceSource) || defaultSource;
    resolvedBasePatch = { date: validDate(raw.base.date) ? raw.base.date : null, balances: { [baseSource]: amount }, replaceBalances: false };
  }

  const settingsPatch = { legacyDefaultSource: defaultSource };
  if (typeof raw.settings?.preventNegativeBalances === 'boolean') settingsPatch.preventNegativeBalances = raw.settings.preventNegativeBalances;
  return {
    format: 'legacy-v2',
    formatLabel: 'Legacy FinTrack backup',
    transactions,
    basePatch: resolvedBasePatch,
    settingsPatch,
    defaultSourceCount,
    mappings: [
      'Legacy income description/category → Category',
      'Legacy expense category/name → Category',
      'Paid date or due date → Transaction date',
      'Missing due date → Transaction date',
      'Expected status → Pending; missing status → Received/Paid',
      `Missing balance source → ${defaultSource}`,
      'Missing timestamps → Import time',
      'Original legacy record → Legacy metadata'
    ]
  };
}

function convertCurrentBackup(raw, options, format) {
  if (!isObject(raw.base) || !isObject(raw.base.balances)) throw new BackupImportError('The current backup is missing base balance data.');
  const transactions = raw.transactions.map((item, index) => {
    const label = `Transaction #${index + 1}`;
    requireTransactionFields(item, label, item?.category, item?.date);
    if (!['income', 'expense'].includes(item.type)) throw new BackupImportError(`${label} has an invalid transaction type.`);
    const source = resolveSource(item.source);
    if (!source) throw new BackupImportError(`${label} has an invalid balance source.`);
    if (!validDate(item.dueDate)) throw new BackupImportError(`${label} has a missing or invalid due date.`);
    if (!STATUSES.includes(item.status)) throw new BackupImportError(`${label} has an invalid status.`);
    return {
      id: String(item.id || createId()),
      date: item.date,
      dueDate: item.dueDate,
      type: item.type,
      source,
      category: String(item.category),
      customCategory: String(item.customCategory || ''),
      amount: numberAmount(item.amount),
      status: item.status,
      notes: String(item.notes || ''),
      metadata: isObject(item.metadata) ? clone(item.metadata) : {},
      legacyMetadata: isObject(item.legacyMetadata) ? clone(item.legacyMetadata) : null,
      balanceImpact: item.balanceImpact === 'historical' ? 'historical' : 'normal',
      balanceEffectiveAt: validTimestamp(item.balanceEffectiveAt) ? item.balanceEffectiveAt : dateToTimestamp(item.date),
      createdAt: validTimestamp(item.createdAt) ? item.createdAt : options.importedAt,
      updatedAt: validTimestamp(item.updatedAt) ? item.updatedAt : options.importedAt
    };
  });
  const balances = {};
  SOURCES.forEach(source => {
    const amount = finiteNumber(raw.base.balances[source]);
    if (amount === null) throw new BackupImportError(`The ${source} base balance is missing or invalid.`);
    balances[source] = amount;
  });
  const settingsPatch = { legacyDefaultSource: resolveSource(raw.settings?.legacyDefaultSource) || options.defaultSource };
  if (typeof raw.settings?.preventNegativeBalances === 'boolean') settingsPatch.preventNegativeBalances = raw.settings.preventNegativeBalances;
  if (format === 'current-v4') {
    if (!isObject(raw.sourceBalances)) throw new BackupImportError('The backup is missing source balance baselines.');
    BALANCE_SOURCES.forEach(source => {
      const baseline = raw.sourceBalances[source];
      if (!isObject(baseline) || finiteNumber(baseline.baselineAmount) === null || !validTimestamp(baseline.baselineDate) || typeof baseline.initialized !== 'boolean') {
        throw new BackupImportError(`The ${source} balance baseline is invalid.`);
      }
    });
    if (!Array.isArray(raw.balanceAdjustments)) throw new BackupImportError('The balance adjustment history is missing or invalid.');
    raw.balanceAdjustments.forEach((adjustment, index) => {
      if (!isObject(adjustment) || !adjustment.id || !resolveSource(adjustment.source) || finiteNumber(adjustment.previousCalculatedBalance) === null || finiteNumber(adjustment.newActualBalance) === null || finiteNumber(adjustment.adjustmentAmount) === null || !validDate(adjustment.date) || !validTimestamp(adjustment.createdAt) || (adjustment.reversedAt && !validTimestamp(adjustment.reversedAt))) {
        throw new BackupImportError(`Balance adjustment #${index + 1} is invalid.`);
      }
    });
  }
  const replacementData = normalizeData({
    ...raw,
    schemaVersion: 4,
    transactions,
    settings: {
      ...raw.settings,
      balanceSetupCompleted: format === 'current-v3' ? true : raw.settings?.balanceSetupCompleted
    }
  });
  return {
    format,
    formatLabel: format === 'current-v4' ? 'Current FinTrack v4 backup' : 'FinTrack v3 backup',
    restoreMode: 'replace',
    transactions,
    basePatch: { date: validDate(raw.base.date) ? raw.base.date : null, balances, replaceBalances: true },
    settingsPatch,
    replacementData,
    defaultSourceCount: 0,
    mappings: [format === 'current-v4' ? 'Current v4 baselines, adjustments, settings, and transactions retained' : 'V3 base balances converted to initialized source baselines']
  };
}

export function analyzeBackup(raw, existingData, options = {}) {
  const format = detectBackupFormat(raw);
  const importedAt = options.importedAt || new Date().toISOString();
  const defaultSource = resolveSource(options.defaultSource) || 'SoFi';
  const converted = format === 'legacy-v2'
    ? convertLegacyV2(raw, { importedAt, defaultSource })
    : convertCurrentBackup(raw, { importedAt, defaultSource }, format);
  if (converted.restoreMode === 'replace') {
    const existingCategories = new Set(Object.values(CATEGORIES).flat().map(category => category.toLocaleLowerCase()));
    const newCategories = [...new Set(converted.transactions.map(displayCategory).filter(category => !existingCategories.has(category.toLocaleLowerCase())))];
    return {
      ...converted,
      importedAt,
      transactionsToImport: converted.transactions,
      summary: {
        totalFound: converted.transactions.length,
        toImport: converted.transactions.length,
        duplicates: 0,
        newCategories,
        mappings: converted.mappings,
        defaultSourceCount: 0,
        postBaselineCount: 0
      }
    };
  }
  const seen = new Set(existingData.transactions.map(duplicateKey));
  const transactionsToImport = [];
  let duplicates = 0;
  converted.transactions.forEach(transaction => {
    const baseline = existingData.sourceBalances?.[transaction.source];
    const afterBaseline = Boolean(baseline?.initialized) && Date.parse(dateToTimestamp(transaction.date)) > Date.parse(baseline.baselineDate);
    transaction.balanceEffectiveAt = dateToTimestamp(transaction.date);
    transaction.balanceImpact = afterBaseline && options.applyPostBaseline ? 'normal' : 'historical';
    const key = duplicateKey(transaction);
    if (seen.has(key)) duplicates += 1;
    else {
      seen.add(key);
      transactionsToImport.push(transaction);
    }
  });
  const existingCategories = new Set([
    ...Object.values(CATEGORIES).flat(),
    ...existingData.transactions.map(displayCategory)
  ].map(category => category.trim().toLocaleLowerCase()));
  const newCategories = [...new Set(transactionsToImport
    .map(displayCategory)
    .filter(category => !existingCategories.has(category.trim().toLocaleLowerCase())))]
    .sort((a, b) => a.localeCompare(b));

  return {
    ...converted,
    importedAt,
    transactionsToImport,
    summary: {
      totalFound: converted.transactions.length,
      toImport: transactionsToImport.length,
      duplicates,
      newCategories,
      mappings: converted.mappings,
      defaultSourceCount: converted.defaultSourceCount,
      postBaselineCount: transactionsToImport.filter(transaction => {
        const baseline = existingData.sourceBalances?.[transaction.source];
        return Boolean(baseline?.initialized) && Date.parse(dateToTimestamp(transaction.date)) > Date.parse(baseline.baselineDate);
      }).length
    }
  };
}

export function commitBackupImport(existingData, analysis) {
  if (analysis.restoreMode === 'replace') return clone(analysis.replacementData);
  const next = clone(existingData);
  const usedIds = new Set(next.transactions.map(transaction => transaction.id));
  analysis.transactionsToImport.forEach(transaction => {
    const imported = clone(transaction);
    if (usedIds.has(imported.id)) imported.id = createId();
    usedIds.add(imported.id);
    next.transactions.push(imported);
  });
  if (analysis.basePatch) {
    Object.entries(analysis.basePatch.balances).forEach(([source, amount]) => {
      if (!next.sourceBalances[source]?.initialized) {
        next.base.balances[source] = amount;
        next.sourceBalances[source].baselineAmount = amount;
        if (analysis.basePatch.date) next.sourceBalances[source].baselineDate = dateToTimestamp(analysis.basePatch.date, 0);
      }
    });
    if (analysis.basePatch.date && !areBalancesInitialized(next)) next.base.date = analysis.basePatch.date;
  }
  next.settings = { ...next.settings, ...analysis.settingsPatch };
  return next;
}
