// Schema-driven settings panel with Toolcraft-style controls (vanilla DOM, no framework).
// schema: [{ type: 'segmented' | 'section', ... }]; each control binds to a key of `state`.
import './panel.css';

const ICON = {
  chev: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>',
  min: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h8"/></svg>',
  max: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h8M7 3v8"/></svg>',
  reset: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 2v2.5H5"/></svg>',
};
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

export function slider({ min, max, step = 0.01, get, set, reset }) {
  const el = h('div', 'tc-slider'); el.tabIndex = 0; el.setAttribute('role', 'slider');
  el.append(h('div', 'tc-slider-track'), h('div', 'tc-slider-range'), h('div', 'tc-slider-thumb'));
  const [, range, thumb] = el.children;
  const snap = v => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const draw = () => { const p = (get() - min) / (max - min) * 100; range.style.width = p + '%'; thumb.style.left = p + '%'; el.setAttribute('aria-valuenow', get()); };
  const fromX = x => { const r = el.getBoundingClientRect(); set(snap(min + (x - r.left) / r.width * (max - min))); draw(); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.dataset.drag = ''; fromX(e.clientX); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
  el.addEventListener('pointerup', () => delete el.dataset.drag);
  el.addEventListener('dblclick', () => { if (reset) { reset(); draw(); } });
  el.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d) { e.preventDefault(); set(snap(get() + d * step * (e.shiftKey ? 10 : 1))); draw(); }
  });
  draw();
  return { el, draw };
}

