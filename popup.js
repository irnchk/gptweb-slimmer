const DEFAULTS = {
  enabled: true,
  keepTurns: 40,
  stepTurns: 20,
  showOverlay: true,
};

const STORAGE_META_KEY = 'settingsStorageMode';
const STORAGE_META_VALUE = 'local-v1';
const KEEP_TURNS_MIN = 5;
const KEEP_TURNS_MAX = 400;
const STEP_TURNS_MIN = 5;
const STEP_TURNS_MAX = 200;

const elements = {
  enabled: document.getElementById('enabled'),
  keepTurnsRange: document.getElementById('keepTurns'),
  keepTurnsNumber: document.getElementById('keepTurnsNumber'),
  keepTurnsValue: document.getElementById('keepTurnsValue'),
  stepTurnsRange: document.getElementById('stepTurns'),
  stepTurnsNumber: document.getElementById('stepTurnsNumber'),
  stepTurnsValue: document.getElementById('stepTurnsValue'),
  showOverlay: document.getElementById('showOverlay'),
  refreshStatus: document.getElementById('refreshStatus'),
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

bootstrap().catch((error) => {
  console.error('Popup bootstrap failed:', error);
  renderDisconnected('초기화 중 오류가 발생했습니다.');
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
    valueEl.value = `${value}턴`;
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
    renderDisconnected('ChatGPT 대화 탭에서만 동작합니다.');
  }
}

async function refreshStatus() {
  activeTab = await getActiveTab();
  if (!isSupportedChatgptTab(activeTab)) {
    renderDisconnected('ChatGPT 대화 탭에서만 동작합니다.');
    return;
  }

  const status = await sendAction({ type: 'GET_STATUS' }).catch(() => null);
  if (!status) {
    renderDisconnected('이 탭에서 아직 내용을 감지하지 못했습니다. 페이지를 한 번 새로고침해 보세요.');
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
    renderDisconnected('상태 정보를 불러오지 못했습니다.');
    return;
  }

  const reduction = status.renderedTurns > 0
    ? `${(status.totalTurns / status.renderedTurns).toFixed(1)}x`
    : '-';

  elements.statusMode.textContent = mapMode(status);
  elements.totalTurns.textContent = String(status.totalTurns ?? '-');
  elements.renderedTurns.textContent = String(status.renderedTurns ?? '-');
  elements.hiddenTurns.textContent = String(status.hiddenTurns ?? '-');
  elements.reduction.textContent = reduction;
  elements.statusHint.textContent = status.containerFound
    ? `이 브라우저에서는 최근 ${status.keepTurns}개 턴 유지, 필요할 때 ${status.stepTurns}개씩 더 펼치도록 설정했습니다.`
    : '이 페이지에서는 아직 채팅 턴을 찾지 못했습니다.';

  const controlsEnabled = Boolean(status.containerFound);
  elements.loadOlder.disabled = !controlsEnabled || status.hiddenTurns === 0;
  elements.showLatest.disabled = !controlsEnabled || (!status.expanded && !status.showAll);
  elements.showAll.disabled = !controlsEnabled || status.showAll;
}

function renderDisconnected(message) {
  elements.statusMode.textContent = '대기 중';
  elements.totalTurns.textContent = '-';
  elements.renderedTurns.textContent = '-';
  elements.hiddenTurns.textContent = '-';
  elements.reduction.textContent = '-';
  elements.statusHint.textContent = message;
  elements.loadOlder.disabled = true;
  elements.showLatest.disabled = true;
  elements.showAll.disabled = true;
}

function mapMode(status) {
  if (!status.enabled) {
    return '비활성화';
  }
  if (!status.containerFound) {
    return '감지 중';
  }
  if (status.showAll) {
    return '전체 표시';
  }
  if (status.expanded) {
    return '확장 표시';
  }
  return '자동 경량화';
}

function applySettingsToUI(settings) {
  const normalized = normalizeSettings(settings);
  elements.enabled.checked = normalized.enabled;
  elements.keepTurnsRange.value = String(normalized.keepTurns);
  elements.keepTurnsNumber.value = String(normalized.keepTurns);
  elements.keepTurnsValue.value = `${normalized.keepTurns}턴`;
  elements.stepTurnsRange.value = String(normalized.stepTurns);
  elements.stepTurnsNumber.value = String(normalized.stepTurns);
  elements.stepTurnsValue.value = `${normalized.stepTurns}턴`;
  elements.showOverlay.checked = normalized.showOverlay;
}

function readSettingsFromUI() {
  return normalizeSettings({
    enabled: elements.enabled.checked,
    keepTurns: elements.keepTurnsNumber.value,
    stepTurns: elements.stepTurnsNumber.value,
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
  };
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
