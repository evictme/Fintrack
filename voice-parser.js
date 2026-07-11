import { CATEGORIES, todayISO } from './data.js';

const SOURCE_ALIASES = [
  ['Cash App', ['cash application', 'cash app', 'cashapp']],
  ['Capital One', ['capital one', 'capital 1']],
  ['SoFi', ['so fi', 'sofi', 'sophie']],
  ['Cash', ['physical cash', 'wallet', 'cash']]
];

const CATEGORY_ALIASES = [
  ['Xfinity Mobile', ['xfinity mobile']],
  ['NGC Payroll', ['n g c payroll', 'ngc payroll', 'ngc']],
  ['Lyft Payout', ['lyft payout', 'lift payout', 'lyft', 'lift']],
  ['Peoples Gas', ['peoples gas', "people's gas"]],
  ['DreamHost', ['dream host', 'dreamhost']],
  ['ChatGPT', ['chat g p t', 'chat gpt', 'chatgpt']],
  ['Xfinity', ['xfinity']],
  ['Microsoft', ['microsoft']],
  ['Netflix', ['netflix']],
  ['Amazon', ['amazon']],
  ['Google', ['google']],
  ['ComEd', ['com ed', 'comed']],
  ['Meño', ['meño', 'meno']],
  ['Rent', ['rent']],
  ['Apple', ['apple']],
  ['Hulu', ['hulu']],
  ['HBO', ['hbo']]
];

