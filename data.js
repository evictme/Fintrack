import { SOURCES, calculateTotals, createSourceBalances, dateToTimestamp, isPosted } from './balance.js';

export { SOURCES, calculateTotals, isPosted } from './balance.js';
export const STORAGE_KEY = 'financeTracker.pwa.v4';
export const LEGACY_KEYS = ['financeTracker.pwa.v3', 'financeTracker.pwa.v2', 'financeTracker.v1'];
const SAFETY_KEY = 'financeTracker.safetyBackups';
export const STATUSES = ['paid', 'unpaid', 'received', 'pending'];
export const CATEGORIES = {
  income: ['NGC Payroll', 'Lyft Payout'],
  expense: ['Meño', 'Rent', 'Xfinity', 'Xfinity Mobile', 'Peoples Gas', 'ComEd', 'Google', 'Microsoft', 'DreamHost', 'ChatGPT', 'Amazon', 'Netflix', 'Hulu', 'HBO', 'Apple']
};

export const todayISO = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
export const createId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const roundMoney = value => Math.round(Number(value) * 100) / 100;
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const validDateValue = value => validDate(value) ? value : todayISO();
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const timestamp = value => validTimestamp(value) ? value : new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));

export function createDefaultData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 4,
    base: { date: todayISO(), balances: Object.fromEntries(SOURCES.map(source => [source, 0])) },
    sourceBalances: createSourceBalances(now, false),
    balanceAdjustments: [],
    transactions: [],
    categories: clone(CATEGORIES),
    settings: { preventNegativeBalances: false, legacyDefaultSource: 'SoFi', balanceSetupCompleted: false }
  };
}

function matchSource(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return SOURCES.find(source => source.toLowerCase() === candidate) || '';
}

function normalizeTransaction(item = {}, historicalByDefault = false) {
  const type = String(item.type || item.transactionType || '').toLowerCase() === 'income' ? 'income' : 'expense';
  const date = validDateValue(item.date || item.paidDate || item.dueDate);
  const createdAt = timestamp(item.createdAt);
  return {
    id: String(item.id || createId()),
    date,
    dueDate: validDateValue(item.dueDate || item.date),
    type,
    source: matchSource(item.source) || 'SoFi',
    category: String(item.category || item.description || item.name || (type === 'income' ? 'Income' : 'Expense')),
    customCategory: String(item.customCategory || ''),
    amount: Math.abs(roundMoney(item.amount || 0)) || 0,
    status: STATUSES.includes(String(item.status || '').toLowerCase()) ? String(item.status).toLowerCase() : (type === 'income' ? 'pending' : 'unpaid'),
    notes: String(item.notes || ''),
    metadata: item.metadata && typeof item.metadata === 'object' ? clone(item.metadata) : {},
    legacyMetadata: item.legacyMetadata && typeof item.legacyMetadata === 'object' ? clone(item.legacyMetadata) : null,
    balanceImpact: item.balanceImpact === 'historical' ? 'historical' : (historicalByDefault ? 'historical' : 'normal'),
    balanceEffectiveAt: validTimestamp(item.balanceEffectiveAt) ? item.balanceEffectiveAt : dateToTimestamp(date),
    createdAt,
    updatedAt: timestamp(item.updatedAt || createdAt)
  };
}

function normalizeAdjustment(item = {}) {
  const date = validDateValue(item.date);
  const createdAt = timestamp(item.createdAt);
  return {
    id: String(item.id || createId()),
    source: matchSource(item.source) || 'SoFi',
    previousCalculatedBalance: roundMoney(item.previousCalculatedBalance || 0),
    newActualBalance: roundMoney(item.newActualBalance || 0),
    adjustmentAmount: roundMoney(item.adjustmentAmount || 0),
    date,
    reason: String(item.reason || ''),
    createdAt,
    effectiveAt: validTimestamp(item.effectiveAt) ? item.effectiveAt : dateToTimestamp(date),
    reversedAt: validTimestamp(item.reversedAt) ? item.reversedAt : null
  };
}

function normalizeSourceBalances(raw, base, setupCompleted) {
  const sourceBalances = {};
  SOURCES.forEach(source => {
    const item = raw?.[source];
    const fallbackDate = dateToTimestamp(base.date, 0);
    sourceBalances[source] = {
      baselineAmount: roundMoney(item?.baselineAmount ?? base.balances[source] ?? 0),
      baselineDate: validTimestamp(item?.baselineDate) ? item.baselineDate : fallbackDate,
      initialized: item ? Boolean(item.initialized) : Boolean(setupCompleted),
      updatedAt: validTimestamp(item?.updatedAt) ? item.updatedAt : null
    };
  });
  return sourceBalances;
}

