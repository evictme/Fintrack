import { parseAmount, parseNumberWords, parseVoiceTransaction } from '../voice-parser.js';

const failures = [];
const equal = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const parse = text => parseVoiceTransaction(text, { today: '2026-07-11' });

equal(parseAmount('24'), 24, 'integer amount');
equal(parseAmount('$24.50'), 24.5, 'currency amount');
equal(parseAmount('1,850'), 1850, 'comma amount');
equal(parseAmount('twenty-four dollars and fifty cents'), 24.5, 'dictated dollars and cents');
equal(parseAmount('one thousand eight hundred fifty dollars'), 1850, 'large number words');
equal(parseAmount('fifty cents'), 0.5, 'cents only');
equal(parseNumberWords('one hundred and five'), 105, 'number word module');

const expense = parse('Expense, 24 dollars and 50 cents for Amazon from SoFi.');
equal([expense.valid, expense.transaction.type, expense.transaction.amount, expense.transaction.source, expense.transaction.category, expense.transaction.status], [true, 'expense', 24.5, 'SoFi', 'Amazon', 'paid'], 'complete expense');
const spent = parse('I spent 18 dollars on Netflix from Cash App.');
equal([spent.transaction.type, spent.transaction.source], ['expense', 'Cash App'], 'spent and Cash App');
const paidMe = parse('They paid me 90 dollars from freelance work into capital 1');
equal([paidMe.transaction.type, paidMe.transaction.category, paidMe.transaction.source], ['income', 'freelance work', 'Capital One'], 'paid me precedence');
const payroll = parse('Income, 1,850 dollars from N G C Payroll into So Fi.');
equal([payroll.transaction.type, payroll.transaction.category, payroll.transaction.source], ['income', 'NGC Payroll', 'SoFi'], 'payroll aliases');
const lyft = parse('I received 280 dollars from lift payout into cash application.');
equal([lyft.transaction.category, lyft.transaction.source, lyft.transaction.status], ['Lyft Payout', 'Cash App', 'received'], 'Lyft aliases');
const mobile = parse('Paid 72 dollars for Xfinity Mobile from Capital One.');
equal(mobile.transaction.category, 'Xfinity Mobile', 'long category before short');
const aliases = parse('Expense 25 dollars for chat g p t from Sophie');
equal([aliases.transaction.category, aliases.transaction.source], ['ChatGPT', 'SoFi'], 'category and source aliases');
const custom = parse('Expense 35 dollars for groceries from Cash');
equal(custom.transaction.category, 'groceries', 'custom expense category');
const customIncome = parse('Deposit 500 dollars from freelance work into Capital One');
equal(customIncome.transaction.category, 'freelance work', 'custom income category');
const unpaid = parse('Unpaid expense 95 dollars for Peoples Gas from SoFi due Friday');
equal([unpaid.transaction.status, unpaid.transaction.dueDate], ['unpaid', '2026-07-17'], 'explicit unpaid and weekday');
const pending = parse('Pending income 300 dollars from Lyft Payout into Cash App');
equal(pending.transaction.status, 'pending', 'explicit pending');
const yesterday = parse('Expense 40 dollars for Amazon from SoFi yesterday');
equal([yesterday.transaction.date, yesterday.transaction.dueDate], ['2026-07-10', '2026-07-10'], 'yesterday local date');
const namedDate = parse('Expense 40 dollars for Amazon from SoFi July 10, 2026');
equal(namedDate.transaction.date, '2026-07-10', 'spoken named date');
const dueTomorrow = parse('Expense 100 dollars for Xfinity from Capital One due tomorrow');
equal(dueTomorrow.transaction.dueDate, '2026-07-12', 'due tomorrow');

equal(parse('Expense 30 dollars for Amazon').missingFields, ['source'], 'missing source fallback');
equal(parse('Expense 40 dollars from Cash').missingFields, ['category'], 'missing category fallback');
equal(parse('Amazon 20 dollars from SoFi').missingFields, ['type'], 'ambiguous type fallback');
equal(parse('Expense for Amazon from SoFi').missingFields, ['amount'], 'invalid amount fallback');

if (failures.length) throw new Error(`Voice parser failures:\n${failures.join('\n')}`);
console.log('voice-parser.test.mjs: all assertions passed');