const ONES = { zero: 0, a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORDS = new Set([...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'thousand', 'and']);
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’']/g, "'")
  .replace(/-/g, ' ').replace(/[^a-z0-9$.,'\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const phrasePattern = phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const hasPhrase = (text, phrase) => new RegExp(`(?:^|\\b)${phrasePattern(normalize(phrase))}(?=$|\\b)`, 'i').test(text);
const roundCurrency = value => Math.round(value * 100) / 100;

export function parseNumberWords(words) {
  const tokens = String(words || '').toLowerCase().replace(/-/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.some(token => !NUMBER_WORDS.has(token))) return null;
  let total = 0;
  let current = 0;
  let found = false;
  tokens.forEach(token => {
    if (token === 'and') return;
    found = true;
    if (Object.hasOwn(ONES, token)) current += ONES[token];
    else if (Object.hasOwn(TENS, token)) current += TENS[token];
    else if (token === 'hundred') current = (current || 1) * 100;
    else if (token === 'thousand') { total += (current || 1) * 1000; current = 0; }
  });
  return found ? total + current : null;
}

function wordsBeforeCurrency(text, currency) {
  const index = text.search(new RegExp(`\\b${currency}s?\\b`, 'i'));
  if (index < 0) return null;
  const tokens = text.slice(0, index).replace(/-/g, ' ').trim().split(/\s+/);
  const selected = [];
  for (let cursor = tokens.length - 1; cursor >= 0 && NUMBER_WORDS.has(tokens[cursor].toLowerCase()); cursor -= 1) selected.unshift(tokens[cursor]);
  return selected.length ? selected.join(' ') : null;
}

export function parseAmount(input) {
  const text = normalize(input);
  let dollars = null;
  let cents = null;
  const numericDollars = text.match(/(?:\$\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:dollars?|bucks?)\b/i);
  if (numericDollars) dollars = Number(numericDollars[1].replace(/,/g, ''));
  else {
    const dollarWords = wordsBeforeCurrency(text, 'dollar');
    if (dollarWords) dollars = parseNumberWords(dollarWords);
  }
  const numericCents = text.match(/([0-9]{1,2})\s*cents?\b/i);
  if (numericCents) cents = Number(numericCents[1]);
  else {
    const centWords = wordsBeforeCurrency(text, 'cent');
    if (centWords) cents = parseNumberWords(centWords);
  }
  if (dollars !== null || cents !== null) {
    const amount = Number(dollars || 0) + Number(cents || 0) / 100;
    return Number.isFinite(amount) && amount > 0 && Number(cents || 0) < 100 ? roundCurrency(amount) : null;
  }
  const currencyNumber = text.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (currencyNumber) return roundCurrency(Number(currencyNumber[1].replace(/,/g, '')));
  const candidates = [...text.matchAll(/\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/g)];
  for (const match of candidates) {
    const value = Number(match[1].replace(/,/g, ''));
    const before = text.slice(Math.max(0, match.index - 18), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 4);
    if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|due)\s*$/.test(before) || /^(?:st|nd|rd|th)\b/.test(after) || (value >= 1900 && value <= 2100)) continue;
    if (Number.isFinite(value) && value > 0) return roundCurrency(value);
  }
  const verbWords = text.match(/\b(?:expense|income|spent|spend|deposit|deposited|received|receive|paid|earned)\s+((?:[a-z]+\s+){0,8}[a-z]+)/);
  if (verbWords) {
    const tokens = verbWords[1].split(/\s+/).filter(token => NUMBER_WORDS.has(token));
    const value = parseNumberWords(tokens.join(' '));
    if (value > 0) return roundCurrency(value);
  }
  return null;
}

export function normalizeSource(input) {
  const text = normalize(input);
  for (const [canonical, aliases] of SOURCE_ALIASES) {
    if (aliases.some(alias => hasPhrase(text, alias))) return canonical;
  }
  return null;
}

function detectBuiltInCategory(input) {
  const text = normalize(input);
  for (const [canonical, aliases] of CATEGORY_ALIASES) {
    if (aliases.some(alias => hasPhrase(text, alias))) return canonical;
  }
  const allCategories = Object.values(CATEGORIES).flat().sort((a, b) => b.length - a.length);
  return allCategories.find(category => hasPhrase(text, category)) || null;
}

function detectType(input, builtInCategory) {
  const text = normalize(input);
  if (/\b(?:income)\b/.test(text)) return 'income';
  if (/\b(?:expense)\b/.test(text)) return 'expense';
  let income = 0;
  let expense = 0;
  if (/\bpaid\s+me\b/.test(text)) income += 5;
  if (/\b(?:deposit|deposited|received|receive|paycheck|payroll|payout|earned|earning)\b/.test(text)) income += 3;
  if (['NGC Payroll', 'Lyft Payout'].includes(builtInCategory)) income += 3;
  if (/\b(?:spent|spend|purchase|purchased|payment|charge|charged|bill|bought)\b/.test(text)) expense += 3;
  if (/\bpaid\b/.test(text) && !/\bpaid\s+me\b/.test(text)) expense += 2;
  if (income === expense || Math.max(income, expense) < 2) return null;
  return income > expense ? 'income' : 'expense';
}

function cleanupCustomCategory(value) {
  let candidate = String(value || '').trim().replace(/^[,.:;\s]+|[,.:;\s]+$/g, '');
  candidate = candidate.replace(/\b(?:today|yesterday|tomorrow)\b.*$/i, '').trim();
  if (!candidate || normalizeSource(candidate)) return null;
  if (/^(?:income|expense|payment|purchase|deposit|paid|received)$/i.test(candidate)) return null;
  return candidate.slice(0, 80);
}

function extractCustomCategory(input, type) {
  const text = String(input || '');
  const pattern = type === 'income'
    ? /\b(?:from|for)\s+(.+?)(?=\s+\b(?:into|to|due|today|yesterday|tomorrow)\b|[,.]|$)/i
    : /\b(?:for|on|at|category)\s+(.+?)(?=\s+\b(?:from|using|with|via|due|today|yesterday|tomorrow)\b|[,.]|$)/i;
  const match = text.match(pattern);
  return cleanupCustomCategory(match?.[1]);
}

function localDate(year, month, day) {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return localDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDatePhrase(phrase, baseDate) {
  const text = normalize(phrase);
  if (/^today\b/.test(text)) return baseDate;
  if (/^yesterday\b/.test(text)) return addDays(baseDate, -1);
  if (/^tomorrow\b/.test(text)) return addDays(baseDate, 1);
  for (const [weekday, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`^${weekday}\\b`).test(text)) {
      const [year, month, day] = baseDate.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const offset = (target - date.getDay() + 7) % 7;
      return addDays(baseDate, offset);
    }
  }
  const monthMatch = text.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+([0-9]{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*([0-9]{4}))?/);
  if (monthMatch) {
    const baseYear = Number(baseDate.slice(0, 4));
    return localDate(Number(monthMatch[3] || baseYear), MONTHS[monthMatch[1]], Number(monthMatch[2]));
  }
  return null;
}

function parseDates(input, baseDate) {
  const text = normalize(input);
  const datePhrase = '(?:today|yesterday|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+[0-9]{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*[0-9]{4})?)';
  const dueMatch = text.match(new RegExp(`\\bdue\\s+(${datePhrase})`, 'i'));
  const dueDate = dueMatch ? parseDatePhrase(dueMatch[1], baseDate) : null;
  const withoutDue = dueMatch ? text.replace(dueMatch[0], '') : text;
  const relative = withoutDue.match(/\b(today|yesterday|tomorrow)\b/);
  const onDate = withoutDue.match(new RegExp(`\\bon\\s+(${datePhrase})`, 'i'));
  const standaloneDate = withoutDue.match(new RegExp(`\\b((?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+[0-9]{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*[0-9]{4})?)`, 'i'));
  const transactionDate = parseDatePhrase(relative?.[1] || onDate?.[1] || standaloneDate?.[1] || 'today', baseDate) || baseDate;
  return { date: transactionDate, dueDate: dueDate || transactionDate };
}

function parseStatus(input, type) {
  const text = normalize(input);
  if (/\bunpaid\b/.test(text)) return 'unpaid';
  if (/\bpending\b/.test(text)) return 'pending';
  if (/\breceived\b/.test(text)) return 'received';
  if (/\bpaid\b/.test(text) && !/\bpaid\s+me\b/.test(text)) return 'paid';
  return type === 'income' ? 'received' : 'paid';
}

export function parseVoiceTransaction(input, options = {}) {
  const originalText = String(input || '').trim();
  const baseDate = options.today || todayISO();
  const amount = parseAmount(originalText);
  const source = normalizeSource(originalText);
  const builtInCategory = detectBuiltInCategory(originalText);
  const type = detectType(originalText, builtInCategory);
  const category = builtInCategory || extractCustomCategory(originalText, type);
  const dates = parseDates(originalText, baseDate);
  const status = type ? parseStatus(originalText, type) : null;
  const transaction = {
    type,
    amount,
    source,
    category,
    date: dates.date,
    dueDate: dates.dueDate,
    status,
    notes: '',
    inputMethod: 'siri-voice'
  };
  const missingFields = ['type', 'amount', 'source', 'category'].filter(field => transaction[field] === null || transaction[field] === undefined || transaction[field] === '');
  const warnings = missingFields.map(field => ({
    type: 'Transaction type was ambiguous.',
    amount: 'No valid positive amount was identified.',
    source: 'No supported source was identified.',
    category: 'No reliable category was identified.'
  })[field]);
  return {
    valid: missingFields.length === 0,
    confidence: missingFields.length ? 'low' : 'high',
    transaction,
    missingFields,
    originalText,
    warnings
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createVoiceFingerprint(result) {
  const transaction = result.transaction || {};
  const material = [transaction.type, transaction.amount, transaction.source, transaction.category, transaction.date, normalize(result.originalText)].join('|');
  return hashString(material);
}
