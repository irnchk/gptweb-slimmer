globalThis.ChatSlimmerI18n = (() => {
  const FALLBACK_LANGUAGE = 'en';
  const SUPPORTED_LANGUAGES = ['auto', 'ko', 'en'];

  const STRINGS = {
    en: {
      popup_subtitle: 'Reduces lag in long ChatGPT chats by unmounting older turns from the DOM.',
      setting_enabled: 'Enabled',
      setting_keep_turns: 'Turns to Keep',
      setting_keep_turns_hint: 'Saved only in this browser and applied to the current tab immediately.',
      setting_step_turns: 'Load Older Batch Size',
      setting_step_turns_hint: 'How many older turns to restore at once.',
      setting_language: 'Language',
      setting_language_hint: 'Updates the popup and on-page controls immediately.',
      setting_show_overlay: 'Show the bottom-right page dock',
      language_auto: 'Auto (Browser)',
      language_ko: 'Korean',
      language_en: 'English',
      stats_current_tab: 'Current Tab Status',
      action_refresh: 'Refresh',
      stat_mode: 'Mode',
      stat_total_turns: 'Total Turns',
      stat_rendered_turns: 'Visible',
      stat_hidden_turns: 'Hidden',
      stat_reduction: 'DOM Reduction',
      action_load_older: 'Load Older',
      action_load_older_count: 'Load {count} Older',
      action_show_latest: 'Latest Only',
      action_show_all: 'Show All',
      status_waiting: 'Waiting',
      status_detecting: 'Detecting',
      status_initializing_error: 'An error occurred during initialization.',
      status_chatgpt_only: 'Works only on ChatGPT conversation tabs.',
      status_not_detected_yet: 'No conversation content has been detected in this tab yet. Try refreshing the page once.',
      status_load_failed: 'Unable to load status information.',
      status_hint_connected: 'This browser keeps the latest {keepTurns} and restores {stepTurns} at a time when needed.',
      status_hint_not_found: 'No chat turns have been found on this page yet.',
      mode_disabled: 'Disabled',
      mode_detecting: 'Detecting',
      mode_show_all: 'Showing All',
      mode_expanded: 'Expanded',
      mode_auto: 'Auto Slimming',
      placeholder_text: 'Keeping the DOM about {reduction}x lighter by hiding {hidden} older turns.',
      dock_summary_detecting: 'Detecting chat',
      dock_summary_show_all: 'Showing all turns',
      dock_summary_hidden: '{mode} · {hidden} hidden',
      dock_summary_latest: '{mode} · latest only',
      panel_summary_idle: 'Looking for conversation turns on this page.',
      panel_summary_show_all: 'All turns are currently shown in the page.',
      panel_summary_windowed: 'Keeping only the latest {rendered} turns mounted to reduce scrolling and input lag.',
      overlay_panel_note: 'Expand only when you need status and quick controls.',
      overlay_close_aria: 'Close panel',
      overlay_tune_label: 'Turns to Keep',
      overlay_tune_note: 'Applies immediately in this browser.',
      turn_count: '{count} turns',
    },
    ko: {
      popup_subtitle: '긴 ChatGPT 대화에서 오래된 턴을 DOM에서 내려 렉을 줄입니다.',
      setting_enabled: '활성화',
      setting_keep_turns: '항상 화면에 남길 턴 수',
      setting_keep_turns_hint: '이 브라우저에만 저장되고 현재 탭에 바로 반영됩니다.',
      setting_step_turns: '"이전 더 보기" 배치 크기',
      setting_step_turns_hint: '오래된 턴을 다시 펼칠 때 한 번에 늘어나는 개수입니다.',
      setting_language: '언어',
      setting_language_hint: '팝업과 페이지 안 조작 UI에 바로 적용됩니다.',
      setting_show_overlay: '페이지 오른쪽 아래 상태 패널 표시',
      language_auto: '자동 (브라우저)',
      language_ko: '한국어',
      language_en: 'English',
      stats_current_tab: '현재 탭 상태',
      action_refresh: '새로고침',
      stat_mode: '상태',
      stat_total_turns: '전체 턴',
      stat_rendered_turns: '표시 중',
      stat_hidden_turns: '숨김',
      stat_reduction: 'DOM 경량화',
      action_load_older: '이전 더 보기',
      action_load_older_count: '이전 {count}개',
      action_show_latest: '최신만 보기',
      action_show_all: '전체 보기',
      status_waiting: '대기 중',
      status_detecting: '감지 중',
      status_initializing_error: '초기화 중 오류가 발생했습니다.',
      status_chatgpt_only: 'ChatGPT 대화 탭에서만 동작합니다.',
      status_not_detected_yet: '이 탭에서 아직 내용을 감지하지 못했습니다. 페이지를 한 번 새로고침해 보세요.',
      status_load_failed: '상태 정보를 불러오지 못했습니다.',
      status_hint_connected: '이 브라우저에서는 최근 {keepTurns} 유지, 필요할 때 {stepTurns}씩 더 펼치도록 설정했습니다.',
      status_hint_not_found: '이 페이지에서는 아직 채팅 턴을 찾지 못했습니다.',
      mode_disabled: '비활성화',
      mode_detecting: '감지 중',
      mode_show_all: '전체 표시',
      mode_expanded: '확장 표시',
      mode_auto: '자동 경량화',
      placeholder_text: '오래된 {hidden}개 턴을 숨겨 DOM을 약 {reduction}x 가볍게 유지 중',
      dock_summary_detecting: '대화 감지 중',
      dock_summary_show_all: '전체 표시 중',
      dock_summary_hidden: '{mode} · 숨김 {hidden}',
      dock_summary_latest: '{mode} · 최신 유지',
      panel_summary_idle: '이 페이지의 대화 턴을 찾는 중입니다.',
      panel_summary_show_all: '현재는 모든 턴을 페이지에 그대로 표시하고 있습니다.',
      panel_summary_windowed: '최근 {rendered}개 턴만 DOM에 남겨 스크롤과 입력 부담을 줄입니다.',
      overlay_panel_note: '필요할 때만 펼쳐서 상태와 빠른 조작을 확인하세요.',
      overlay_close_aria: '패널 닫기',
      overlay_tune_label: '유지 턴 수',
      overlay_tune_note: '이 브라우저 설정으로 바로 반영됩니다.',
      turn_count: '{count}턴',
    },
  };

  function normalizeLanguage(value) {
    const normalized = typeof value === 'string' ? value.toLowerCase() : 'auto';
    return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : 'auto';
  }

  function detectLanguage() {
    const locale = String(globalThis.navigator?.language || '').toLowerCase();
    if (locale.startsWith('ko')) {
      return 'ko';
    }
    return FALLBACK_LANGUAGE;
  }

  function resolveLanguage(setting) {
    const normalized = normalizeLanguage(setting);
    return normalized === 'auto' ? detectLanguage() : normalized;
  }

  function format(template, params) {
    return template.replace(/\{(\w+)\}/g, (_match, key) => {
      if (params && key in params) {
        return String(params[key]);
      }
      return `{${key}}`;
    });
  }

  function createTranslator(setting) {
    const resolved = resolveLanguage(setting);
    const messages = STRINGS[resolved] || STRINGS[FALLBACK_LANGUAGE];
    return {
      setting: normalizeLanguage(setting),
      resolved,
      t(key, params = {}) {
        const template = messages[key] || STRINGS[FALLBACK_LANGUAGE][key] || key;
        return format(template, params);
      },
    };
  }

  return {
    SUPPORTED_LANGUAGES,
    normalizeLanguage,
    resolveLanguage,
    createTranslator,
  };
})();
