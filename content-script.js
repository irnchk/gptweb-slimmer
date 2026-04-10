(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    keepTurns: 40,
    stepTurns: 20,
    showOverlay: true,
    language: 'auto',
    overlayPosition: null,
  };

  const STORAGE_META_KEY = 'settingsStorageMode';
  const STORAGE_META_VALUE = 'local-v1';
  const KEEP_TURNS_MIN = 2;
  const KEEP_TURNS_MAX = 200;
  const STEP_TURNS_MIN = 2;
  const STEP_TURNS_MAX = 200;
  const TURN_STEP = 2;
  const OVERLAY_MARGIN = 12;
  const DRAG_THRESHOLD = 4;
  const { createTranslator, normalizeLanguage } = globalThis.ChatSlimmerI18n;

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
    observerPauseDepth: 0,
    scheduled: false,
    disposed: false,
    persistTimer: 0,
    expandBy: 0,
    showAll: false,
    overlayOpen: false,
    overlayDrag: null,
    suppressNextToggleClick: false,
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
    window.addEventListener('resize', handleViewportResize, true);
    window.addEventListener('pointermove', handleOverlayPointerMove, true);
    window.addEventListener('pointerup', finishOverlayDrag, true);
    window.addEventListener('pointercancel', finishOverlayDrag, true);
  }

  function bindObservers() {
    state.observer = new MutationObserver(() => {
      if (state.observerPauseDepth > 0) {
        return;
      }
      scheduleRefresh();
    });

    observeDocument();
  }

  function observeDocument() {
    if (!state.observer || state.disposed) {
      return;
    }

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function withObserverPaused(work) {
    if (!state.observer) {
      return work();
    }

    const shouldReconnect = state.observerPauseDepth === 0;
    state.observerPauseDepth += 1;
    if (shouldReconnect) {
      state.observer.disconnect();
    }

    try {
      return work();
    } finally {
      state.observerPauseDepth -= 1;
      if (shouldReconnect && state.observerPauseDepth === 0) {
        observeDocument();
      }
    }
  }

  function handlePossibleNavigation() {
    scheduleRefresh();
  }

  function handleViewportResize() {
    applyOverlayPosition(false);
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

    const seededTurns = bestChildren
      .filter((element) => element.parentElement === bestParent)
      .sort(compareDocumentOrder);

    if (seededTurns.length < 2) {
      return null;
    }

    const turns = collectTurnChildren(bestParent, seededTurns);
    if (turns.length < 2) {
      return null;
    }

    return {
      main,
      container: bestParent,
      turns,
    };
  }

  function collectTurnChildren(parent, seededTurns) {
    const directChildren = Array.from(parent.children);
    const seededIndices = seededTurns
      .map((element) => directChildren.indexOf(element))
      .filter((index) => index >= 0);

    if (seededIndices.length === 0) {
      return seededTurns;
    }

    let start = Math.min(...seededIndices);
    let end = Math.max(...seededIndices);

    while (start > 0 && isUsefulTurnWrapper(directChildren[start - 1])) {
      start -= 1;
    }
    while (end + 1 < directChildren.length && isUsefulTurnWrapper(directChildren[end + 1])) {
      end += 1;
    }

    const expandedTurns = directChildren.slice(start, end + 1).filter((element) => isUsefulTurnWrapper(element));
    return expandedTurns.length >= seededTurns.length ? expandedTurns : seededTurns;
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

  function getTurnRole(element) {
    if (!element) {
      return '';
    }

    const roleNode = element.matches('[data-message-author-role]')
      ? element
      : element.querySelector('[data-message-author-role]');
    return String(roleNode?.getAttribute('data-message-author-role') || '').trim().toLowerCase();
  }

  function alignHiddenCountToUserBoundary(turns, hiddenCount) {
    if (hiddenCount <= 0 || hiddenCount >= turns.length) {
      return hiddenCount;
    }

    if (getTurnRole(turns[hiddenCount]) === 'user') {
      return hiddenCount;
    }

    for (let index = hiddenCount - 1; index >= 0; index -= 1) {
      if (getTurnRole(turns[index]) === 'user') {
        return index;
      }
    }

    for (let index = hiddenCount + 1; index < turns.length; index += 1) {
      if (getTurnRole(turns[index]) === 'user') {
        return index;
      }
    }

    return hiddenCount;
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

    const allTurns = state.hiddenTurns.concat(state.visibleTurns);
    const totalTurns = allTurns.length;
    const targetVisible = state.showAll
      ? totalTurns
      : Math.min(totalTurns, Math.max(KEEP_TURNS_MIN, state.settings.keepTurns + state.expandBy));
    const targetHidden = alignHiddenCountToUserBoundary(allTurns, Math.max(0, totalTurns - targetVisible));

    withObserverPaused(() => {
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
    });
  }

  function ensurePlaceholder() {
    if (!state.container || state.hiddenTurns.length === 0) {
      removePlaceholder();
      return;
    }

    withObserverPaused(() => {
      if (!state.placeholder) {
        state.placeholder = document.createElement('div');
        state.placeholder.setAttribute(PLACEHOLDER_ATTR, '1');
        state.placeholder.className = 'chat-slimmer-placeholder';
        state.placeholder.addEventListener('click', onPlaceholderClick);
      }

      const firstVisible = state.visibleTurns[0] || null;
      if (state.placeholder.parentElement !== state.container) {
        if (firstVisible) {
          state.container.insertBefore(state.placeholder, firstVisible);
        } else {
          state.container.appendChild(state.placeholder);
        }
      } else if (firstVisible && state.placeholder.nextSibling !== firstVisible) {
        state.container.insertBefore(state.placeholder, firstVisible);
      } else if (!firstVisible && state.container.lastChild !== state.placeholder) {
        state.container.appendChild(state.placeholder);
      }

      const hidden = state.hiddenTurns.length;
      const rendered = state.visibleTurns.length;
      const total = hidden + rendered;
      const reduction = rendered > 0 ? (total / rendered).toFixed(1) : '1.0';
      const t = getTranslator();
      state.placeholder.innerHTML = `
        <div class="chat-slimmer-placeholder__text"></div>
        <div class="chat-slimmer-placeholder__actions">
          <button type="button" data-action="older">${t.t('action_load_older_count', { count: state.settings.stepTurns })}</button>
          <button type="button" data-action="latest">${t.t('action_show_latest')}</button>
          <button type="button" data-action="all">${t.t('action_show_all')}</button>
        </div>
      `;
      state.placeholder.querySelector('.chat-slimmer-placeholder__text').textContent = t.t('placeholder_text', {
        hidden,
        reduction,
      });
    });
  }

  function removePlaceholder() {
    withObserverPaused(() => {
      if (state.placeholder?.isConnected) {
        state.placeholder.remove();
      }
    });
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

    withObserverPaused(() => {
      const snapshot = captureScroll();
      const insertionPoint = state.visibleTurns[0] || state.placeholder || null;
      for (const node of state.hiddenTurns) {
        state.container.insertBefore(node, insertionPoint);
      }
      state.visibleTurns = state.hiddenTurns.concat(state.visibleTurns);
      state.hiddenTurns = [];
      removePlaceholder();
      restoreScroll(snapshot);
    });
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

    const t = getTranslator();
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
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
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
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        :host([data-dragging="1"]) .dock,
        :host([data-dragging="1"]) .header {
          cursor: grabbing;
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
        .panel-select {
          width: 100%;
          appearance: none;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(30, 41, 59, 0.92);
          color: inherit;
          padding: 8px 10px;
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
            <span class="dock-subtitle" id="chipSummary">${t.t('dock_summary_detecting')}</span>
          </span>
          <span class="dock-badge" id="chipTurns">${formatTurnCount(state.settings.keepTurns)}</span>
        </button>
        <div class="panel" id="panel" hidden>
          <div class="row header" id="header">
            <div>
              <div class="title">Long Chat Slimmer</div>
              <div class="subtitle" id="panelSummary">${t.t('overlay_panel_note')}</div>
            </div>
            <button class="icon-button" id="close" type="button" aria-label="${t.t('overlay_close_aria')}">×</button>
          </div>
          <div class="tune-card">
            <div class="row tune-head">
              <div>
                <div class="tune-label" id="languageLabel">${t.t('setting_language')}</div>
                <div class="tune-note" id="languageNote">${t.t('setting_language_hint')}</div>
              </div>
            </div>
            <select class="panel-select" id="languageSelect" aria-label="${t.t('setting_language')}">
              <option value="auto">${t.t('language_auto')}</option>
              <option value="ko">${t.t('language_ko')}</option>
              <option value="en">${t.t('language_en')}</option>
            </select>
          </div>
          <div class="tune-card">
            <div class="row tune-head">
              <div>
                <div class="tune-label" id="keepLabel">${t.t('overlay_tune_label')}</div>
                <div class="tune-note" id="keepNote">${t.t('overlay_tune_note')}</div>
              </div>
              <div class="tune-value" id="keepValue">${formatTurnCount(state.settings.keepTurns)}</div>
            </div>
            <input class="range" id="keepRange" type="range" min="${KEEP_TURNS_MIN}" max="${KEEP_TURNS_MAX}" step="${TURN_STEP}" aria-label="${t.t('overlay_tune_label')}" />
          </div>
          <div class="grid">
            <div class="stat">
              <div class="stat-label" id="totalLabel">${t.t('stat_total_turns')}</div>
              <div class="stat-value" id="total">-</div>
            </div>
            <div class="stat">
              <div class="stat-label" id="renderedLabel">${t.t('stat_rendered_turns')}</div>
              <div class="stat-value" id="rendered">-</div>
            </div>
            <div class="stat">
              <div class="stat-label" id="hiddenLabel">${t.t('stat_hidden_turns')}</div>
              <div class="stat-value" id="hidden">-</div>
            </div>
            <div class="stat">
              <div class="stat-label" id="reductionLabel">${t.t('stat_reduction')}</div>
              <div class="stat-value" id="reduction">-</div>
            </div>
          </div>
          <div class="actions">
            <button id="older" type="button">${t.t('action_load_older_count', { count: state.settings.stepTurns })}</button>
            <button id="latest" type="button">${t.t('action_show_latest')}</button>
            <button id="all" type="button">${t.t('action_show_all')}</button>
          </div>
        </div>
      </div>
    `;

    state.overlayEls = {
      toggle: state.overlayShadow.getElementById('toggle'),
      chipSummary: state.overlayShadow.getElementById('chipSummary'),
      chipTurns: state.overlayShadow.getElementById('chipTurns'),
      panel: state.overlayShadow.getElementById('panel'),
      header: state.overlayShadow.getElementById('header'),
      panelSummary: state.overlayShadow.getElementById('panelSummary'),
      close: state.overlayShadow.getElementById('close'),
      languageLabel: state.overlayShadow.getElementById('languageLabel'),
      languageNote: state.overlayShadow.getElementById('languageNote'),
      languageSelect: state.overlayShadow.getElementById('languageSelect'),
      keepLabel: state.overlayShadow.getElementById('keepLabel'),
      keepNote: state.overlayShadow.getElementById('keepNote'),
      totalLabel: state.overlayShadow.getElementById('totalLabel'),
      renderedLabel: state.overlayShadow.getElementById('renderedLabel'),
      hiddenLabel: state.overlayShadow.getElementById('hiddenLabel'),
      reductionLabel: state.overlayShadow.getElementById('reductionLabel'),
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

    state.overlayEls.toggle.addEventListener('pointerdown', startOverlayDrag);
    state.overlayEls.header.addEventListener('pointerdown', startOverlayDrag);
    state.overlayEls.toggle.addEventListener('click', (event) => {
      if (state.suppressNextToggleClick) {
        state.suppressNextToggleClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      toggleOverlayOpen();
    });
    state.overlayEls.close.addEventListener('click', () => {
      toggleOverlayOpen(false);
    });
    state.overlayEls.languageSelect.addEventListener('change', () => {
      state.settings = normalizeSettings({
        ...state.settings,
        language: state.overlayEls.languageSelect.value,
      });
      ensurePlaceholder();
      updateStatsFromState(Boolean(state.container));
      scheduleSettingsPersist();
      window.setTimeout(() => {
        state.overlayEls.languageSelect.blur();
      }, 0);
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
    applyOverlayPosition(false);
    updateOverlayVisibility();
  }

  function startOverlayDrag(event) {
    if (!state.overlayHost || event.button !== 0) {
      return;
    }

    if (event.currentTarget === state.overlayEls.header && event.target.closest('button, input, select, textarea, a')) {
      return;
    }

    const rect = state.overlayHost.getBoundingClientRect();
    state.overlayDrag = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      dragging: false,
      fromToggle: event.currentTarget === state.overlayEls.toggle,
      sourceEl: event.currentTarget,
    };

    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture can fail in some browser edge cases; dragging still works with window listeners.
      }
    }
  }

  function handleOverlayPointerMove(event) {
    if (!state.overlayDrag || event.pointerId !== state.overlayDrag.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.overlayDrag.startPointerX;
    const deltaY = event.clientY - state.overlayDrag.startPointerY;
    if (!state.overlayDrag.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
      return;
    }

    state.overlayDrag.dragging = true;
    state.overlayHost.setAttribute('data-dragging', '1');
    applyOverlayPosition(false, {
      left: state.overlayDrag.startLeft + deltaX,
      top: state.overlayDrag.startTop + deltaY,
    });
    event.preventDefault();
  }

  function finishOverlayDrag(event) {
    if (!state.overlayDrag || event.pointerId !== state.overlayDrag.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.overlayDrag.startPointerX;
    const deltaY = event.clientY - state.overlayDrag.startPointerY;

    if (state.overlayDrag.dragging) {
      state.settings = normalizeSettings({
        ...state.settings,
        overlayPosition: clampOverlayPosition({
          left: state.overlayDrag.startLeft + deltaX,
          top: state.overlayDrag.startTop + deltaY,
        }),
      });
      applyOverlayPosition(false);
      scheduleSettingsPersist();
      if (state.overlayDrag.fromToggle) {
        state.suppressNextToggleClick = true;
      }
    }

    if (state.overlayDrag.sourceEl && typeof state.overlayDrag.sourceEl.releasePointerCapture === 'function') {
      try {
        state.overlayDrag.sourceEl.releasePointerCapture(state.overlayDrag.pointerId);
      } catch (_error) {
        // Safe to ignore when the pointer is already released.
      }
    }

    state.overlayHost.removeAttribute('data-dragging');
    state.overlayDrag = null;
  }

  function applyOverlayPosition(shouldPersist, draftPosition = state.settings.overlayPosition) {
    if (!state.overlayHost) {
      return;
    }

    const normalized = normalizeOverlayPosition(draftPosition);
    if (!normalized) {
      state.overlayHost.style.left = '';
      state.overlayHost.style.top = '';
      state.overlayHost.style.right = '16px';
      state.overlayHost.style.bottom = 'max(96px, calc(env(safe-area-inset-bottom) + 20px))';
      return;
    }

    const clamped = clampOverlayPosition(normalized);
    state.overlayHost.style.left = `${clamped.left}px`;
    state.overlayHost.style.top = `${clamped.top}px`;
    state.overlayHost.style.right = 'auto';
    state.overlayHost.style.bottom = 'auto';

    if (shouldPersist) {
      state.settings = normalizeSettings({
        ...state.settings,
        overlayPosition: clamped,
      });
      scheduleSettingsPersist();
    }
  }

  function clampOverlayPosition(position) {
    const normalized = normalizeOverlayPosition(position);
    if (!normalized) {
      return null;
    }

    const rect = state.overlayHost?.getBoundingClientRect();
    const width = rect?.width || (state.overlayOpen ? 300 : 220);
    const height = rect?.height || (state.overlayOpen ? 360 : 52);
    const maxLeft = Math.max(OVERLAY_MARGIN, window.innerWidth - width - OVERLAY_MARGIN);
    const maxTop = Math.max(OVERLAY_MARGIN, window.innerHeight - height - OVERLAY_MARGIN);

    return {
      left: Math.round(Math.min(maxLeft, Math.max(OVERLAY_MARGIN, normalized.left))),
      top: Math.round(Math.min(maxTop, Math.max(OVERLAY_MARGIN, normalized.top))),
    };
  }

  function normalizeOverlayPosition(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return {
      left: Math.round(left),
      top: Math.round(top),
    };
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
    applyOverlayPosition(false);
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
    const t = getTranslator();
    const reduction = renderedTurns > 0 ? `${(totalTurns / renderedTurns).toFixed(1)}x` : '-';
    const mode = t.t(`mode_${getModeKey(containerFound)}`);

    withObserverPaused(() => {
      state.overlayEls.close.setAttribute('aria-label', t.t('overlay_close_aria'));
      state.overlayEls.languageLabel.textContent = t.t('setting_language');
      state.overlayEls.languageNote.textContent = t.t('setting_language_hint');
      state.overlayEls.languageSelect.setAttribute('aria-label', t.t('setting_language'));
      state.overlayEls.languageSelect.value = state.settings.language;
      state.overlayEls.languageSelect.options[0].textContent = t.t('language_auto');
      state.overlayEls.languageSelect.options[1].textContent = t.t('language_ko');
      state.overlayEls.languageSelect.options[2].textContent = t.t('language_en');
      state.overlayEls.keepLabel.textContent = t.t('overlay_tune_label');
      state.overlayEls.keepNote.textContent = t.t('overlay_tune_note');
      state.overlayEls.totalLabel.textContent = t.t('stat_total_turns');
      state.overlayEls.renderedLabel.textContent = t.t('stat_rendered_turns');
      state.overlayEls.hiddenLabel.textContent = t.t('stat_hidden_turns');
      state.overlayEls.reductionLabel.textContent = t.t('stat_reduction');
      state.overlayEls.total.textContent = String(totalTurns ?? '-');
      state.overlayEls.rendered.textContent = String(renderedTurns ?? '-');
      state.overlayEls.hidden.textContent = String(hiddenTurns ?? '-');
      state.overlayEls.reduction.textContent = reduction;
      state.overlayEls.keepRange.value = String(state.settings.keepTurns);
      state.overlayEls.keepRange.setAttribute('aria-label', t.t('overlay_tune_label'));
      state.overlayEls.keepValue.textContent = formatTurnCount(state.settings.keepTurns);
      state.overlayEls.chipTurns.textContent = formatTurnCount(state.settings.keepTurns);
      state.overlayEls.chipSummary.textContent = !containerFound
        ? t.t('dock_summary_detecting')
        : state.showAll
        ? t.t('dock_summary_show_all')
        : hiddenTurns > 0
        ? t.t('dock_summary_hidden', { mode, hidden: hiddenTurns })
        : t.t('dock_summary_latest', { mode });
      state.overlayEls.panelSummary.textContent = t.t('overlay_panel_note');
      state.overlayEls.older.textContent = t.t('action_load_older_count', { count: state.settings.stepTurns });
      state.overlayEls.latest.textContent = t.t('action_show_latest');
      state.overlayEls.all.textContent = t.t('action_show_all');
      state.overlayEls.older.disabled = !containerFound || hiddenTurns === 0;
      state.overlayEls.latest.disabled = !containerFound || (!state.showAll && state.expandBy === 0);
      state.overlayEls.all.disabled = !containerFound || state.showAll;
    });
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
      language: state.settings.language,
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
      language: normalizeLanguage(value.language),
      overlayPosition: normalizeOverlayPosition(value.overlayPosition),
    };
  }

  function getTranslator() {
    return createTranslator(state.settings.language);
  }

  function formatTurnCount(count) {
    return getTranslator().t('turn_count', { count });
  }

  function getModeKey(containerFound) {
    if (!state.settings.enabled) {
      return 'disabled';
    }
    if (!containerFound) {
      return 'detecting';
    }
    if (state.showAll) {
      return 'show_all';
    }
    if (state.expandBy > 0) {
      return 'expanded';
    }
    return 'auto';
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamped = Math.min(max, Math.max(min, numeric));
    const snapped = min + Math.round((clamped - min) / TURN_STEP) * TURN_STEP;
    return Math.min(max, Math.max(min, snapped));
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
