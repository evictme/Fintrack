import {
  CATEGORIES,
  SOURCES,
  STATUSES,
  calculateTotals,
  clearData,
  createSafetyBackup,
  createDefaultData,
  displayCategory,
  loadData,
  resolveSource,
  saveData,
  saveTransaction,
  todayISO
} from './data.js';
import { analyzeBackup, commitBackupImport } from './backup.js';
import { areBalancesInitialized, initializeBalances } from './balance.js';
import { createBalanceAdjustment, deleteBalanceAdjustment, previewAdjustment, reverseBalanceAdjustment } from './adjustments.js';
import { claimDeepLinkFingerprint, parseDeepLinkRequest } from './deep-link.js';

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const formatDate = value => {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const toLocalDateTimeInput = value => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const fromLocalDateTimeInput = value => new Date(value).toISOString();
const labelStatus = status => status.charAt(0).toUpperCase() + status.slice(1);
const categoryOptions = type => [...CATEGORIES[type], 'Custom...'];

let data = loadData();
let deferredInstallPrompt = null;
let toastTimer = null;
let formSubmitting = false;
let pendingBackupRaw = null;
let pendingBackupAnalysis = null;
let pendingBackupImportedAt = null;
let promptBalancesAfterImport = false;
let pendingImportMode = 'legacy';
let deepLinkProcessing = false;
let undoTransaction = null;
const expandedRows = new Set();

function showToast(message, isError = false, options = {}) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  undoTransaction = null;
  toast.textContent = '';
  const messageNode = document.createElement('span');
  messageNode.textContent = message;
  toast.append(messageNode);
  if (options.subtitle) {
    const subtitle = document.createElement('small');
    subtitle.textContent = options.subtitle;
    toast.append(subtitle);
  }
  if (options.undoId) {
    undoTransaction = { id: options.undoId, expiresAt: Date.now() + (options.duration || 8000) };
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.dataset.undoTransaction = options.undoId;
    undoButton.textContent = 'Undo';
    toast.append(undoButton);
  }
  toast.classList.toggle('error', isError);
  toast.classList.toggle('has-action', Boolean(options.undoId));
  toast.classList.add('show');
  toastTimer = setTimeout(() => { toast.classList.remove('show'); undoTransaction = null; }, options.duration || 3500);
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === viewId));
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === viewId));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSourceCards(totals) {
  $('#sourceCards').innerHTML = SOURCES.map(source => `
    <button class="source-card" data-source-filter="${escapeHtml(source)}">
      <span>${escapeHtml(source)} Balance</span>
      <strong>${money(totals.balances[source])}</strong>
      <small>View transactions</small>
    </button>`).join('');
}

function transactionDetails(transaction) {
  return `
    <div class="detail-grid">
      <div class="detail-item"><span>Date</span><strong>${formatDate(transaction.date)}</strong></div>
      <div class="detail-item"><span>Due Date</span><strong>${formatDate(transaction.dueDate)}</strong></div>
      <div class="detail-item"><span>Source</span><strong>${escapeHtml(transaction.source)}</strong></div>
      <div class="detail-item"><span>Category</span><strong>${escapeHtml(displayCategory(transaction))}</strong></div>
      <div class="detail-item"><span>Amount</span><strong>${money(transaction.amount)}</strong></div>
      <div class="detail-item"><span>Type</span><strong>${transaction.type === 'income' ? 'Income' : 'Expense'}</strong></div>
      <div class="detail-item"><span>Status</span><strong>${labelStatus(transaction.status)}</strong></div>
      <div class="detail-item full"><span>Notes</span><strong>${escapeHtml(transaction.notes || 'None')}</strong></div>
    </div>`;
}

function renderDueToday() {
  const due = data.transactions
    .filter(transaction => transaction.type === 'expense' && transaction.dueDate === todayISO() && transaction.status === 'unpaid')
    .sort((a, b) => displayCategory(a).localeCompare(displayCategory(b)));
  $('#dueCount').textContent = String(due.length);
  $('#dueTodayList').innerHTML = due.length ? due.map(transaction => `
    <article class="transaction-row due-row ${expandedRows.has(transaction.id) ? 'expanded' : ''}" data-row-id="${escapeHtml(transaction.id)}">
      <button class="row-summary" data-expand-row="${escapeHtml(transaction.id)}" aria-expanded="${expandedRows.has(transaction.id)}">
        <div><div class="row-title">${escapeHtml(displayCategory(transaction))}</div><div class="row-meta">Due ${formatDate(transaction.dueDate)} <span class="status unpaid">Unpaid</span></div></div>
        <div class="row-amount">${money(transaction.amount)}</div>
      </button>
      <div class="due-actions"><button class="text-button" data-expand-row="${escapeHtml(transaction.id)}">${expandedRows.has(transaction.id) ? 'Hide details' : 'View details'}</button><button class="mark-paid" data-mark-paid="${escapeHtml(transaction.id)}">Mark Paid</button></div>
      <div class="row-details">${transactionDetails(transaction)}<div class="row-actions"><button data-edit-id="${escapeHtml(transaction.id)}">Edit</button><button class="danger" data-delete-id="${escapeHtml(transaction.id)}">Delete</button></div></div>
    </article>`).join('') : '<div class="empty">Nothing unpaid is due today.</div>';
}

