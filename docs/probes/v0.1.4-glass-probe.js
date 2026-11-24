/*!
 * 0.1.4 M1 玻璃材质 — 真机探针（D3 / D4）
 *
 * 用法：在 DSH 桌面壳的 DevTools console 里**整段粘贴**，回车。约 4 秒后打印一份 JSON。
 * 它只做三件事：读样式、临时插两个 8px 方块、滚动会话列 1 秒采样 rAF；
 * 结束后自己摘掉方块、把滚动位置与根属性还原。不改插件、不写设置。
 *
 * D3 = backdrop-filter 让「带它的那个盒子」成为 fixed 后代的包含块。
 *      注意：宿主座位（[data-composer-seat]）本来就有 will-change: transform，
 *      所以**座位内**的 fixed 元素在 0.1.4 之前就已经相对座位定位、而不是视口。
 *      因此探针给的是「材质开 vs 关」的对照：两次落点必须一致（只许差异 0）。
 * D4 = 滚动时 backdrop-filter 逐帧重算。采样两次（开 / 关），比较 p95 与掉帧率。
 *      判定：开着的「按时帧」（<= 16.67ms x 1.2）占比 >= 95%、零丢帧（> 1.5 倍 vsync），
 *      且 p95 与关闭时相差 <= 2ms。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const html = document.documentElement;
  const out = { now: new Date().toISOString(), ok: false, notes: [] };

  const card = document.querySelector('[data-composer-card]');
  if (card === null) {
    console.log('[probe] 找不到 [data-composer-card]——请在会话页面（输入卡已渲染）再跑一次');
    return;
  }

  // ── 0. 现状 ──────────────────────────────────────────────────────────────
  const plane = getComputedStyle(card, '::before');
  const blurVar = getComputedStyle(html).getPropertyValue('--dsh-moonset-glass-blur').trim();
  out.state = {
    skinAttr: html.getAttribute('data-moonset-skin'),
    glassAttr: html.getAttribute('data-moonset-glass'),
    blurVar: blurVar || '(unset)',
    cardBackground: getComputedStyle(card).backgroundColor,
    cardIsolation: getComputedStyle(card).isolation,
    planeContent: plane.content,
    planeBackground: plane.backgroundColor,
    planeBackdrop: plane.backdropFilter || plane.webkitBackdropFilter || 'none',
    planeZIndex: plane.zIndex,
    planeRadius: plane.borderRadius,
    cardRadius: getComputedStyle(card).borderRadius,
  };
  // 0.1.4 M2: the two extra faces, read the same way (它们的材质也画在 ::before 上，
  // 只有 Windows 条本身是 ::before，所以直接读它自己的计算样式).
  const readPlane = (el) => {
    if (el === null) return null;
    const cs = getComputedStyle(el, '::before');
    return {
      hostBackground: getComputedStyle(el).backgroundColor,
      planeContent: cs.content,
      planeBackground: cs.backgroundColor,
      planeBackdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      planeZIndex: cs.zIndex,
    };
  };
  out.state.sidebar = readPlane(document.querySelector("#root [data-slot='sidebar'] > div"));
  // 0.1.4 M3: the conversation header, plus the host fact that decides how much
  // the material there can show — does any transcript content pass BEHIND it?
  const headerEl = document.querySelector("#root [data-slot='conversation.header'] > header");
  out.state.header = readPlane(headerEl);
  const contentScroller = document.querySelector('[data-conversation-scroll]');
  if (headerEl !== null && contentScroller !== null) {
    const hb = headerEl.getBoundingClientRect();
    const savedTop = contentScroller.scrollTop;
    contentScroller.scrollTop = 0;
    const first = contentScroller.firstElementChild;
    const fb = first === null ? null : first.getBoundingClientRect();
    contentScroller.scrollTop = savedTop;
    out.headerBackdrop = {
      headerTop: Math.round(hb.top),
      headerBottom: Math.round(hb.bottom),
      firstContentTopAtScroll0: fb === null ? null : Math.round(fb.top),
      contentUnderHeader: fb === null ? null : fb.top < hb.bottom,
      note: 'false = 正文不会跑到 header 背后（宿主 header 不 sticky，正文在下面的滚动容器里），',
    };
  }
  const frame = document.querySelector("#root [data-slot='root'] > div");
  if (frame !== null) {
    const strip = getComputedStyle(frame, '::before');
    out.state.topStrip = {
      windowsTitlebar: html.hasAttribute('data-windows-titlebar'),
      stripContent: strip.content,
      stripHeight: strip.height,
      stripBackground: strip.backgroundColor,
      stripBackdrop: strip.backdropFilter || strip.webkitBackdropFilter || 'none',
    };
    if (!html.hasAttribute('data-windows-titlebar')) {
      out.notes.push('没有 data-windows-titlebar：这一面在 macOS 上不存在，顶栏条不参与判定');
    }
  }
  if (out.state.glassAttr === null) {
    out.notes.push('data-moonset-glass 没挂：玻璃当前是关的，D3/D4 采样会退化成同一组数');
  }
  if (out.state.planeBackdrop === 'none') {
    out.notes.push('::before 的 backdrop-filter 是 none：这张卡可能不是输入卡，或皮肤表没挂');
  }

  // ── D3：fixed 探针（卡内 vs 视口，材质开 vs 关）──────────────────────────
  const makeBox = (color) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;z-index:2147483647;pointer-events:none;background:' + color;
    return el;
  };
  const inCard = makeBox('#ff0044');   // inside the card: the D3 subject
  const inBody = makeBox('#0066ff');   // in <body>: the viewport control
  card.appendChild(inCard);
  document.body.appendChild(inBody);
  await sleep(60);
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100 };
  };
  const cardRect = card.getBoundingClientRect();
  const withGlass = { inCard: rectOf(inCard), control: rectOf(inBody) };
  const hadGlass = html.hasAttribute('data-moonset-glass');
  if (hadGlass) html.removeAttribute('data-moonset-glass');
  await sleep(120);
  const withoutGlass = { inCard: rectOf(inCard), control: rectOf(inBody) };
  if (hadGlass) html.setAttribute('data-moonset-glass', '');
  inCard.remove();
  inBody.remove();
  await sleep(120);
  out.d3 = {
    cardViewportRect: { x: Math.round(cardRect.x), y: Math.round(cardRect.y), w: Math.round(cardRect.width), h: Math.round(cardRect.height) },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    fixedInsideCard_dx_from_card: Math.round((withGlass.inCard.x - cardRect.x) * 100) / 100,
    fixedInsideCard_glassOn: withGlass.inCard,
    fixedInsideCard_glassOff: withoutGlass.inCard,
    bodyControl_glassOn: withGlass.control,
    verdict:
      withGlass.inCard.x === withoutGlass.inCard.x && withGlass.inCard.y === withoutGlass.inCard.y
        ? 'PASS（材质开关不改变 fixed 落点）'
        : 'FAIL（材质改变了 fixed 落点，该面回退为半透明不 blur）',
    note:
      withGlass.inCard.x === 0 && withGlass.inCard.y === 0
        ? 'fixed 元素落在视口原点（宿主座位没有捕获它）'
        : 'fixed 元素没有落在视口原点——这是宿主座位 will-change: transform 造成的既有行为，不是 0.1.4 引入的；看上面两个数是否相等即可',
  };

  // ── D4：滚动帧时长（开 / 关各 1 秒）───────────────────────────────────────
  const scroller = document.querySelector('[data-conversation-scroll]') || (() => {
    let best = null;
    for (const el of document.querySelectorAll('div')) {
      if (el.scrollHeight - el.clientHeight > 200 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    }
    return best;
  })();
  if (scroller === null) {
    out.notes.push('找不到可滚动的会话列，D4 跳过（请在一条有内容的会话里跑）');
  } else {
    const startTop = scroller.scrollTop;
    const sample = async (label) => {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(150);
      const deltas = [];
      let last = performance.now();
      let stop = false;
      const t0 = performance.now();
      const tick = (now) => {
        deltas.push(now - last);
        last = now;
        if (stop) return;
        // ~40px/frame 向上滚，1 秒后停
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 40);
        if (now - t0 < 1000) requestAnimationFrame(tick);
        else stop = true;
      };
      requestAnimationFrame(tick);
      await sleep(1300);
      const sorted = deltas.slice(1).sort((a, b) => a - b);
      const pct = (q) => sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] * 100) / 100;
      // 60Hz 的一帧是 16.67ms：「按时」= 没丢一个 vsync（阈值 1.2 倍），
      // 「丢帧」= 超过 1.5 倍（至少错过一个 vsync，约 33ms）。
      const budget = 1000 / 60;
      const smooth = sorted.filter((d) => d <= budget * 1.2).length;
      const dropped = sorted.filter((d) => d > budget * 1.5).length;
      return {
        label,
        frames: sorted.length,
        p50ms: pct(0.5),
        p95ms: pct(0.95),
        maxMs: sorted.length === 0 ? 0 : Math.round(sorted[sorted.length - 1] * 100) / 100,
        smoothShare: sorted.length === 0 ? 0 : Math.round((smooth / sorted.length) * 1000) / 1000,
        droppedFrames: dropped,
      };
    };
    const onFrames = await sample('glass-on');
    if (hadGlass) html.removeAttribute('data-moonset-glass');
    await sleep(200);
    const offFrames = await sample('glass-off');
    if (hadGlass) html.setAttribute('data-moonset-glass', '');
    scroller.scrollTop = startTop;
    out.d4 = {
      on: onFrames,
      off: offFrames,
      verdict:
        onFrames.smoothShare >= 0.95 && onFrames.droppedFrames === 0 && onFrames.p95ms - offFrames.p95ms <= 2
          ? 'PASS（开材质后按时帧 >= 95%、零丢帧，且 p95 比关闭时多 <= 2ms）'
          : 'FAIL/观察（丢帧或 p95 差超阈值：降 blur 或减面）',
    };
  }

  out.ok = true;
  console.log('[probe] 0.1.4 M1 玻璃材质 D3/D4 — 把下面这段 JSON 整段贴回给审核者');
  console.log(JSON.stringify(out, null, 2));
})();