export function createPanel({ title, state, defaults, schema, onChange, storageKey = 'tc-panel', footerActions }) {
  const ui = store.get(storageKey, { collapsed: false, open: {} });
  const root = h('aside', 'tc-panel tc-surface');
  root.dataset.collapsed = String(ui.collapsed);
  const head = h('div', 'tc-head');
  const titleEl = h('h1', null, title);
  const sub = h('span', 'tc-sub');
  const resetBtn = h('button', 'tc-icon-btn', ICON.reset); resetBtn.title = 'Reset tất cả về mặc định';
  const colBtn = h('button', 'tc-icon-btn', ui.collapsed ? ICON.max : ICON.min); colBtn.title = 'Thu gọn / mở rộng';
  head.append(titleEl, sub, resetBtn, colBtn);
  const scroll = h('div', 'tc-scroll');
  const footer = h('div', 'tc-footer');
  const status = h('span', 'tc-status');
  footer.append(status);
  (typeof footerActions === 'function' ? footerActions() : []).forEach(a => {
    const b = h('button', 'tc-btn' + (a.primary ? ' tc-btn--primary' : ''), a.label); b.onclick = a.onClick; b.title = a.title || ''; footer.append(b);
  });
  const toastEl = h('div', 'tc-toast'); root.append(toastEl);
  let toastTimer;
  root.append(head, scroll, footer);
  document.body.append(root);

  const updaters = [];
  const changed = key => { onChange(key); refresh(); };
  const setVal = (key, v) => { state[key] = v; changed(key); };

  // `confirm: true` → first click arms the button, second click (within 3s) runs it (no native dialogs)
  function button(c) {
    const b = h('button', 'tc-btn' + (c.primary ? ' tc-btn--primary' : '') + (c.danger ? ' tc-btn--danger' : ''), c.label);
    let armed = 0;
    b.onclick = () => {
      if (!c.confirm) return c.onClick();
      if (armed) { clearTimeout(armed); armed = 0; b.textContent = c.label; delete b.dataset.armed; return c.onClick(); }
      b.textContent = c.confirmLabel || 'Bấm lần nữa'; b.dataset.armed = '';
      armed = setTimeout(() => { armed = 0; b.textContent = c.label; delete b.dataset.armed; }, 3000);
    };
    return b;
  }

  function control(c) {
    const row = h('div', 'tc-row');
    const top = h('div', 'tc-row-top');
    const label = h('span', 'tc-label', c.label || '');
    let upd = () => {};
    if (c.type === 'slider') {
      const fmt = c.format || (v => (+v).toFixed(c.step >= 1 ? 0 : 2) + (c.unit || ''));
      const val = h('button', 'tc-value');
      const s = slider({ min: c.min, max: c.max, step: c.step, get: () => state[c.key], set: v => setVal(c.key, v), reset: () => setVal(c.key, defaults[c.key]) });
      val.onclick = () => {
        const inp = h('input', 'tc-value'); inp.value = state[c.key]; val.replaceWith(inp); inp.focus(); inp.select();
        let closed = false;
        const done = ok => { if (closed) return; closed = true; if (ok && inp.value.trim() !== '' && !isNaN(+inp.value)) setVal(c.key, Math.min(c.max, Math.max(c.min, +inp.value))); inp.replaceWith(val); upd(); };
        inp.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
      };
      top.append(label, val); row.append(top, s.el);
      upd = () => { val.textContent = fmt(state[c.key]); s.draw(); };
    } else if (c.type === 'switch') {
      row.classList.add('tc-row--inline');
      const sw = h('button', 'tc-switch'); sw.setAttribute('role', 'switch');
      sw.onclick = () => setVal(c.key, !state[c.key]);
      row.append(label, sw);
      upd = () => sw.setAttribute('aria-checked', String(!!state[c.key]));
    } else if (c.type === 'segmented') {
      const seg = h('div', 'tc-seg' + (c.large ? ' tc-seg--lg' : ''));
      const btns = c.options.map(o => { const b = h('button', null, o.label ?? o); b.onclick = () => setVal(c.key, o.value ?? o); seg.append(b); return [b, o.value ?? o]; });
      if (c.label) { top.append(label); row.append(top); }
      row.append(seg);
      upd = () => btns.forEach(([b, v]) => b.setAttribute('aria-pressed', String(state[c.key] === v)));
    } else if (c.type === 'select') {
      const sel = h('select', 'tc-select');
      const fill = () => { const opts = typeof c.options === 'function' ? c.options() : c.options; sel.innerHTML = ''; opts.forEach(o => sel.append(new Option(o, o))); };
      // `state`/`onPick` let a select drive something other than the settings object (e.g. saved presets)
      const st = c.state || state;
      sel.onchange = () => { if (c.onPick) { st[c.key] = sel.value; c.onPick(sel.value); } else setVal(c.key, sel.value); };
      top.append(label); row.append(top, sel);
      upd = () => {
        const opts = typeof c.options === 'function' ? c.options() : c.options;
        if (sel.options.length !== opts.length || [...sel.options].some((o, i) => o.value !== opts[i])) fill();
        sel.value = opts.includes(st[c.key]) ? st[c.key] : opts[0];
      };
      fill();
    } else if (c.type === 'color') {
      const wrap = h('div', 'tc-color'); const sw = h('span', 'tc-swatch'); const pick = h('input'); pick.type = 'color';
      const hex = h('input', 'tc-hex'); hex.spellcheck = false;
      sw.append(pick); wrap.append(sw, hex);
      pick.oninput = () => setVal(c.key, pick.value);
      hex.onchange = () => { const v = hex.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{6}$/i.test(v)) setVal(c.key, v.toLowerCase()); else upd(); };
      top.append(label); row.append(top, wrap);
      upd = () => { pick.value = state[c.key]; sw.style.background = state[c.key]; if (document.activeElement !== hex) hex.value = state[c.key].replace('#', ''); };
    } else if (c.type === 'file') {
      const drop = h('div', 'tc-drop', `<b>${c.title}</b><small>${c.hint || ''}</small>`);
      const inp = h('input'); inp.type = 'file'; inp.accept = c.accept; inp.hidden = true;
      drop.onclick = () => inp.click();
      inp.onchange = () => { if (inp.files[0]) c.onFile(inp.files[0]); inp.value = ''; };
      drop.ondragover = e => { e.preventDefault(); drop.dataset.over = ''; };
      drop.ondragleave = () => delete drop.dataset.over;
      drop.ondrop = e => { e.preventDefault(); e.stopPropagation(); delete drop.dataset.over; const f = e.dataTransfer.files[0]; if (f) c.onFile(f); };
      row.append(drop, inp);
    } else if (c.type === 'button') {
      row.append(button(c));
    } else if (c.type === 'buttons') {
      const g = h('div', 'tc-btn-row');
      c.buttons.forEach(x => g.append(button(x)));
      row.append(g);
    } else if (c.type === 'text') {
      const st = c.state || state;
      const inp = h('input', 'tc-text'); inp.placeholder = c.placeholder || ''; inp.spellcheck = false;
      inp.oninput = () => { st[c.key] = inp.value; };
      inp.onkeydown = e => { if (e.key === 'Enter' && c.onEnter) c.onEnter(); };
      if (c.label) { top.append(label); row.append(top); }
      row.append(inp);
      upd = () => { if (document.activeElement !== inp) inp.value = st[c.key] ?? ''; };
    }
    updaters.push(() => { upd(); if (c.when) row.hidden = !c.when(state); });
    return row;
  }

  for (const block of schema) {
    if (block.type !== 'section') {
      const sec = h('section', 'tc-section tc-section--flush'); sec.dataset.open = 'true';
      const body = h('div', 'tc-section-body'); body.append(control(block)); sec.append(body); scroll.append(sec);
      continue;
    }
    const sec = h('section', 'tc-section');
    const open = ui.open[block.title] ?? !!block.open;
    sec.dataset.open = String(open);
    const btn = h('button', 'tc-section-head', `<span>${block.title}</span>${ICON.chev.replace('<svg', '<svg class="tc-chev"')}`);
    btn.onclick = () => { const o = sec.dataset.open !== 'true'; sec.dataset.open = String(o); ui.open[block.title] = o; store.set(storageKey, ui); };
    const body = h('div', 'tc-section-body');
    block.controls.forEach(c => body.append(control(c)));
    sec.append(btn, body); scroll.append(sec);
  }

  colBtn.onclick = () => { ui.collapsed = !ui.collapsed; root.dataset.collapsed = String(ui.collapsed); colBtn.innerHTML = ui.collapsed ? ICON.max : ICON.min; store.set(storageKey, ui); };
  resetBtn.onclick = () => { Object.assign(state, defaults); onChange('*'); refresh(); };

  function refresh() { updaters.forEach(u => u()); }
  refresh();
  return {
    root, refresh,
    setStatus: t => { status.textContent = t; },
    setSubtitle: t => { sub.textContent = t; },
    toast: t => { toastEl.textContent = t; toastEl.dataset.show = ''; clearTimeout(toastTimer); toastTimer = setTimeout(() => delete toastEl.dataset.show, 1800); },
  };
}
