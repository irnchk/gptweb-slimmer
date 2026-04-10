(() => {
  const DEFAULT_SETTINGS = {
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

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    conversationKey: '',
    main: null,
    container: null,
    scrollContainer: null,
    visibleTurns: [],
    hiddenTurns: [],
    placeholder: null,
    overlayHost: null,
    overlayShadow: null,
    overlayEls: {},
    observer: null,
    scheduled: false,
    disposed: false,
    persistTimer: 0,
    expandBy: 0,
    showAll: false,
    overlayOpen: false,
  };

  const PLACEHOLDER_ATTR = 'data-chat-slimmer-placeholder';
  const ROOT_ATTR = 'data-chat-slimmer-root';
  const STYLES_ATTR = 'data-chat-slimmer-styles';

  bootstrap().catch((error) => {
    console.error('[Chat Slimmer] bootstrap failed', error);
  });

  async function bootstrap() {
    state.settings = await loadSettings();
    injectPageStyles();
    buildOverlay();
    bindRuntime();
    bindObservers();
    scheduleRefresh();
  }

  function bindRuntime() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      Promise.resolve(handleMessage(message)).then(sendResponse);
      return true;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      const next = { ...state.settings };
      let touched = false;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (changes[key]) {
          next[key] = changes[key].newValue;
          touched = true;
        }
      }

      if (!touched) {
        return;
      }

      state.settings = normalizeSettings(next);
      if (!state.settings.enabled) {
        state.showAll = true;
        state.expandBy = 0;
      }
      refreshNow();
    });

    window.addEventListener('popstate', handlePossibleNavigation, true);
    window.addEventListener('hashchange', handlePossibleNavigation, true);
  }

  function bindObservers() {
    state.observer = new MutationObserver(() => {
      scheduleRefresh();
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function handlePossibleNavigation() {
    scheduleRefresh();
  }

  function scheduleRefresh() {
    if (state.scheduled || state.disposed) {
      return;
    }

    state.scheduled = true;
    window.setTimeout(() => {
      state.scheduled = false;
      refreshNow();
    }, 120);
  }

  function refreshNow() {
    const nextConversationKey = getConversationKey();
    if (nextConversationKey !== state.conversationKey) {
      resetConversationState(false);
      state.conversationKey = nextConversationKey;
    }

    const structure = findConversationStructure();
    if (!structure) {
      updateStats({ containerFound: false, totalTurns: 0, renderedTurns: 0, hiddenTurns: 0 });
      return;
    }

    if (state.container && state.container !== structure.container) {
      resetConversationState(false);
    }

    if (!state.container) {
      state.main = structure.main;
      state.container = structure.container;
      state.scrollContainer = findScrollContainer(structure.container);
      state.visibleTurns = structure.turns.slice();
      state.hiddenTurns = [];
      state.showAll = !state.settings.enabled ? true : state.showAll;
      state.expandBy = 0;
    } else {
      const merged = mergeCurrentStructure(structure.turns);
      if (!merged) {
        state.main = structure.main;
        state.container = structure.container;
        state.scrollContainer = findScrollContainer(structure.container);
        state.visibleTurns = structure.turns.slice();
        state.hiddenTurns = [];
        removePlaceholder();
      }
    }

    if (!state.settings.enabled) {
      restoreAllHiddenTurns();
      updateStatsFromState(true);
      return;
    }

    applyWindowing();
    updateStatsFromState(true);
  }

  function findConversationStructure() {
    const main = document.querySelector('main');
    if (!main) {
      return null;
    }

    const seeds = collectTurnSeeds(main);
    if (seeds.length < 2) {
      return null;
    }

    const candidateMap = new Map();
    for (const seed of seeds) {
      let child = seed;
      let parent = seed.parentElement;
      while (parent) {
        if (parent === document.body.parentElement) {
          break;
        }

        let record = candidateMap.get(parent);
        if (!record) {
          record = { children: new Set(), depth: getDepth(parent) };
          candidateMap.set(parent, record);
        }
        record.children.add(child);

        if (parent === main) {
          break;
        }

        child = parent;
        parent = parent.parentElement;
      }
    }

    let bestParent = null;
    let bestChildren = null;
    let bestScore = -1;

    for (const [parent, record] of candidateMap.entries()) {
      const children = Array.from(record.children).filter((element) => isUsefulTurnWrapper(element));
      if (children.length < 2) {
        continue;
      }

      const score = children.length * 1000 + record.depth;
      if (score > bestScore) {
        bestScore = score;
        bestParent = parent;
        bestChildren = children;
      }
    }

    if (!bestParent || !bestChildren) {
      return null;
    }

    const turns = bestChildren
      .filter((element) => element.parentElement === bestParent)
      .sort(compareDocumentOrder);

    if (turns.length < 2) {
      return null;
    }

    return {
      main,
      container: bestParent,
      turns,
    };
  }

  function collectTurnSeeds(main) {
    const selector = [
      'article[data-testid*="conversation-turn"]',
      'div[data-testid*="conversation-turn"]',
      '[data-message-author-role]'
    ].join(',');

    const seeds = Array.from(main.querySelectorAll(selector));
    return seeds.filter((element) => {
      if (!element?.isConnected) {
        return false;
      }
      if (element.closest(`[${ROOT_ATTR}]`)) {
        return false;
      }
      if (element.closest(`[${PLACEHOLDER_ATTR}]`)) {
        return false;
      }
      if (element.closest('form, nav, header, footer, aside')) {
        return false;
      }
      return hasInterestingContent(element);
    });
  }

  function isUsefulTurnWrapper(element) {
    if (!element?.isConnected) {
      return false;
    }
    if (element.closest(`[${ROOT_ATTR}]`)) {
      return false;
    }
    if (element.hasAttribute(PLACEHOLDER_ATTR)) {
      return false;
    }
    if (element.matches('form, nav, header, footer, aside')) {
      return false;
    }
    return hasInterestingContent(element);
  }

  function hasInterestingContent(element) {
    if (!element) {
      return false;
    }

    const text = (element.innerText || '').trim();
    if (text.length >= 6) {
      return true;
    }

    return Boolean(
      element.querySelector(
        'pre, code, table, img, video, audio, canvas, svg, math, blockquote, [data-message-author-role]'
      )
    );
  }

  function mergeCurrentStructure(latestTurns) {
    if (!state.container) {
      return false;
    }

    if (!arraysEqualByIdentity(latestTurns, state.visibleTurns)) {
      if (startsWithByIdentity(latestTurns, state.visibleTurns)) {
        state.visibleTurns = latestTurns.slice();
        return true;
      }

      if (latestTurns.length >= 1 && state.visibleTurns.length >= 1) {
        const sameFirst = latestTurns[0] === state.visibleTurns[0];
        const sameLast = latestTurns.at(-1) === state.visibleTurns.at(-1);
        if (sameFirst && sameLast) {
          state.visibleTurns = latestTurns.slice();
          return true;
        }
      }

      return false;
    }

    return true;
  }

  function applyWindowing() {
    if (!state.container) {
      return;
    }

    const totalTurns = state.hiddenTurns.length + state.visibleTurns.length;
    const targetVisible = state.showAll
      ? totalTurns
      : Math.min(totalTurns, Math.max(1, state.settings.keepTurns + state.expandBy));
    const targetHidden = Math.max(0, totalTurns - targetVisible);

    const snapshot = captureScroll();

    if (state.hiddenTurns.length < targetHidden) {
      const hideCount = targetHidden - state.hiddenTurns.length;
      const removed = state.visibleTurns.splice(0, hideCount);
      state.hiddenTurns.push(...removed);
      for (const node of removed) {
        if (node.parentElement === state.container) {
          state.container.removeChild(node);
        }
      }
    } else if (state.hiddenTurns.length > targetHidden) {
      const restoreCount = state.hiddenTurns.length - targetHidden;
      const restored = state.hiddenTurns.slice(-restoreCount);
      state.hiddenTurns = state.hiddenTurns.slice(0, -restoreCount);
      const insertionPoint = state.visibleTurns[0] || state.placeholder || null;
      for (const node of restored) {
        state.container.insertBefore(node, insertionPoint);
      }
      state.visibleTurns = restored.concat(state.visibleTurns);
    }

    if (state.hiddenTurns.length > 0) {
      ensurePlaceholder();
    } else {
      removePlaceholder();
    }

    restoreScroll(snapshot);
  }

  function ensurePlaceholder() {
    if (!state.container || state.hiddenTurns.length === 0) {
      removePlaceholder();
      return;
    }

    if (!state.placeholder) {
      state.placeholder = document.createElement('div');
      state.placeholder.setAttribute(PLACEHOLDER_ATTR, '1');
      state.placeholder.className = 'chat-slimmer-placeholder';
      state.placeholder.innerHTML = `
        <div class="chat-slimmer-placeholder__text"></div>
        <div class="chat-slimmer-placeholder__actions">
          <button type="button" data-action="older">이전 더 보기</button>
          <button type="button" data-action="latest">최신만</button>
          <button type="button" data-action="all">전체 보기</button>
        </div>
      `;
      state.placeholder.addEventListener('click', onPlaceholderClick);
    }

    const firstVisible = state.visibleTurns[0] || null;
    if (state.placeholder.parentElement !== state.container) {
      state.container.insertBefore(state.placeholder, firstVisible);
    } else if (firstVisible && state.placeholder.nextSibling !== firstVisible) {
      state.container.insertBefore(state.placeholder, firstVisible);
    }

    const textEl = state.placeholder.querySelector('.chat-slimmer-placeholder__text');
    const hidden = state.hiddenTurns.length;
    const rendered = state.visibleTurns.length;
    const total = hidden + rendered;
    const reduction = rendered > 0 ? (total / rendered).toFixed(1) : '1.0';
    textEl.textContent = `오래된 ${hidden}개 턴을 숨겨 DOM을 약 ${reduction}x 가볍게 유지 중`;
  }

  function removePlaceholder() {
    if (state.placeholder?.isConnected) {
      state.placeholder.remove();
    }
  }

  function onPlaceholderClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (action === 'older') {
      loadOlderTurns();
    } else if (action === 'latest') {
      showLatestOnly();
    } else if (action === 'all') {
      showAllTurns();
    }
  }

  function loadOlderTurns() {
    if (state.hiddenTurns.length === 0) {
      return;
    }
    state.showAll = false;
    state.expandBy += state.settings.stepTurns;
    applyWindowing();
    updateStatsFromState(true);
  }

  function showLatestOnly() {
    state.showAll = false;
    state.expandBy = 0;
    applyWindowing();
    updateStatsFromState(true);
  }

  function showAllTurns() {
    state.showAll = true;
    applyWindowing();
    updateStatsFromState(true);
  }

  function restoreAllHiddenTurns() {
    if (!state.container || state.hiddenTurns.length === 0) {
      removePlaceholder();
      return;
    }

    const snapshot = captureScroll();
    const insertionPoint = state.visibleTurns[0] || state.placeholder || null;
    for (const node of state.hiddenTurns) {
      state.container.insertBefore(node, insertionPoint);
    }
    state.visibleTurns = state.hiddenTurns.concat(state.visibleTurns);
    state.hiddenTurns = [];
    removePlaceholder();
    restoreScroll(snapshot);
  }

  function resetConversationState(restoreHidden) {
    if (restoreHidden) {
      restoreAllHiddenTurns();
    }
    state.main = null;
    state.container = null;
    state.scrollContainer = null;
    state.visibleTurns = [];
    state.hiddenTurns = [];
    state.expandBy = 0;
    state.showAll = !state.settings.enabled;
    removePlaceholder();
  }

  function captureScroll() {
    const scroller = findScrollContainer(state.container);
    return {
      scroller,
      top: scroller?.scrollTop ?? 0,
      height: scroller?.scrollHeight ?? 0,
    };
  }

  function restoreScroll(snapshot) {
    if (!snapshot?.scroller) {
      return;
    }
    const delta = snapshot.scroller.scrollHeight - snapshot.height;
    snapshot.scroller.scrollTop = snapshot.top + delta;
  }

  function findScrollContainer(startElement) {
    let node = startElement;
    while (node) {
      if (node instanceof HTMLElement) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        if (canScroll && node.scrollHeight > node.clientHeight + 20) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function buildOverlay() {
    if (state.overlayHost) {
      return;
    }

    state.overlayHost = document.createElement('div');
    state.overlayHost.setAttribute(ROOT_ATTR, '1');
    state.overlayHost.style.position = 'fixed';
    state.overlayHost.style.right = '16px';
    state.overlayHost.style.bottom = 'max(96px, calc(env(safe-area-inset-bottom) + 20px))';
    state.overlayHost.style.zIndex = '2147483647';

    state.overlayShadow = state.overlayHost.attachShadow({ mode: 'open' });
    state.overlayShadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        * {
          box-sizing: border-box;
        }
        .wrap {
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          color: #e2e8f0;
        }
        button,
        input {
          font: inherit;
        }
        .dock,
        .panel,
        .actions button,
        .icon-button {
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(15, 23, 42, 0.92);
          color: inherit;
          backdrop-filter: blur(12px);
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
        }
        .dock {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-width: 156px;
          max-width: min(220px, calc(100vw - 32px));
          padding: 10px 12px;
          border-radius: 999px;
          cursor: pointer;
        }
        .dock:hover,
        .actions button:hover,
        .icon-button:hover {
          background: rgba(30, 41, 59, 0.96);
        }
        .dock-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
          text-align: left;
        }
        .dock-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .dock-subtitle {
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dock-badge {
          flex-shrink: 0;
          border-radius: 999px;
          padding: 4px 8px;
          background: rgba(56, 189, 248, 0.16);
          color: #bae6fd;
          font-size: 12px;
          font-weight: 700;
        }
        .panel {
          width: min(300px, calc(100vw - 32px));
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 14px;
        }
        .panel[hidden] {
          display: none;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .header {
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .title {
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .subtitle {
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.45;
        }
        .icon-button {
          appearance: none;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }
        .tune-card {
          border-radius: 12px;
          background: rgba(30, 41, 59, 0.78);
          padding: 10px 12px;
          margin-bottom: 10px;
        }
        .tune-head {
          align-items: flex-start;
          margin-bottom: 8px;
        }
        .tune-label {
          font-size: 11px;
          color: #94a3b8;
          margin-bottom: 4px;
        }
        .tune-note {
          font-size: 11px;
          line-height: 1.45;
          color: #cbd5e1;
          max-width: 190px;
        }
        .tune-value {
          font-size: 20px;
          font-weight: 700;
          white-space: nowrap;
        }
        .range {
          width: 100%;
          margin: 0;
          accent-color: #38bdf8;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 10px;
        }
        .stat {
          border-radius: 10px;
          background: rgba(30, 41, 59, 0.82);
          padding: 8px 10px;
        }
        .stat-label {
          font-size: 10px;
          color: #94a3b8;
          margin-bottom: 2px;
        }
        .stat-value {
          font-size: 14px;
          font-weight: 700;
        }
        .actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .actions button {
          appearance: none;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
        }
        .actions button:disabled,
        .icon-button:disabled {
          opacity: 0.45;
          cursor: default;
        }
      </style>
      <div class="wrap">
        <button class="dock" id="toggle" type="button" aria-expanded="false">
          <span class="dock-copy">
            <span class="dock-title">Slimmer</span>
            <span class="dock-subtitle" id="chipSummary">대화 감지 중</span>
          </span>
          <span class="dock-badge" id="chipTurns">40턴</span>
        </button>
        <div class="panel" id="panel" hidden>
          <div class="row header">
            <div>
              <div class="title">Long Chat Slimmer</div>
              <div class="subtitle" id="panelSummary">필요할 때만 펼쳐서 상태와 액션을 확인할 수 있습니다.</div>
            </div>
            <button class="icon-button" id="close" type="button" aria-label="패널 닫기">×</button>
          </div>
          <div class="tune-card">
            <div class="row tune-head">
              <div>
                <div class="tune-label">유지 턴 수</div>
                <div class="tune-note">이 브라우저 설정으로 바로 반영됩니다.</div>
              </div>
              <div class="tune-value" id="keepValue">40턴</div>
            </div>
            <input class="range" id="keepRange" type="range" min="${KEEP_TURNS_MIN}" max="${KEEP_TURNS_MAX}" step="5" />
          </div>
          <div class="grid">
            <div class="stat">
              <div class="stat-label">전체 턴</div>
              <div class="stat-value" id="total">-</div>
            </div>
            <div class="stat">
              <div class="stat-label">표시 중</div>
              <div class="stat-value" id="rendered">-</div>
            </div>
            <div class="stat">
              <div class="stat-label">숨김</div>
              <div class="stat-value" id="hidden">-</div>
            </div>
            <div class="stat">
              <div class="stat-label">DOM 경량화</div>
              <div class="stat-value" id="reduction">-</div>
            </div>
          </div>
          <div class="actions">
            <button id="older" type="button">이전 20개</button>
            <button id="latest" type="button">최신만</button>
            <button id="all" type="button">전체 보기</button>
          </div>
        </div>
      </div>
    `;

    state.overlayEls = {
      toggle: state.overlayShadow.getElementById('toggle'),
      chipSummary: state.overlayShadow.getElementById('chipSummary'),
      chipTurns: state.overlayShadow.getElementById('chipTurns'),
      panel: state.overlayShadow.getElementById('panel'),
      panelSummary: state.overlayShadow.getElementById('panelSummary'),
      close: state.overlayShadow.getElementById('close'),
      total: state.overlayShadow.getElementById('total'),
      rendered: state.overlayShadow.getElementById('rendered'),
      hidden: state.overlayShadow.getElementById('hidden'),
      reduction: state.overlayShadow.getElementById('reduction'),
      keepRange: state.overlayShadow.getElementById('keepRange'),
      keepValue: state.overlayShadow.getElementById('keepValue'),
      older: state.overlayShadow.getElementById('older'),
      latest: state.overlayShadow.getElementById('latest'),
      all: state.overlayShadow.getElementById('all'),
    };

    state.overlayEls.toggle.addEventListener('click', () => {
      toggleOverlayOpen();
    });
    state.overlayEls.close.addEventListener('click', () => {
      toggleOverlayOpen(false);
    });
    state.overlayEls.keepRange.addEventListener('input', () => {
      state.settings = normalizeSettings({
        ...state.settings,
        keepTurns: state.overlayEls.keepRange.value,
      });
      refreshNow();
      scheduleSettingsPersist();
    });
    state.overlayEls.older.addEventListener('click', loadOlderTurns);
    state.overlayEls.latest.addEventListener('click', showLatestOnly);
    state.overlayEls.all.addEventListener('click', showAllTurns);

    (document.body || document.documentElement).appendChild(state.overlayHost);
    updateOverlayVisibility();
  }

  function toggleOverlayOpen(forceOpen) {
    state.overlayOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.overlayOpen;
    updateOverlayVisibility();
  }

  function updateOverlayVisibility() {
    if (!state.overlayHost) {
      return;
    }

    state.overlayHost.style.display = state.settings.showOverlay ? 'block' : 'none';
    if (state.overlayEls.toggle) {
      state.overlayEls.toggle.setAttribute('aria-expanded', String(state.overlayOpen));
    }
    if (state.overlayEls.panel) {
      state.overlayEls.panel.hidden = !state.overlayOpen;
    }
  }

  function updateStatsFromState(containerFound) {
    updateStats({
      containerFound,
      totalTurns: state.hiddenTurns.length + state.visibleTurns.length,
      renderedTurns: state.visibleTurns.length,
      hiddenTurns: state.hiddenTurns.length,
    });
  }

  function updateStats({ containerFound, totalTurns, renderedTurns, hiddenTurns }) {
    const reduction = renderedTurns > 0 ? `${(totalTurns / renderedTurns).toFixed(1)}x` : '-';
    const mode = !state.settings.enabled
      ? '비활성'
      : !containerFound
      ? '감지 중'
      : state.showAll
      ? '전체'
      : state.expandBy > 0
      ? '확장'
      : '자동';

    state.overlayEls.total.textContent = String(totalTurns ?? '-');
    state.overlayEls.rendered.textContent = String(renderedTurns ?? '-');
    state.overlayEls.hidden.textContent = String(hiddenTurns ?? '-');
    state.overlayEls.reduction.textContent = reduction;
    state.overlayEls.keepRange.value = String(state.settings.keepTurns);
    state.overlayEls.keepValue.textContent = `${state.settings.keepTurns}턴`;
    state.overlayEls.chipTurns.textContent = `${state.settings.keepTurns}턴`;
    state.overlayEls.chipSummary.textContent = !containerFound
      ? '대화 감지 중'
      : state.showAll
      ? '전체 표시 중'
      : hiddenTurns > 0
      ? `${mode} · 숨김 ${hiddenTurns}`
      : `${mode} · 최신 유지`;
    state.overlayEls.panelSummary.textContent = !containerFound
      ? '이 페이지의 대화 턴을 찾는 중입니다.'
      : state.showAll
      ? '현재는 모든 턴을 페이지에 그대로 표시하고 있습니다.'
      : `최근 ${renderedTurns}개 턴만 DOM에 남겨 스크롤과 입력 부담을 줄입니다.`;
    state.overlayEls.older.textContent = `이전 ${state.settings.stepTurns}개`;
    state.overlayEls.older.disabled = !containerFound || hiddenTurns === 0;
    state.overlayEls.latest.disabled = !containerFound || (!state.showAll && state.expandBy === 0);
    state.overlayEls.all.disabled = !containerFound || state.showAll;
    updateOverlayVisibility();
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return getStatus();
    }

    if (message.type === 'GET_STATUS') {
      return getStatus();
    }

    if (message.type === 'SETTINGS_UPDATED') {
      if (message.settings) {
        state.settings = normalizeSettings({ ...state.settings, ...message.settings });
      }
      refreshNow();
      return getStatus();
    }

    if (message.type === 'LOAD_OLDER') {
      loadOlderTurns();
      return getStatus();
    }

    if (message.type === 'SHOW_LATEST') {
      showLatestOnly();
      return getStatus();
    }

    if (message.type === 'SHOW_ALL') {
      showAllTurns();
      return getStatus();
    }

    return getStatus();
  }

  function getStatus() {
    return {
      enabled: state.settings.enabled,
      keepTurns: state.settings.keepTurns,
      stepTurns: state.settings.stepTurns,
      showOverlay: state.settings.showOverlay,
      showAll: state.showAll,
      expanded: state.expandBy > 0,
      containerFound: Boolean(state.container),
      totalTurns: state.hiddenTurns.length + state.visibleTurns.length,
      renderedTurns: state.visibleTurns.length,
      hiddenTurns: state.hiddenTurns.length,
      conversationKey: state.conversationKey,
    };
  }

  async function loadSettings() {
    const local = await chrome.storage.local.get([...Object.keys(DEFAULT_SETTINGS), STORAGE_META_KEY]);
    const hasLocalSettings = Object.keys(DEFAULT_SETTINGS).some((key) => key in local);
    if (hasLocalSettings || local[STORAGE_META_KEY] === STORAGE_META_VALUE) {
      return normalizeSettings(local);
    }

    const sync = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const migrated = normalizeSettings(sync);
    await chrome.storage.local.set({
      ...migrated,
      [STORAGE_META_KEY]: STORAGE_META_VALUE,
    });
    return migrated;
  }

  function scheduleSettingsPersist() {
    window.clearTimeout(state.persistTimer);
    state.persistTimer = window.setTimeout(() => {
      chrome.storage.local
        .set({
          ...state.settings,
          [STORAGE_META_KEY]: STORAGE_META_VALUE,
        })
        .catch((error) => {
          console.warn('[Chat Slimmer] settings persist failed', error);
        });
    }, 160);
  }

  function normalizeSettings(value) {
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
      keepTurns: clampNumber(value.keepTurns, KEEP_TURNS_MIN, KEEP_TURNS_MAX, DEFAULT_SETTINGS.keepTurns),
      stepTurns: clampNumber(value.stepTurns, STEP_TURNS_MIN, STEP_TURNS_MAX, DEFAULT_SETTINGS.stepTurns),
      showOverlay: typeof value.showOverlay === 'boolean' ? value.showOverlay : DEFAULT_SETTINGS.showOverlay,
    };
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  function getConversationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function injectPageStyles() {
    if (document.querySelector(`style[${STYLES_ATTR}]`)) {
      return;
    }

    const style = document.createElement('style');
    style.setAttribute(STYLES_ATTR, '1');
    style.textContent = `
      .chat-slimmer-placeholder {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 14px 0;
        padding: 12px 14px;
        border: 1px dashed rgba(148, 163, 184, 0.5);
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.04);
      }
      .chat-slimmer-placeholder__text {
        font-size: 13px;
        line-height: 1.45;
        color: inherit;
        opacity: 0.88;
      }
      .chat-slimmer-placeholder__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chat-slimmer-placeholder__actions button {
        appearance: none;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 999px;
        padding: 7px 11px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .chat-slimmer-placeholder__actions button:hover {
        background: rgba(148, 163, 184, 0.12);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function arraysEqualByIdentity(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }

  function startsWithByIdentity(full, prefix) {
    if (prefix.length > full.length) {
      return false;
    }
    for (let index = 0; index < prefix.length; index += 1) {
      if (full[index] !== prefix[index]) {
        return false;
      }
    }
    return true;
  }

  function compareDocumentOrder(a, b) {
    if (a === b) {
      return 0;
    }
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    return 1;
  }

  function getDepth(element) {
    let depth = 0;
    let current = element;
    while (current?.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }
})();
