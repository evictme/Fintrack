import { SOURCES, calculateTotals, dateToTimestamp } from './balance.js';
import { createId, todayISO } from './data.js';

const roundMoney = value => Math.round(Number(value) * 100) / 100;
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export function previewAdjustment(data, source, newActualBalance) {
  if (!SOURCES.includes(source) || newActualBalance === '' || newActualBalance === null || !Number.isFinite(Number(newActualBalance))) return null;
  const previousCalculatedBalance = calculateTotals(data).balances[source];
  const newBalance = roundMoney(newActualBalance);
  return {
    previousCalculatedBalance,
    newActualBalance: newBalance,
    adjustmentAmount: roundMoney(newBalance - previousCalculatedBalance)
  };
}

export function createBalanceAdjustment(data, draft) {
  const preview = previewAdjustment(data, draft.source, draft.newActualBalance);
  if (!preview) return { errors: ['Choose a source and enter a valid actual balance.'], adjustment: null };
  if (!validDate(draft.date)) return { errors: ['Choose a valid adjustment date.'], adjustment: null };
  if (draft.date > todayISO()) return { errors: ['The adjustment date cannot be in the future.'], adjustment: null };
  const createdAt = new Date().toISOString();
  const effectiveAt = draft.date === todayISO() ? createdAt : dateToTimestamp(draft.date);
  if (Date.parse(effectiveAt) <= Date.parse(data.sourceBalances[draft.source].baselineDate)) {
    return { errors: ['The adjustment date must be after this source\'s baseline.'], adjustment: null };
  }
  const duplicate = data.balanceAdjustments.some(item => !item.reversedAt && item.source === draft.source && item.date === draft.date && Number(item.newActualBalance) === preview.newActualBalance && item.reason === String(draft.reason || '').trim());
  if (duplicate) return { errors: ['This balance adjustment has already been saved.'], adjustment: null };
  if (preview.adjustmentAmount === 0) return { errors: ['The actual balance already matches the calculated balance.'], adjustment: null };
  const adjustment = {
    id: createId(),
    source: draft.source,
    previousCalculatedBalance: preview.previousCalculatedBalance,
    newActualBalance: preview.newActualBalance,
    adjustmentAmount: preview.adjustmentAmount,
    date: draft.date,
    reason: String(draft.reason || '').trim(),
    createdAt,
    effectiveAt,
    reversedAt: null
  };
  data.balanceAdjustments.push(adjustment);
  return { errors: [], adjustment };
}

export function reverseBalanceAdjustment(data, id) {
  const adjustment = data.balanceAdjustments.find(item => item.id === id);
  if (!adjustment || adjustment.reversedAt) return false;
  adjustment.reversedAt = new Date().toISOString();
  return true;
}

export function deleteBalanceAdjustment(data, id) {
  const lengthBefore = data.balanceAdjustments.length;
  data.balanceAdjustments = data.balanceAdjustments.filter(item => item.id !== id);
  return data.balanceAdjustments.length !== lengthBefore;
}
