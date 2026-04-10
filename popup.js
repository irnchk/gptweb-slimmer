const DEFAULTS = {
  enabled: true,
  keepTurns: 40,
  stepTurns: 20,
  showOverlay: true,
  language: 'auto',
};

const STORAGE_META_KEY = 'settingsStorageMode';
const STORAGE_META_VALUE = 'local-v1';
const KEEP_TURNS_MIN = 5;
const KEEP_TURNS_MAX = 400;
const STEP_TURNS_MIN = 5;
const STEP_TURNS_MAX = 200;

const { createTranslator, normalizeLanguage } = globalThis.ChatSlimmerI18n;

const elements = {
  heroSubtitle: document.getElementById('heroSubtitle'),
  enabledLabel: document.getElementById('enabledLabel'),
  enabled: document.getElementById('enabled'),
  keepTurnsLabel: document.getElementById('keepTurnsLabel'),
  keepTurnsRange: document.getElementById('keepTurns'),
  keepTurnsNumber: document.getElementById('keepTurnsNumber'),
  keepTurnsValue: document.getElementById('keepTurnsValue'),
  keepTurnsHint: document.getElementById('keepTurnsHint'),
  stepTurnsLabel: document.getElementById('stepTurnsLabel'),
  stepTurnsRange: document.getElementById('stepTurns'),
  stepTurnsNumber: document.getElementById('stepTurnsNumber'),
  stepTurnsValue: document.getElementById('stepTurnsValue'),
  stepTurnsHint: document.getElementById('stepTurnsHint'),
  languageLabel: document.getElementById('languageLabel'),
  language: document.getElementById('language'),
  languageHint: document.getElementById('languageHint'),
  languageOptionAuto: document.getElementById('languageOptionAuto'),
  languageOptionKo: document.getElementById('languageOptionKo'),
  languageOptionEn: document.getElementById('languageOptionEn'),
  showOverlayLabel: document.getElementById('showOverlayLabel'),
  showOverlay: document.getElementById('showOverlay'),
  statsTitle: document.getElementById('statsTitle'),
  refreshStatus: document.getElementById('refreshStatus'),
  modeTerm: document.getElementById('modeTerm'),
  totalTurnsTerm: document.getElementById('totalTurnsTerm'),
  renderedTurnsTerm: document.getElementById('renderedTurnsTerm'),
  hiddenTurnsTerm: document.getElementById('hiddenTurnsTerm'),
  reductionTerm: document.getElementById('reductionTerm'),
  loadOlder: document.getElementById('loadOlder'),
  showLatest: document.getElementById('showLatest'),
  showAll: document.getElementById('showAll'),
  statusMode: document.getElementById('statusMode'),
  totalTurns: document.getElementById('totalTurns'),
  renderedTurns: document.getElementById('renderedTurns'),
  hiddenTurns: document.getElementById('hiddenTurns'),
  reduction: document.getElementById('reduction'),
  statusHint: document.getElementById('statusHint'),
};

let activeTab = null;
let persistTimer = 0;
let currentSettings = { ...DEFAULTS };

bootstrap().catch((error) => {
  console.error('Popup bootstrap failed:', error);
  applySettingsToUI(currentSettings);
  renderDisconnected(getTranslator().t('status_initializing_error'));
});

async function bootstrap() {
  const settings = await loadSettings();
  applySettingsToUI(settings);
  bindEvents();
  activeTab = await getActiveTab();
  await refreshStatus();
}

function bindEvents() {
  elements.enabled.addEventListener('change', () => {
    handleSettingsChanged(true);
  });

  elements.showOverlay.addEventListener('change', () => {
    handleSettingsChanged(true);
  });

  elements.language.addEventListener('change', () => {
    handleSettingsChanged(true);
  });

  bindTurnControl({
    rangeEl: elements.keepTurnsRange,
    numberEl: elements.keepTurnsNumber,
    valueEl: elements.keepTurnsValue,
    min: KEEP_TURNS_MIN,
    max: KEEP_TURNS_MAX,
    fallback: DEFAULTS.keepTurns,
  });

  bindTurnControl({
    rangeEl: elements.stepTurnsRange,
    numberEl: elements.stepTurnsNumber,
    valueEl: elements.stepTurnsValue,
    min: STEP_TURNS_MIN,
    max: STEP_TURNS_MAX,
    fallback: DEFAULTS.stepTurns,
  });

  elements.refreshStatus.addEventListener('click', () => {
    refreshStatus().catch(console.error);
  });

  elements.loadOlder.addEventListener('click', () => {
    sendAction({ type: 'LOAD_OLDER' }).then(renderStatus).catch(console.error);
  });

  elements.showLatest.addEventListener('click', () => {
    sendAction({ type: 'SHOW_LATEST' }).then(renderStatus).catch(console.error);
  });

  elements.showAll.addEventListener('click', () => {
    sendAction({ type: 'SHOW_ALL' }).then(renderStatus).catch(console.error);
  });
}