function activeFilters() {
  return {
    type: $('#filterType').value,
    source: $('#filterSource').value,
    status: $('#filterStatus').value,
    category: $('#filterCategory').value,
    sort: $('#sortBy').value
  };
}

function sortedTransactions() {
  const filters = activeFilters();
  const filtered = data.transactions.filter(transaction =>
    (!filters.type || transaction.type === filters.type) &&
    (!filters.source || transaction.source === filters.source) &&
    (!filters.status || transaction.status === filters.status) &&
    (!filters.category || displayCategory(transaction) === filters.category)
  );
  const [field, direction] = filters.sort.split('-');
  const multiplier = direction === 'desc' ? -1 : 1;
  return filtered.sort((a, b) => {
    if (field === 'amount') return (a.amount - b.amount) * multiplier;
    if (field === 'category') return displayCategory(a).localeCompare(displayCategory(b)) * multiplier;
    const dateDifference = a.date.localeCompare(b.date) * multiplier;
    return dateDifference || b.createdAt.localeCompare(a.createdAt);
  });
}

function renderFilterOptions() {
  const sourceValue = $('#filterSource').value;
  const statusValue = $('#filterStatus').value;
  const categoryValue = $('#filterCategory').value;
  $('#filterSource').innerHTML = '<option value="">All sources</option>' + SOURCES.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  $('#filterStatus').innerHTML = '<option value="">All statuses</option>' + STATUSES.map(status => `<option value="${status}">${labelStatus(status)}</option>`).join('');
  const categories = [...new Set(data.transactions.map(displayCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#filterCategory').innerHTML = '<option value="">All categories</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  $('#filterSource').value = sourceValue;
  $('#filterStatus').value = statusValue;
  $('#filterCategory').value = categoryValue;
}

function renderTransactions() {
  const transactions = sortedTransactions();
  $('#transactionList').innerHTML = transactions.length ? transactions.map(transaction => `
    <article class="transaction-row ${expandedRows.has(transaction.id) ? 'expanded' : ''}" data-row-id="${escapeHtml(transaction.id)}">
      <button class="row-summary" data-expand-row="${escapeHtml(transaction.id)}" aria-expanded="${expandedRows.has(transaction.id)}">
        <div><div class="row-title">${escapeHtml(displayCategory(transaction))}</div><div class="row-meta">${formatDate(transaction.date)} <span class="status ${transaction.status}">${labelStatus(transaction.status)}</span></div></div>
        <div class="row-amount ${transaction.type}">${transaction.type === 'income' ? '+' : '-'}${money(transaction.amount)}</div>
      </button>
      <div class="row-details">${transactionDetails(transaction)}<div class="row-actions"><button data-edit-id="${escapeHtml(transaction.id)}">Edit</button><button class="danger" data-delete-id="${escapeHtml(transaction.id)}">Delete</button></div></div>
    </article>`).join('') : '<div class="empty">No transactions match these filters.</div>';
}

function renderBalanceBreakdown(totals) {
  $('#balanceBreakdown').innerHTML = SOURCES.map(source => `<div class="breakdown-row"><span>${escapeHtml(source)}</span><strong>${money(totals.balances[source])}</strong></div>`).join('') + `<div class="breakdown-row total"><span>Grand Total</span><strong>${money(totals.total)}</strong></div>`;
}

function render() {
  const totals = calculateTotals(data);
  const initialized = areBalancesInitialized(data);
  $('#todayLine').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  $('#currentBalance').textContent = money(totals.total);
  $('#incomeTotal').textContent = money(totals.income);
  $('#expenseTotal').textContent = money(totals.expenses);
  renderSourceCards(totals);
  renderDueToday();
  renderFilterOptions();
  renderTransactions();
  renderBalanceBreakdown(totals);
  $('#baselineActionLabel').textContent = initialized ? 'Review Balance Baselines' : 'Set Initial Balances';
  $('#baselineActionHelp').textContent = initialized ? 'Review or safely replace source baselines' : 'Set the current real-world balance of every source';
}

function refreshCategoryOptions(selected = '', allowBlank = false) {
  const type = $('#transactionType').value;
  const categoryType = CATEGORIES[type] ? type : 'expense';
  const known = CATEGORIES[categoryType].includes(selected);
  $('#transactionCategory').innerHTML = (allowBlank ? '<option value="">Choose category</option>' : '') + categoryOptions(categoryType).map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  $('#transactionCategory').value = known ? selected : selected ? 'Custom...' : allowBlank ? '' : CATEGORIES[categoryType][0];
  $('#customCategoryWrap').classList.toggle('hidden', $('#transactionCategory').value !== 'Custom...');
}

function refreshStatusOptions(selected = '') {
  $('#transactionStatus').innerHTML = STATUSES.map(status => `<option value="${status}">${labelStatus(status)}</option>`).join('');
  $('#transactionStatus').value = selected || ($('#transactionType').value === 'income' ? 'received' : 'paid');
}

function openTransactionForm(transaction = null, options = {}) {
  const missingFields = options.missingFields || [];
  const date = transaction?.date || todayISO();
  const editing = Boolean(transaction?.id && data.transactions.some(item => item.id === transaction.id));
  const type = transaction?.type || 'expense';
  $('#transactionDialog').dataset.missingCategory = String(missingFields.includes('category'));
  $('#transactionDialogTitle').textContent = editing ? 'Edit Transaction' : 'Add Transaction';
  $('#transactionId').value = transaction?.id || '';
  $('#transactionDate').value = date;
  $('#transactionDueDate').value = transaction?.dueDate || todayISO();
  $('#transactionType').innerHTML = (missingFields.includes('type') ? '<option value="">Choose type</option>' : '') + '<option value="income">Income</option><option value="expense">Expense</option>';
  $('#transactionType').value = missingFields.includes('type') ? '' : type;
  $('#transactionSource').innerHTML = (missingFields.includes('source') ? '<option value="">Choose source</option>' : '') + SOURCES.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  $('#transactionSource').value = transaction?.source || (missingFields.includes('source') ? '' : SOURCES[0]);
  $('#transactionAmount').value = transaction?.amount || '';
  refreshStatusOptions(transaction?.status || '');
  const displayValue = transaction?.customCategory || transaction?.category || '';
  const knownCategory = Object.values(CATEGORIES).flat().includes(displayValue);
  refreshCategoryOptions(displayValue, missingFields.includes('category'));
  $('#customCategory').value = displayValue && !knownCategory ? displayValue : '';
  $('#transactionNotes').value = transaction?.notes || '';
  $('#transactionError').textContent = options.message || '';
  formSubmitting = false;
  $('#saveTransactionBtn').disabled = false;
  showDialog($('#transactionDialog'));
  const focusTargets = { type: '#transactionType', amount: '#transactionAmount', source: '#transactionSource', category: '#transactionCategory' };
  setTimeout(() => $(focusTargets[missingFields[0]] || '#transactionAmount').focus(), 50);
}

function draftFromForm() {
  const custom = $('#transactionCategory').value === 'Custom...';
  const existing = data.transactions.find(item => item.id === $('#transactionId').value);
  return {
    id: $('#transactionId').value,
    date: $('#transactionDate').value,
    dueDate: $('#transactionDueDate').value,
    type: $('#transactionType').value,
    source: $('#transactionSource').value,
    category: custom ? 'Custom' : $('#transactionCategory').value,
    customCategory: custom ? $('#customCategory').value.trim() : '',
    amount: Number($('#transactionAmount').value),
    status: $('#transactionStatus').value,
    notes: $('#transactionNotes').value.trim(),
    inputMethod: existing?.inputMethod || 'manual'
  };
}

function toggleExpanded(id) {
  if (expandedRows.has(id)) expandedRows.delete(id);
  else expandedRows.add(id);
  renderDueToday();
  renderTransactions();
}

function editTransaction(id) {
  const transaction = data.transactions.find(item => item.id === id);
  if (transaction) openTransactionForm(transaction);
}

function deleteTransaction(id) {
  const transaction = data.transactions.find(item => item.id === id);
  if (!transaction || !confirm(`Delete ${displayCategory(transaction)}?`)) return;
  data.transactions = data.transactions.filter(item => item.id !== id);
  expandedRows.delete(id);
  saveData(data);
  render();
  showToast('Transaction deleted.');
}

function markPaid(id) {
  const transaction = data.transactions.find(item => item.id === id);
  if (!transaction || transaction.status === 'paid') return;
  const result = saveTransaction(data, { ...transaction, status: 'paid' });
  if (result.errors.length) return showToast(result.errors[0], true);
  render();
  showToast('Marked paid. Balance updated.');
}

function openBaseDialog() {
  const initialized = areBalancesInitialized(data);
  const baselineDate = initialized ? data.sourceBalances.SoFi.baselineDate : new Date().toISOString();
  $('#baselineDialogTitle').textContent = initialized ? 'Review Balance Baselines' : 'Set Current Balances';
  $('#baseBalanceFields').innerHTML = `<div class="base-date-field"><label for="baseDate">Baseline Date and Time</label><input id="baseDate" type="datetime-local" value="${escapeHtml(toLocalDateTimeInput(baselineDate))}" required><p class="field-help">Transactions and adjustments before this cutoff remain historical and do not change these balances.</p></div>` + SOURCES.map((source, index) => `<div><label for="baseSource${index}">${escapeHtml(source)} Current Balance</label><input class="money-input baseline-input" id="baseSource${index}" type="number" step="0.01" value="${initialized ? escapeHtml(data.sourceBalances[source].baselineAmount) : '0'}" required></div>`).join('');
  $('#preventNegative').checked = data.settings.preventNegativeBalances;
  $('#baselineReplaceWarning').classList.toggle('hidden', !initialized);
  $('#confirmBaselineReplace').checked = false;
  $('#skipBaselineBtn').textContent = initialized ? 'Cancel' : 'Skip for Now';
  document.querySelectorAll('.baseline-input').forEach(input => input.addEventListener('input', updateBaselineTotal));
  updateBaselineTotal();
  closeDialog('settingsDialog');
  showDialog($('#baseDialog'));
}

function updateBaselineTotal() {
  const total = SOURCES.reduce((sum, source, index) => sum + (Number($(`#baseSource${index}`)?.value) || 0), 0);
  $('#baselineCombinedTotal').textContent = money(total);
}

function openAdjustmentDialog() {
  if (!areBalancesInitialized(data)) {
    showToast('Set current balances before creating an adjustment.', true);
    openBaseDialog();
    return;
  }
  $('#adjustmentSource').innerHTML = SOURCES.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  $('#adjustmentActual').value = '';
  $('#adjustmentDate').value = todayISO();
  $('#adjustmentReason').value = '';
  $('#adjustmentError').textContent = '';
  formSubmitting = false;
  $('#saveAdjustmentBtn').disabled = false;
  updateAdjustmentPreview();
  closeDialog('settingsDialog');
  showDialog($('#adjustBalanceDialog'));
}

function updateAdjustmentPreview() {
  const source = $('#adjustmentSource').value || SOURCES[0];
  const calculated = calculateTotals(data).balances[source];
  $('#adjustmentCalculated').textContent = money(calculated);
  const preview = previewAdjustment(data, source, $('#adjustmentActual').value);
  $('#adjustmentDifference').textContent = preview ? money(preview.adjustmentAmount) : money(0);
  $('#adjustmentDifference').classList.toggle('positive', Boolean(preview && preview.adjustmentAmount > 0));
  $('#adjustmentDifference').classList.toggle('negative', Boolean(preview && preview.adjustmentAmount < 0));
}

function renderAdjustmentHistory() {
  const adjustments = [...data.balanceAdjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#adjustmentHistoryList').innerHTML = adjustments.length ? adjustments.map(adjustment => `
    <article class="adjustment-card ${adjustment.reversedAt ? 'reversed' : ''}">
      <div class="adjustment-card-head"><div><strong>${escapeHtml(adjustment.source)}</strong><div class="adjustment-meta">${formatDate(adjustment.date)}${adjustment.reversedAt ? ' · Reversed' : ''}</div></div><div class="adjustment-amount ${adjustment.adjustmentAmount >= 0 ? 'positive' : 'negative'}">${adjustment.adjustmentAmount >= 0 ? '+' : ''}${money(adjustment.adjustmentAmount)}</div></div>
      <div class="adjustment-meta">${money(adjustment.previousCalculatedBalance)} → ${money(adjustment.newActualBalance)}${adjustment.reason ? ` · ${escapeHtml(adjustment.reason)}` : ''}</div>
      <div class="adjustment-actions"><button data-reverse-adjustment="${escapeHtml(adjustment.id)}" ${adjustment.reversedAt ? 'disabled' : ''}>${adjustment.reversedAt ? 'Reversed' : 'Reverse'}</button><button class="danger" data-delete-adjustment="${escapeHtml(adjustment.id)}">Delete</button></div>
    </article>`).join('') : '<div class="empty">No manual balance adjustments.</div>';
}

function openAdjustmentHistory() {
  renderAdjustmentHistory();
  closeDialog('settingsDialog');
  showDialog($('#adjustmentHistoryDialog'));
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fintrack-backup-${todayISO()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  showToast('Backup exported.');
}

function resetImportPreview() {
  pendingBackupRaw = null;
  pendingBackupAnalysis = null;
  pendingBackupImportedAt = null;
  $('#legacyImportError').textContent = '';
  $('#legacyImportPreview').classList.add('hidden');
  $('#confirmLegacyImport').disabled = true;
  $('#legacyFileName').textContent = 'Select a JSON backup to analyze';
  $('#legacyImportFile').value = '';
  $('#applyPostBaselineImports').checked = false;
  $('#postBaselineWarning').classList.add('hidden');
}

function populateDefaultSource() {
  $('#legacyDefaultSource').innerHTML = SOURCES.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  $('#legacyDefaultSource').value = resolveSource(data.settings.legacyDefaultSource) || 'SoFi';
}

function openImportDialog(mode = 'legacy') {
  pendingImportMode = mode;
  resetImportPreview();
  populateDefaultSource();
  $('#importDialogTitle').textContent = mode === 'legacy' ? 'Import Legacy Backup' : 'Import Current Backup';
  $('#defaultSourceControl').classList.toggle('hidden', mode !== 'legacy');
  closeDialog('settingsDialog');
  showDialog($('#legacyImportDialog'));
}

function renderImportPreview(analysis) {
  const summary = analysis.summary;
  $('#importFormat').textContent = analysis.formatLabel;
  $('#importTotalFound').textContent = String(summary.totalFound);
  $('#importToImport').textContent = String(summary.toImport);
  $('#importDuplicates').textContent = String(summary.duplicates);
  $('#importNewCategoryCount').textContent = String(summary.newCategories.length);
  $('#importDefaultCount').textContent = String(summary.defaultSourceCount);
  $('#importNewCategories').textContent = summary.newCategories.length ? summary.newCategories.join(', ') : 'None';
  $('#importMappings').innerHTML = summary.mappings.map(mapping => `<li>${escapeHtml(mapping)}</li>`).join('');
  $('#postBaselineCount').textContent = String(summary.postBaselineCount || 0);
  $('#postBaselineWarning').classList.toggle('hidden', !summary.postBaselineCount || analysis.format !== 'legacy-v2');
  $('#legacyImportPreview').classList.remove('hidden');
  $('#confirmLegacyImport').disabled = false;
}

function analyzePendingBackup() {
  if (!pendingBackupRaw) return;
  try {
    pendingBackupAnalysis = analyzeBackup(pendingBackupRaw, data, {
      defaultSource: $('#legacyDefaultSource').value,
      importedAt: pendingBackupImportedAt,
      applyPostBaseline: $('#applyPostBaselineImports').checked
    });
    if (pendingImportMode === 'current' && pendingBackupAnalysis.format === 'legacy-v2') throw new Error('This is a legacy backup. Use Import Legacy Backup instead.');
    if (pendingImportMode === 'legacy' && pendingBackupAnalysis.format !== 'legacy-v2') throw new Error('This is a current backup. Use Import Current Backup instead.');
    $('#legacyImportError').textContent = '';
    renderImportPreview(pendingBackupAnalysis);
  } catch (error) {
    pendingBackupAnalysis = null;
    $('#legacyImportPreview').classList.add('hidden');
    $('#confirmLegacyImport').disabled = true;
    $('#legacyImportError').textContent = error.message || 'This backup could not be analyzed.';
  }
}

async function prepareBackupImport(file, mode = pendingImportMode) {
  if (!file) return;
  if (!$('#legacyImportDialog').open) openImportDialog(mode);
  $('#legacyFileName').textContent = file.name;
  $('#legacyImportError').textContent = '';
  try {
    pendingBackupRaw = JSON.parse(await file.text());
    pendingBackupImportedAt = new Date().toISOString();
    analyzePendingBackup();
  } catch (error) {
    pendingBackupRaw = null;
    pendingBackupAnalysis = null;
    $('#legacyImportPreview').classList.add('hidden');
    $('#confirmLegacyImport').disabled = true;
    $('#legacyImportError').textContent = error instanceof SyntaxError ? 'This file is corrupted or is not valid JSON.' : (error.message || 'This backup is invalid.');
  } finally {
    $('#importFile').value = '';
    $('#legacyImportFile').value = '';
  }
}

function confirmBackupImport() {
  if (!pendingBackupAnalysis) return;
  try {
    createSafetyBackup(data, 'Before backup import');
    const nextData = commitBackupImport(data, pendingBackupAnalysis);
    saveData(nextData);
    data = nextData;
    promptBalancesAfterImport = pendingBackupAnalysis.format === 'legacy-v2' && !areBalancesInitialized(data);
    const summary = pendingBackupAnalysis.summary;
    $('#resultImported').textContent = String(summary.toImport);
    $('#resultSkipped').textContent = String(summary.duplicates);
    $('#resultFailed').textContent = '0';
    $('#resultProcessed').textContent = String(summary.totalFound);
    closeDialog('legacyImportDialog');
    render();
    showDialog($('#importResultDialog'));
  } catch (error) {
    $('#legacyImportError').textContent = 'FinTrack could not save this import. No data was changed.';
  }
}

function resetData() {
  if (!confirm('Reset all FinTrack data on this device? This cannot be undone unless you exported a backup.')) return;
  createSafetyBackup(data, 'Before resetting FinTrack');
  clearData();
  data = createDefaultData();
  saveData(data);
  expandedRows.clear();
  closeDialog('settingsDialog');
  render();
  showToast('FinTrack data reset.');
}

function voiceDraft(transaction) {
  const type = transaction.type || 'expense';
  const builtIn = transaction.category ? CATEGORIES[type]?.find(category => category.toLocaleLowerCase() === transaction.category.toLocaleLowerCase()) : null;
  return {
    ...transaction,
    type: transaction.type,
    category: builtIn || (transaction.category ? 'Custom' : ''),
    customCategory: builtIn ? '' : (transaction.category || ''),
    inputMethod: 'siri-voice'
  };
}

function voiceFallbackMessage(result) {
  const labels = { type: 'transaction type', amount: 'amount', source: 'source', category: 'category' };
  const captured = ['type', 'amount', 'source', 'category'].filter(field => !result.missingFields.includes(field)).map(field => labels[field]);
  const missing = result.missingFields.map(field => labels[field]);
  const capturedText = captured.length ? `I captured the ${captured.join(', ')}. ` : '';
  return `${capturedText}Please complete the missing ${missing.join(' and ')}.`;
}

function saveLinkedTransaction(draft, kind, displayValue) {
  const saved = saveTransaction(data, draft);
  if (saved.errors.length) return { saved: false, error: saved.errors[0] };
  switchView('dashboardView');
  render();
  const label = draft.type === 'income' ? 'Income' : 'Expense';
  showToast(`${label} saved`, false, {
    subtitle: `${displayValue} · ${money(draft.amount)} · ${draft.source}`,
    undoId: saved.transaction.id,
    duration: 8000
  });
  return { saved: true, transaction: saved.transaction };
}

function processDeepLink() {
  if (deepLinkProcessing) return false;
  const request = parseDeepLinkRequest(location.href, { today: todayISO() });
  if (!request) return false;
  deepLinkProcessing = true;
  try {
    history.replaceState({}, document.title, request.cleanUrl);
    if (!claimDeepLinkFingerprint(sessionStorage, request.fingerprint)) {
      showToast('This deep link was already processed.', true);
      return true;
    }
    if (request.kind === 'structured') {
      if (request.errors.length) {
        showToast(request.errors[0], true);
        return true;
      }
      const displayValue = request.transaction.customCategory || request.transaction.category;
      const outcome = saveLinkedTransaction(request.transaction, request.kind, displayValue);
      if (!outcome.saved) showToast(outcome.error, true);
      return true;
    }

    const parsed = request.result;
    const draft = voiceDraft(parsed.transaction);
    if (!parsed.valid) {
      openTransactionForm(draft, { missingFields: parsed.missingFields, message: voiceFallbackMessage(parsed) });
      parsed.originalText = '';
      return true;
    }
    const outcome = saveLinkedTransaction(draft, request.kind, parsed.transaction.category);
    if (!outcome.saved) openTransactionForm(draft, { message: outcome.error });
    parsed.originalText = '';
    return true;
  } finally {
    deepLinkProcessing = false;
  }
}

function configureInstallAction() {
  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if ((deferredInstallPrompt || (isAppleMobile && !standalone)) && !standalone) $('#installAppBtn').classList.remove('hidden');
}

document.addEventListener('click', event => {
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) closeDialog(closeButton.dataset.close);
  const expandButton = event.target.closest('[data-expand-row]');
  if (expandButton) toggleExpanded(expandButton.dataset.expandRow);
  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) editTransaction(editButton.dataset.editId);
  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) deleteTransaction(deleteButton.dataset.deleteId);
  const paidButton = event.target.closest('[data-mark-paid]');
  if (paidButton) markPaid(paidButton.dataset.markPaid);
  const undoButton = event.target.closest('[data-undo-transaction]');
  if (undoButton && undoTransaction?.id === undoButton.dataset.undoTransaction && Date.now() <= undoTransaction.expiresAt) {
    const before = data.transactions.length;
    data.transactions = data.transactions.filter(transaction => transaction.id !== undoTransaction.id);
    if (data.transactions.length !== before) {
      saveData(data);
      render();
      showToast('Transaction undone.');
    }
  }
  const reverseAdjustmentButton = event.target.closest('[data-reverse-adjustment]');
  if (reverseAdjustmentButton && confirm('Reverse this balance adjustment?')) {
    createSafetyBackup(data, 'Before reversing balance adjustment');
    if (reverseBalanceAdjustment(data, reverseAdjustmentButton.dataset.reverseAdjustment)) {
      saveData(data);
      render();
      renderAdjustmentHistory();
      showToast('Balance adjustment reversed.');
    }
  }
  const deleteAdjustmentButton = event.target.closest('[data-delete-adjustment]');
  if (deleteAdjustmentButton && confirm('Permanently delete this balance adjustment?')) {
    createSafetyBackup(data, 'Before deleting balance adjustment');
    if (deleteBalanceAdjustment(data, deleteAdjustmentButton.dataset.deleteAdjustment)) {
      saveData(data);
      render();
      renderAdjustmentHistory();
      showToast('Balance adjustment deleted.');
    }
  }
  const sourceButton = event.target.closest('[data-source-filter]');
  if (sourceButton) {
    ['filterType', 'filterStatus', 'filterCategory'].forEach(id => { document.getElementById(id).value = ''; });
    $('#filterSource').value = sourceButton.dataset.sourceFilter;
    $('#sortBy').value = 'date-desc';
    switchView('transactionsView');
    renderTransactions();
  }
});

document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('.modal').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
}));

$('#settingsBtn').addEventListener('click', () => showDialog($('#settingsDialog')));
$('#balanceBreakdownBtn').addEventListener('click', () => showDialog($('#balanceDialog')));
$('#addTransactionBtn').addEventListener('click', () => openTransactionForm());
$('#addTransactionTopBtn').addEventListener('click', () => openTransactionForm());
$('#transactionType').addEventListener('change', () => {
  const currentSelection = $('#transactionCategory').value;
  const currentCategory = currentSelection === 'Custom...' ? $('#customCategory').value : currentSelection;
  const allowBlank = $('#transactionDialog').dataset.missingCategory === 'true' && !currentCategory;
  refreshCategoryOptions(currentCategory, allowBlank);
  if (currentCategory && $('#transactionCategory').value === 'Custom...') $('#customCategory').value = currentCategory;
  refreshStatusOptions();
});
$('#transactionCategory').addEventListener('change', () => {
  if ($('#transactionCategory').value) $('#transactionDialog').dataset.missingCategory = 'false';
  $('#customCategoryWrap').classList.toggle('hidden', $('#transactionCategory').value !== 'Custom...');
  if ($('#transactionCategory').value === 'Custom...') $('#customCategory').focus();
});
$('#transactionForm').addEventListener('submit', event => {
  event.preventDefault();
  if (formSubmitting) return;
  formSubmitting = true;
  $('#saveTransactionBtn').disabled = true;
  const result = saveTransaction(data, draftFromForm());
  if (result.errors.length) {
    $('#transactionError').textContent = result.errors[0];
    formSubmitting = false;
    $('#saveTransactionBtn').disabled = false;
    return;
  }
  closeDialog('transactionDialog');
  render();
  showToast($('#transactionId').value ? 'Transaction updated.' : 'Transaction added.');
});

['filterType', 'filterSource', 'filterStatus', 'filterCategory', 'sortBy'].forEach(id => document.getElementById(id).addEventListener('change', renderTransactions));
$('#clearFiltersBtn').addEventListener('click', () => {
  ['filterType', 'filterSource', 'filterStatus', 'filterCategory'].forEach(id => { document.getElementById(id).value = ''; });
  $('#sortBy').value = 'date-desc';
  renderTransactions();
});
$('#exportBtn').addEventListener('click', exportData);
$('#importFile').addEventListener('change', event => prepareBackupImport(event.target.files[0], 'current'));
$('#legacyImportBtn').addEventListener('click', () => openImportDialog('legacy'));
$('#legacyImportFile').addEventListener('change', event => prepareBackupImport(event.target.files[0]));
$('#legacyDefaultSource').addEventListener('change', analyzePendingBackup);
$('#applyPostBaselineImports').addEventListener('change', analyzePendingBackup);
$('#confirmLegacyImport').addEventListener('click', confirmBackupImport);
$('#baseBalancesBtn').addEventListener('click', openBaseDialog);
$('#adjustBalancesBtn').addEventListener('click', openAdjustmentDialog);
$('#adjustmentHistoryBtn').addEventListener('click', openAdjustmentHistory);
$('#adjustmentSource').addEventListener('change', updateAdjustmentPreview);
$('#adjustmentActual').addEventListener('input', updateAdjustmentPreview);
$('#resetBtn').addEventListener('click', resetData);
$('#skipBaselineBtn').addEventListener('click', () => {
  sessionStorage.setItem('fintrack.balanceSetupDismissed', '1');
  closeDialog('baseDialog');
});
$('#baseForm').addEventListener('submit', event => {
  event.preventDefault();
  const replacing = areBalancesInitialized(data);
  if (replacing && !$('#confirmBaselineReplace').checked) return showToast('Confirm that you want to replace the existing baselines.', true);
  const amounts = Object.fromEntries(SOURCES.map((source, index) => [source, Number($(`#baseSource${index}`).value)]));
  let baselineDate;
  try { baselineDate = fromLocalDateTimeInput($('#baseDate').value); } catch (error) { return showToast('Choose a valid baseline date and time.', true); }
  createSafetyBackup(data, replacing ? 'Before replacing balance baselines' : 'Before initializing balances');
  const result = initializeBalances(data, amounts, baselineDate);
  if (result.error) return showToast(result.error, true);
  data.settings.preventNegativeBalances = $('#preventNegative').checked;
  saveData(data);
  closeDialog('baseDialog');
  sessionStorage.removeItem('fintrack.balanceSetupDismissed');
  render();
  showToast(replacing ? 'Balance baselines replaced.' : 'Current balances initialized.');
});

$('#adjustBalanceForm').addEventListener('submit', event => {
  event.preventDefault();
  if (formSubmitting) return;
  formSubmitting = true;
  $('#saveAdjustmentBtn').disabled = true;
  createSafetyBackup(data, 'Before balance adjustment');
  const result = createBalanceAdjustment(data, {
    source: $('#adjustmentSource').value,
    newActualBalance: $('#adjustmentActual').value,
    date: $('#adjustmentDate').value,
    reason: $('#adjustmentReason').value
  });
  if (result.errors.length) {
    $('#adjustmentError').textContent = result.errors[0];
    formSubmitting = false;
    $('#saveAdjustmentBtn').disabled = false;
    return;
  }
  saveData(data);
  formSubmitting = false;
  $('#saveAdjustmentBtn').disabled = false;
  closeDialog('adjustBalanceDialog');
  render();
  showToast('Balance adjustment saved.');
});

$('#importResultDialog').addEventListener('close', () => {
  if (promptBalancesAfterImport) {
    promptBalancesAfterImport = false;
    setTimeout(openBaseDialog, 0);
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  configureInstallAction();
});
$('#installAppBtn').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    $('#installAppBtn').classList.add('hidden');
  } else {
    alert('On iPhone or iPad, open FinTrack in Safari, tap Share, then choose Add to Home Screen.');
  }
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

render();
configureInstallAction();
const hadDeepLinkAtStartup = new URLSearchParams(location.search).has('action');
processDeepLink();
window.addEventListener('pageshow', processDeepLink);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') processDeepLink(); });
if (!areBalancesInitialized(data) && !hadDeepLinkAtStartup && !sessionStorage.getItem('fintrack.balanceSetupDismissed')) setTimeout(openBaseDialog, 150);
