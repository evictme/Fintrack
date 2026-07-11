import { claimDeepLinkFingerprint, parseDeepLinkRequest } from '../deep-link.js';
import { createDefaultData, saveTransaction } from '../data.js';
import { calculateTotals, initializeBalances } from '../balance.js';

const failures = [];
const equal = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

globalThis.localStorage = { values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } };
const session = { values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); } };

const voice = parseDeepLinkRequest('https://example.test/app/?action=voice&text=Expense%2024.50%20for%20Amazon%20from%20SoFi#home', { today: '2026-07-11' });
equal([voice.kind, voice.result.valid, voice.result.transaction.amount, voice.cleanUrl], ['voice', true, 24.5, '/app/#home'], 'voice URL parse and cleanup');
equal(claimDeepLinkFingerprint(session, voice.fingerprint, 100000, 15000), true, 'first launch claimed');
equal(claimDeepLinkFingerprint(session, voice.fingerprint, 100100, 15000), false, 'duplicate launch rejected');
equal(claimDeepLinkFingerprint(session, voice.fingerprint, 116000, 15000), true, 'later legitimate launch allowed');

const structuredExpense = parseDeepLinkRequest('https://example.test/?action=expense&amount=24.50&category=Amazon&source=SoFi', { today: '2026-07-11' });
equal([structuredExpense.kind, structuredExpense.errors.length, structuredExpense.transaction.type, structuredExpense.transaction.amount], ['structured', 0, 'expense', 24.5], 'structured expense compatibility');
const structuredIncome = parseDeepLinkRequest('https://example.test/?action=income&amount=1850&category=NGC%20Payroll&source=SoFi', { today: '2026-07-11' });
equal([structuredIncome.errors.length, structuredIncome.transaction.status], [0, 'received'], 'structured income compatibility');

const data = createDefaultData();
initializeBalances(data, { SoFi: 100, 'Capital One': 0, 'Cash App': 0, Cash: 0 }, '2026-01-01T00:00:00.000Z');
const parsed = voice.result.transaction;
const saved = saveTransaction(data, { ...parsed, category: parsed.category, customCategory: '' });
equal(saved.errors, [], 'voice uses transaction save service');
equal([calculateTotals(data).balances.SoFi, calculateTotals(data).expenses], [75.5, 24.5], 'posted voice expense updates source balance');
equal(saved.transaction.inputMethod, 'siri-voice', 'voice input method retained');
equal(JSON.stringify(saved.transaction).includes(voice.result.originalText), false, 'dictated phrase not retained');

const receivedVoice = parseDeepLinkRequest('https://example.test/?action=voice&text=Income%201850%20from%20NGC%20Payroll%20into%20SoFi', { today: '2026-07-11' });
saveTransaction(data, { ...receivedVoice.result.transaction, category: 'NGC Payroll', customCategory: '' });
equal(calculateTotals(data).balances.SoFi, 1925.5, 'received voice income updates source balance');

const pendingVoice = parseDeepLinkRequest('https://example.test/?action=voice&text=Pending%20income%2030%20dollars%20from%20Lyft%20Payout%20into%20SoFi', { today: '2026-07-11' });
saveTransaction(data, { ...pendingVoice.result.transaction, category: 'Lyft Payout', customCategory: '' });
equal(calculateTotals(data).balances.SoFi, 1925.5, 'pending voice income does not change balance');
const unpaidVoice = parseDeepLinkRequest('https://example.test/?action=voice&text=Unpaid%20expense%2010%20dollars%20for%20Amazon%20from%20SoFi', { today: '2026-07-11' });
saveTransaction(data, { ...unpaidVoice.result.transaction, category: 'Amazon', customCategory: '' });
equal(calculateTotals(data).balances.SoFi, 1925.5, 'unpaid voice expense does not change balance');

if (failures.length) throw new Error(`Deep-link failures:\n${failures.join('\n')}`);
console.log('deep-link.test.mjs: all assertions passed');