function bindTurnControl({ rangeEl, numberEl, valueEl, min, max, fallback }) {
  const syncValue = (rawValue) => {
    const value = clampNumber(rawValue, min, max, fallback);
    rangeEl.value = String(value);
    numberEl.value = String(value);
    valueEl.value = formatTurnCount(value);
  };

  rangeEl.addEventListener('input', () => {
    syncValue(rangeEl.value);
    handleSettingsChanged(false);
  });

  rangeEl.addEventListener('change', () => {
    syncValue(rangeEl.value);
    handleSettingsChanged(true);
  });

  numberEl.addEventListener('input', () => {
    syncValue(numberEl.value);
    handleSettingsChanged(false);
  });

  numberEl.addEventListener('change', () => {
    syncValue(numberEl.value);
    handleSettingsChanged(true);
  });
}

function handleSettingsChanged(flushPersist) {
  const next = readSettingsFromUI();
  applySettingsToUI(next);
  previewSettings(next).catch(console.error);

  if (flushPersist) {
    flushPersistSettings(next).catch(console.error);
    return;
  }

  schedulePersistSettings(next);
}

function schedulePersistSettings(next) {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistSettings(next).catch(console.error);
  }, 160);
}

async function flushPersistSettings(next) {
  window.clearTimeout(persistTimer);
  await persistSettings(next);
}

async function previewSettings(next) {
  const status = await sendAction({ type: 'SETTINGS_UPDATED', settings: next }).catch(() => null);
  if (status) {
    renderStatus(status);
    return;
  }

  if (!isSupportedChatgptTab(activeTab)) {
    renderDisconnected(getTranslator().t('status_chatgpt_only'));
  }
}

async function refreshStatus() {
  activeTab = await getActiveTab();
  if (!isSupportedChatgptTab(activeTab)) {
    renderDisconnected(getTranslator().t('status_chatgpt_only'));
    return;
  }

  const status = await sendAction({ type: 'GET_STATUS' }).catch(() => null);
  if (!status) {
    renderDisconnected(getTranslator().t('status_not_detected_yet'));
    return;
  }

  renderStatus(status);
}

async function sendAction(message) {
  activeTab = await getActiveTab();
  if (!isSupportedChatgptTab(activeTab)) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(activeTab.id, message);
  } catch (error) {
    console.warn('sendAction failed:', error);
    return null;
  }
}

function renderStatus(status) {
  if (!status) {
    renderDisconnected(getTranslator().t('status_load_failed'));
    return;
  }

  const t = getTranslator();
  const reduction = status.renderedTurns > 0
    ? `${(status.totalTurns / status.renderedTurns).toFixed(1)}x`
    : '-';

  elements.statusMode.textContent = t.t(`mode_${getModeKey(status)}`);
  elements.totalTurns.textContent = String(status.totalTurns ?? '-');
  elements.renderedTurns.textContent = String(status.renderedTurns ?? '-');
  elements.hiddenTurns.textContent = String(status.hiddenTurns ?? '-');
  elements.reduction.textContent = reduction;
  elements.statusHint.textContent = status.containerFound
    ? t.t('status_hint_connected', {
        keepTurns: formatTurnCount(status.keepTurns),
        stepTurns: formatTurnCount(status.stepTurns),
      })
    : t.t('status_hint_not_found');

  const controlsEnabled = Boolean(status.containerFound);
  elements.loadOlder.disabled = !controlsEnabled || status.hiddenTurns === 0;
  elements.showLatest.disabled = !controlsEnabled || (!status.expanded && !status.showAll);
  elements.showAll.disabled = !controlsEnabled || status.showAll;
}

function renderDisconnected(message) {
  elements.statusMode.textContent = getTranslator().t('status_waiting');
  elements.totalTurns.textContent = '-';
  elements.renderedTurns.textContent = '-';
  elements.hiddenTurns.textContent = '-';
  elements.reduction.textContent = '-';
  elements.statusHint.textContent = message;
  elements.loadOlder.disabled = true;
  elements.showLatest.disabled = true;
  elements.showAll.disabled = true;
}

