export const SOURCES = ['SoFi', 'Capital One', 'Cash App', 'Cash'];

const roundMoney = value => Math.round(Number(value) * 100) / 100;
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const todayISO = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

export function dateToTimestamp(value, hour = 12) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return new Date().toISOString();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, hour).toISOString();
}

export function createSourceBalances(baselineDate = new Date().toISOString(), initialized = false) {
  return Object.fromEntries(SOURCES.map(source => [source, {
    baselineAmount: 0,
    baselineDate,
    initialized,
    updatedAt: initialized ? baselineDate : null
  }]));
}

export const areBalancesInitialized = data => SOURCES.every(source => Boolean(data.sourceBalances?.[source]?.initialized));
export const isPosted = transaction => transaction.status === (transaction.type === 'income' ? 'received' : 'paid');

function occursAfterBaseline(effectiveAt, baselineDate) {
  const effectiveTime = Date.parse(effectiveAt);
  const baselineTime = Date.parse(baselineDate);
  return Number.isFinite(effectiveTime) && Number.isFinite(baselineTime) && effectiveTime > baselineTime;
}

function transactionAffectsBalance(transaction, baseline) {
  if (!isPosted(transaction) || transaction.balanceImpact === 'historical' || transaction.date > todayISO()) return false;
  const effectiveAt = validTimestamp(transaction.balanceEffectiveAt)
    ? transaction.balanceEffectiveAt
    : dateToTimestamp(transaction.date);
  return occursAfterBaseline(effectiveAt, baseline.baselineDate);
}

function adjustmentAffectsBalance(adjustment, baseline) {
  if (adjustment.reversedAt || adjustment.date > todayISO()) return false;
  const effectiveAt = validTimestamp(adjustment.effectiveAt)
    ? adjustment.effectiveAt
    : validTimestamp(adjustment.createdAt) ? adjustment.createdAt : dateToTimestamp(adjustment.date);
  return occursAfterBaseline(effectiveAt, baseline.baselineDate);
}

export function calculateTotals(data, ignoredTransactionId = '', ignoredAdjustmentId = '') {
  const balances = {};
  let income = 0;
  let expenses = 0;
  SOURCES.forEach(source => {
    const baseline = data.sourceBalances[source];
    let balance = Number(baseline.baselineAmount) || 0;
    data.transactions.forEach(transaction => {
      if (transaction.id === ignoredTransactionId || transaction.source !== source || !transactionAffectsBalance(transaction, baseline)) return;
      const amount = roundMoney(transaction.amount);
      if (transaction.type === 'income') {
        balance = roundMoney(balance + amount);
        income = roundMoney(income + amount);
      } else {
        balance = roundMoney(balance - amount);
        expenses = roundMoney(expenses + amount);
      }
    });
    (data.balanceAdjustments || []).forEach(adjustment => {
      if (adjustment.id === ignoredAdjustmentId || adjustment.source !== source || !adjustmentAffectsBalance(adjustment, baseline)) return;
      balance = roundMoney(balance + Number(adjustment.adjustmentAmount));
    });
    balances[source] = roundMoney(balance);
  });
  return {
    balances,
    income,
    expenses,
    total: roundMoney(SOURCES.reduce((sum, source) => sum + balances[source], 0))
  };
}

export function initializeBalances(data, amounts, baselineDate = new Date().toISOString()) {
  if (!validTimestamp(baselineDate)) return { error: 'Choose a valid baseline date and time.' };
  for (const source of SOURCES) {
    if (!Number.isFinite(Number(amounts[source]))) return { error: `Enter a valid ${source} balance.` };
  }
  const updatedAt = new Date().toISOString();
  SOURCES.forEach(source => {
    data.sourceBalances[source] = {
      baselineAmount: roundMoney(amounts[source]),
      baselineDate,
      initialized: true,
      updatedAt
    };
    // Keep the v3 base mirror for backward-readable exports.
    data.base.balances[source] = roundMoney(amounts[source]);
  });
  data.transactions.forEach(transaction => {
    if (transaction.balanceImpact !== 'historical' && Date.parse(dateToTimestamp(transaction.date)) > Date.parse(baselineDate)) {
      transaction.balanceEffectiveAt = dateToTimestamp(transaction.date);
    }
  });
  data.base.date = baselineDate.slice(0, 10);
  data.settings.balanceSetupCompleted = true;
  return { error: '' };
}