function migrateLegacy(raw) {
  const next = createDefaultData();
  next.base.date = validDateValue(raw?.base?.date);
  next.base.balances.SoFi = roundMoney(raw?.base?.amount || 0);
  next.sourceBalances = normalizeSourceBalances(null, next.base, false);
  next.transactions = [
    ...(raw?.income || []).map(item => normalizeTransaction({ ...item, type: 'income', category: item.description || 'Income', dueDate: item.date, status: item.status === 'expected' ? 'pending' : (item.status || 'received'), legacyMetadata: item }, true)),
    ...(raw?.expenses || []).map(item => normalizeTransaction({ ...item, type: 'expense', category: item.category || item.name || 'Expense', date: item.paidDate || item.dueDate, status: item.status || 'paid', legacyMetadata: item }, true))
  ];
  next.settings.preventNegativeBalances = Boolean(raw?.settings?.preventNegativeBalances);
  return next;
}

export function normalizeData(raw) {
  if (!raw || !Array.isArray(raw.transactions)) return migrateLegacy(raw);
  const next = createDefaultData();
  next.base.date = validDateValue(raw.base?.date);
  SOURCES.forEach(source => { next.base.balances[source] = roundMoney(raw.base?.balances?.[source] || 0); });
  const setupCompleted = Boolean(raw.settings?.balanceSetupCompleted || SOURCES.every(source => raw.sourceBalances?.[source]?.initialized));
  next.sourceBalances = normalizeSourceBalances(raw.sourceBalances, next.base, setupCompleted);
  next.balanceAdjustments = (raw.balanceAdjustments || []).map(normalizeAdjustment);
  next.transactions = raw.transactions.map(item => normalizeTransaction(item, false));
  next.categories = raw.categories && typeof raw.categories === 'object' ? clone(raw.categories) : clone(CATEGORIES);
  next.settings.preventNegativeBalances = Boolean(raw.settings?.preventNegativeBalances);
  next.settings.legacyDefaultSource = matchSource(raw.settings?.legacyDefaultSource) || 'SoFi';
  next.settings.balanceSetupCompleted = setupCompleted;
  return next;
}

export function loadData() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normalizeData(JSON.parse(current));
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const migrated = normalizeData(JSON.parse(legacy));
        saveData(migrated);
        return migrated;
      }
    }
  } catch (error) {
    console.warn('FinTrack data could not be loaded.', error);
  }
  return createDefaultData();
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function createSafetyBackup(data, reason) {
  try {
    const backups = JSON.parse(localStorage.getItem(SAFETY_KEY) || '[]');
    backups.unshift({ createdAt: new Date().toISOString(), reason, data: clone(data) });
    localStorage.setItem(SAFETY_KEY, JSON.stringify(backups.slice(0, 5)));
    return true;
  } catch (error) {
    console.warn('Safety backup could not be created.', error);
    return false;
  }
}

export function clearData() {
  [STORAGE_KEY, ...LEGACY_KEYS].forEach(key => localStorage.removeItem(key));
}

export function validateTransaction(transaction, data, ignoredId = '') {
  const errors = [];
  if (!['income', 'expense'].includes(transaction.type)) errors.push('Choose Income or Expense.');
  if (!matchSource(transaction.source)) errors.push('Choose a valid source.');
  if (!transaction.category?.trim()) errors.push('Choose or enter a category.');
  if (transaction.category === 'Custom' && !transaction.customCategory?.trim()) errors.push('Enter a custom category.');
  if (!Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) errors.push('Enter an amount greater than zero.');
  if (!validDate(transaction.date)) errors.push('Choose a valid transaction date.');
  if (!validDate(transaction.dueDate)) errors.push('Choose a valid due date.');
  if (!STATUSES.includes(transaction.status)) errors.push('Choose a valid status.');
  if (!errors.length && data.settings.preventNegativeBalances && transaction.balanceImpact !== 'historical' && transaction.type === 'expense' && isPosted(transaction) && transaction.date <= todayISO()) {
    const available = calculateTotals(data, ignoredId).balances[transaction.source];
    if (available - Number(transaction.amount) < 0) errors.push(`${transaction.source} does not have enough available balance.`);
  }
  return errors;
}

export function saveTransaction(data, draft) {
  const existingIndex = data.transactions.findIndex(item => item.id === draft.id);
  const existing = existingIndex >= 0 ? data.transactions[existingIndex] : null;
  const preliminaryErrors = validateTransaction({ ...draft, balanceImpact: existing?.balanceImpact || 'normal' }, data, existing ? draft.id : '');
  if (preliminaryErrors.length) return { errors: preliminaryErrors, transaction: null };
  const now = new Date().toISOString();
  const nextPosted = isPosted(draft);
  const previousPosted = existing ? isPosted(existing) : false;
  const transaction = normalizeTransaction({
    ...draft,
    id: draft.id || createId(),
    balanceImpact: existing?.balanceImpact || 'normal',
    balanceEffectiveAt: nextPosted ? (previousPosted ? existing.balanceEffectiveAt : now) : null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
  if (!nextPosted) transaction.balanceEffectiveAt = null;
  const errors = validateTransaction(transaction, data, existing ? transaction.id : '');
  if (errors.length) return { errors, transaction: null };
  if (existingIndex >= 0) data.transactions[existingIndex] = transaction;
  else data.transactions.push(transaction);
  saveData(data);
  return { errors: [], transaction };
}

export function displayCategory(transaction) {
  return transaction.customCategory || transaction.category;
}

export function resolveSource(value) {
  return matchSource(value);
}
