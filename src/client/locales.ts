/**
 * Settings-section copy for the Moonset plugin — data only.
 *
 * One namespace (`settings.moonset`), two complete dictionaries. The key set is
 * exactly what the section renders: a title, one line of description, the
 * three choices, and (M5.3) the status line's phrases. `zh` defines the key
 * union ({@link MoonsetLocaleKey}) and `en` mirrors it — `ctx.locale.register`
 * type-checks that mirror at the call site, so a key added to one dictionary
 * and not the other is a compile error rather than a raw key on screen.
 *
 * The status line (M5.3) composes its four facts from these phrases rather than
 * carrying one pre-baked sentence per combination: the choice's own word is the
 * button's copy (`option.*`, reused so the highlight and the status can never
 * disagree), and `status.*` supplies the three labels plus the `off` line.
 * The separator is punctuation, not copy — it lives in `choice.ts`.
 *
 * The namespace is namespaced like everything else this plugin owns (D3): a
 * peer language pack or theme plugin cannot collide with it by accident.
 */

/** The locale namespace owned by this plugin. */
export const MOONSET_LOCALE_NS = 'settings.moonset'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.title': 'Moonset 主题',
  'section.description': '选择月落配色的浅色或深色；「跟随系统」会套用 Moonset 自己的浅深两层，由系统决定当前用哪一层。选择保存在本插件自己的设置里，重启后自动恢复；未选择时继续使用官方主题。',
  'option.light': '浅色',
  'option.dark': '深色',
  'option.follow': '跟随系统',
  // ── M5.3 status line ─────────────────────────────────────────────────────
  'status.off': '未选择（官方主题）',
  'status.official': '官方偏好',
  'status.scheme.light': '当前方案 浅色',
  'status.scheme.dark': '当前方案 深色',
  'status.layer.on': '覆盖层 已挂载',
  'status.layer.off': '覆盖层 未挂载',
  // ── M2: 地面范围 / 光晕开关 / 强度 ──────────────────────────────────────
  'glow.title': '环境光晕',
  'glow.on': '开',
  'glow.off': '关',
  'glow.scope.title': '地面范围',
  'glow.scope.conversation': '会话区',
  'glow.scope.main': '主区',
  'glow.scope.all': '全透',
  'glow.strength': '强度',
  'glow.light.title': '浅色光晕',
  'glow.dark.title': '深色光晕',
  'glow.hue.accent': '强调',
  'glow.hue.soft': '柔和',
  'glow.hue.night': '夜空蓝',
  'glow.hint': '会话区：只透会话列；主区：再透外壳与三列（侧栏仍有自己的面）；全透：连侧栏与底部一起透。浅色与深色各自一套色相与强度；强度 0 等于只剩底色；琥珀只出现在浅色，不随色相变。',
} as const

/** English dictionary — every `zh` key, no extras (checked at registration). */
export const en = {
  'section.title': 'Moonset theme',
  'section.description': 'Pick the Moonset light or dark palette. "Follow system" stacks Moonset\'s own light and dark halves and lets the OS decide which one is live. The choice is stored in this plugin\'s own settings and restored on restart; until you pick one, the official theme stays in charge.',
  'option.light': 'Light',
  'option.dark': 'Dark',
  'option.follow': 'Follow system',
  // ── M5.3 status line ─────────────────────────────────────────────────────
  'status.off': 'No choice (official theme)',
  'status.official': 'Official preference',
  'status.scheme.light': 'Scheme light',
  'status.scheme.dark': 'Scheme dark',
  'status.layer.on': 'Layer attached',
  'status.layer.off': 'Layer detached',
  // ── M2: ground scope / glow switch / strength ─────────────────────────────
  'glow.title': 'Environment glow',
  'glow.on': 'On',
  'glow.off': 'Off',
  'glow.scope.title': 'Ground scope',
  'glow.scope.conversation': 'Conversation',
  'glow.scope.main': 'Main',
  'glow.scope.all': 'All',
  'glow.strength': 'Strength',
  'glow.light.title': 'Light ground',
  'glow.dark.title': 'Dark ground',
  'glow.hue.accent': 'Accent',
  'glow.hue.soft': 'Soft',
  'glow.hue.night': 'Night blue',
  'glow.hint': 'Conversation keeps the glow to the conversation column; Main lets the shell and the three columns through (the sidebar keeps its own surface); All is fully transparent, sidebar and bottom included. Light and dark grounds each have their own hue and strength; strength 0 leaves only the base colour, and the amber glint belongs to the light scheme only.',
} as const

/** Every key the section renders (the namespace's dictionary union). */
export type MoonsetLocaleKey = keyof typeof zh
