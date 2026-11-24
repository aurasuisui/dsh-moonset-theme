/*!
 * 0.1.5 M1 真机探针（G1 banner 贴合 / G2 卡片配色 / G3 上下文行 / G4 浅色失败色）
 *
 * 用法：在 DSH 桌面壳的 DevTools console 里**整段粘贴**，回车。约 2 秒后打印一份 JSON。
 *
 * 它做三件事：读样式、把会话列滚到「banner 该粘住」的位置采样一次再还原、
 * 读几个面的计算色并算对比度。**不写设置、不改 DOM、不装监听**；唯一的副作用是
 * 一次滚动（采样后 restore 回原位）。
 *
 * 判据（与 docs/architecture.md §11.8 对齐）：
 *   G1  gap = banner.getBoundingClientRect().top - header.getBoundingClientRect().bottom
 *       目标 |gap| <= 2px；0.1.4 的旧写法会量到 空气 + H（H=76、空气=12 → 88px）。
 *   G2  卡片（[data-changed-files]）的 background-color 应为 --dsw-alias-bg-layer-2，
 *       border-color 应为 --dsw-alias-border-l2，--changes-fill 同层。
 *   G3  [data-disclosure-row]:has([data-context-source]) 这条行的 color 应等于
 *       步进行同名色（--dsh-moonset-step-name 的兜底 = --dsw-static-deepseek-500），
 *       且 .source/.summary 仍是 label-tertiary（正文与旁注不受影响）。
 *   G4  失败的步骤行（[data-variant][data-state='error']）在浅色下的颜色应为
 *       #821934（70% red-600 + 30% label-primary），画布上 >= 4.5:1。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { now: new Date().toISOString(), ok: false, notes: [] };
  const html = document.documentElement;
  const css = (el) => (el === null ? null : getComputedStyle(el));
  const rect = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top * 100) / 100, bottom: Math.round(r.bottom * 100) / 100, height: Math.round(r.height * 100) / 100 };
  };
  // sRGB 相对亮度 → 对比度（WCAG 2.1）
  const parse = (value) => {
    const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(String(value));
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const lum = (rgb) => rgb.map((v) => v / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const la = lum(a); const lb = lum(b);
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
  };

  out.state = {
    skinAttr: html.getAttribute('data-moonset-skin'),
    glassAttr: html.getAttribute('data-moonset-glass'),
    headerHeightVar: getComputedStyle(html).getPropertyValue('--dsh-moonset-header-h').trim() || '(unset → 76px fallback)',
    darkTheme: document.body.hasAttribute('data-ds-dark-theme'),
    scopeProbe: (() => {
      const s = document.querySelector('[data-conversation-scroll]');
      if (s === null) return null;
      const cs = getComputedStyle(s);
      return { marginTop: cs.marginTop, paddingTop: cs.paddingTop, position: cs.position, zIndex: cs.zIndex };
    })(),
  };

  // ── G1：把会话列滚到 banner 该粘住的位置，量 banner 顶 vs header 底 ──────
  const scroller = document.querySelector('[data-conversation-scroll]');
  const header = document.querySelector("#root [data-slot='conversation.header'] > header");
  if (scroller === null || header === null) {
    out.notes.push('找不到 [data-conversation-scroll] 或会话 header——请在一条有代码块的会话里跑');
  } else {
    const wraps = [...scroller.querySelectorAll(':has(> [data-code-block-banner])')]
      .filter((el) => el.querySelectorAll('pre').length > 0);
    const wrap = wraps.find((el) => el.getBoundingClientRect().height + el.parentElement.getBoundingClientRect().height > 200) ?? wraps[0] ?? null;
    if (wrap === null) {
      out.notes.push('这一屏没有 code block banner：G1 需要一条含代码块的会话');
    } else {
      const saved = scroller.scrollTop;
      // banner 只有在「它的代码块已经滚过 scrollport 顶」时才粘住：滚到代码块顶再往下 240px。
      const blockTop = wrap.parentElement.offsetTop - scroller.querySelector('.scroll, [data-slot]')?.offsetTop;
      scroller.scrollTop = Math.max(0, (Number.isFinite(blockTop) ? blockTop : scroller.scrollTop + 400) + 240);
      await sleep(120);
      const hb = header.getBoundingClientRect();
      const bb = wrap.getBoundingClientRect();
      const wcs = getComputedStyle(wrap);
      out.g1 = {
        headerBottom: Math.round(hb.bottom * 100) / 100,
        headerHeight: Math.round(hb.height * 100) / 100,
        bannerTop: Math.round(bb.top * 100) / 100,
        gapPx: Math.round((bb.top - hb.bottom) * 100) / 100,
        computedTop: wcs.top,
        scrollTop: scroller.scrollTop,
        verdict: Math.abs(bb.top - hb.bottom) <= 2
          ? 'PASS（banner 顶 ≈ header 底）'
          : 'FAIL：期望 gap ≈ 0；若 ≈ 空气 + H（76+12=88）说明表还是 0.1.4 的 top: H',
      };
      scroller.scrollTop = saved;
      await sleep(60);
    }
  }

  // ── G2：回合改动卡的底 / 边 / header 填充 ────────────────────────────────
  const card = document.querySelector('[data-changed-files]');
  if (card === null) {
    out.notes.push('这一屏没有 [data-changed-files]（回合改动卡）：G2 需要在有编辑动作的回合后看');
  } else {
    const cs = getComputedStyle(card);
    out.g2 = {
      backgroundColor: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      changesFillVar: cs.getPropertyValue('--changes-fill').trim(),
      layered: cs.getPropertyValue('--dsw-alias-bg-layer-2').trim() || '(not read: use the token table)',
      single: card.getAttribute('data-single'),
    };
  }

  // ── G3：上下文注入行（行色 vs 两格旁注色）────────────────────────────────
  const contextRow = document.querySelector("[data-disclosure-row]:has([data-context-source])");
  if (contextRow === null) {
    out.notes.push('这一屏没有 [data-context-source] 行：G3 需要在出现「上下文注入」的会话里看');
  } else {
    const title = contextRow.querySelector(':scope > span');
    out.g3 = {
      rowColor: getComputedStyle(contextRow).color,
      titleColor: title === null ? null : getComputedStyle(title).color,
      inheritedByTitle: title === null ? null : getComputedStyle(title).color === getComputedStyle(contextRow).color,
      sourceColor: (() => { const el = contextRow.querySelector('[data-context-source]'); return el === null ? null : getComputedStyle(el).color })(),
      summaryColor: (() => { const el = contextRow.querySelector('[data-context-summary]'); return el === null ? null : getComputedStyle(el).color })(),
      bodyPresent: contextRow.closest('[data-disclosure-header]')?.parentElement?.querySelector('[data-context-injection-body]') !== null,
    };
  }

  // ── G4：失败行的颜色 + 画布对比度 ────────────────────────────────────────
  const failedRow = document.querySelector("[data-variant][data-state='error']");
  const nameCell = failedRow === null ? null : failedRow.querySelector(':has(+ [data-shimmer-decoration])');
  const canvas = parse(getComputedStyle(document.body).backgroundColor);
  if (failedRow === null) {
    out.notes.push('这一屏没有失败步骤行（[data-state=error]）：G4 需要一次非零退出的工具调用');
  } else {
    const colour = parse(getComputedStyle(nameCell ?? failedRow).color);
    out.g4 = {
      scheme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      nameColor: getComputedStyle(nameCell ?? failedRow).color,
      canvasColor: getComputedStyle(document.body).backgroundColor,
      contrast: colour === null || canvas === null ? null : ratio(colour, canvas),
      expected: document.body.hasAttribute('data-ds-dark-theme')
        ? '#F9889A（宿主 red-400，暗色不变）'
        : '#821934（70% red-600 + 30% label-primary）',
    };
  }

  out.ok = true;
  console.log('[probe] 0.1.5 M1 G1…G4 — 把下面这段 JSON 整段贴回给审核者');
  console.log(JSON.stringify(out, null, 2));
})();
