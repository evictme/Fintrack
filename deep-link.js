import { CATEGORIES, todayISO } from './data.js';
import { createVoiceFingerprint, normalizeSource, parseVoiceTransaction } from './voice-parser.js';

const hashString = value => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
};

export function parseDeepLinkRequest(inputUrl, options = {}) {
  const url = new URL(inputUrl, 'https://fintrack.local/');
  const parameters = url.searchParams;
  if (!parameters.has('action')) return null;
  const action = String(parameters.get('action') || '').toLowerCase();
  const cleanUrl = `${url.pathname}${url.hash}`;
  if (action === 'voice') {
    const result = parseVoiceTransaction(parameters.get('text') || '', { today: options.today || todayISO() });
    return { kind: 'voice', action, result, fingerprint: createVoiceFingerprint(result), cleanUrl };
  }
  const amount = Number(parameters.get('amount'));
  const category = String(parameters.get('category') || '').trim();
  const source = normalizeSource(parameters.get('source'));
  const errors = [];
  if (!['income', 'expense'].includes(action)) errors.push('Unknown deep-link action.');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Deep-link amount must be greater than zero.');
  if (!category) errors.push('Deep-link category is required.');
  if (!source) errors.push('Deep-link source is not recognized.');
  const custom = !CATEGORIES[action]?.some(item => item.toLocaleLowerCase() === category.toLocaleLowerCase());
  const canonicalCategory = custom ? category : CATEGORIES[action].find(item => item.toLocaleLowerCase() === category.toLocaleLowerCase());
  const transaction = {
    date: options.today || todayISO(),
    dueDate: options.today || todayISO(),
    type: action,
    source,
    category: custom ? 'Custom' : canonicalCategory,
    customCategory: custom ? category : '',
    amount,
    status: action === 'income' ? 'received' : 'paid',
    notes: '',
    inputMethod: 'structured-deep-link'
  };
  return { kind: 'structured', action, transaction, errors, fingerprint: hashString([action, amount, source, category, transaction.date].join('|')), cleanUrl };
}

export function claimDeepLinkFingerprint(storage, fingerprint, now = Date.now(), safetyWindow = 15000) {
  const key = `fintrack.deepLink.${fingerprint}`;
  const lastHandled = Number(storage.getItem(key) || 0);
  if (now - lastHandled < safetyWindow) return false;
  storage.setItem(key, String(now));
  return true;
}