function applySettingsToUI(settings) {
  currentSettings = normalizeSettings(settings);
  const t = getTranslator();

  document.documentElement.lang = t.resolved;
  document.title = 'Long Chat Slimmer';

  elements.heroSubtitle.textContent = t.t('popup_subtitle');
  elements.enabledLabel.textContent = t.t('setting_enabled');
  elements.keepTurnsLabel.textContent = t.t('setting_keep_turns');
  elements.keepTurnsHint.textContent = t.t('setting_keep_turns_hint');
  elements.stepTurnsLabel.textContent = t.t('setting_step_turns');
  elements.stepTurnsHint.textContent = t.t('setting_step_turns_hint');
  elements.languageLabel.textContent = t.t('setting_language');
  elements.languageHint.textContent = t.t('setting_language_hint');
  elements.languageOptionAuto.textContent = t.t('language_auto');
  elements.languageOptionKo.textContent = t.t('language_ko');
  elements.languageOptionEn.textContent = t.t('language_en');
  elements.showOverlayLabel.textContent = t.t('setting_show_overlay');
  elements.statsTitle.textContent = t.t('stats_current_tab');
  elements.refreshStatus.textContent = t.t('action_refresh');
  elements.modeTerm.textContent = t.t('stat_mode');
  elements.totalTurnsTerm.textContent = t.t('stat_total_turns');
  elements.renderedTurnsTerm.textContent = t.t('stat_rendered_turns');
  elements.hiddenTurnsTerm.textContent = t.t('stat_hidden_turns');
  elements.reductionTerm.textContent = t.t('stat_reduction');
  elements.loadOlder.textContent = t.t('action_load_older');
  elements.showLatest.textContent = t.t('action_show_latest');
  elements.showAll.textContent = t.t('action_show_all');

  elements.enabled.checked = currentSettings.enabled;
  elements.keepTurnsRange.value = String(currentSettings.keepTurns);
  elements.keepTurnsNumber.value = String(currentSettings.keepTurns);
  elements.keepTurnsValue.value = formatTurnCount(currentSettings.keepTurns);
  elements.stepTurnsRange.value = String(currentSettings.stepTurns);
  elements.stepTurnsNumber.value = String(currentSettings.stepTurns);
  elements.stepTurnsValue.value = formatTurnCount(currentSettings.stepTurns);
  elements.language.value = currentSettings.language;
  elements.showOverlay.checked = currentSettings.showOverlay;
}

function readSettingsFromUI() {
  return normalizeSettings({
    enabled: elements.enabled.checked,
    keepTurns: elements.keepTurnsNumber.value,
    stepTurns: elements.stepTurnsNumber.value,
    language: elements.language.value,
    showOverlay: elements.showOverlay.checked,
  });
}

async function loadSettings() {
  const local = await chrome.storage.local.get([...Object.keys(DEFAULTS), STORAGE_META_KEY]);
  const hasLocalSettings = Object.keys(DEFAULTS).some((key) => key in local);
  if (hasLocalSettings || local[STORAGE_META_KEY] === STORAGE_META_VALUE) {
    return normalizeSettings(local);
  }

  const sync = await chrome.storage.sync.get(DEFAULTS);
  const migrated = normalizeSettings(sync);
  await chrome.storage.local.set({
    ...migrated,
    [STORAGE_META_KEY]: STORAGE_META_VALUE,
  });
  return migrated;
}

async function persistSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({
    ...normalized,
    [STORAGE_META_KEY]: STORAGE_META_VALUE,
  });
}

function normalizeSettings(value) {
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
    keepTurns: clampNumber(value.keepTurns, KEEP_TURNS_MIN, KEEP_TURNS_MAX, DEFAULTS.keepTurns),
    stepTurns: clampNumber(value.stepTurns, STEP_TURNS_MIN, STEP_TURNS_MAX, DEFAULTS.stepTurns),
    showOverlay: typeof value.showOverlay === 'boolean' ? value.showOverlay : DEFAULTS.showOverlay,
    language: normalizeLanguage(value.language),
  };
}

function formatTurnCount(count) {
  return getTranslator().t('turn_count', { count });
}

function getTranslator() {
  return createTranslator(currentSettings.language);
}

function getModeKey(status) {
  if (!status.enabled) {
    return 'disabled';
  }
  if (!status.containerFound) {
    return 'detecting';
  }
  if (status.showAll) {
    return 'show_all';
  }
  if (status.expanded) {
    return 'expanded';
  }
  return 'auto';
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function isSupportedChatgptTab(tab) {
  if (!tab?.url) {
    return false;
  }
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url);
}
