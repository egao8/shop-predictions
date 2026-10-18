// Dependency-free SVG charts: line/area with bands, markers and crosshair tooltip; scatter; horizontal bars.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    // CSS custom properties are only reliable via style, not presentation attributes
    if ((k === "fill" || k === "stroke") && typeof v === "string" && v.startsWith("var(")) n.style.setProperty(k, v);
    else n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
};
const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export const fmt = {
  pct: (v, d = 0) => (v == null ? "–" : (v * 100).toFixed(d) + "%"),
  pp: (v, d = 1) => (v == null ? "–" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "pp"),
  num: (v, d = 0) =>
    v == null ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }),
  signed: (v, d = 2) => {
    if (v == null || !isFinite(v)) return "–";
    const s = Number(v).toFixed(d);
    return Number(s) === 0 ? Number(0).toFixed(d) : (v > 0 ? "+" : "") + s;
  },
  logpct: (v) =>
    v == null ? "–" : ((Math.exp(v) - 1) * 100 >= 0 ? "+" : "") + ((Math.exp(v) - 1) * 100).toFixed(0) + "%",
  date: (ms) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
      timeZone: "America/New_York",
    }),
  datetime: (ms) =>
    new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      timeZone: "America/New_York",
    }) + " ET",
  p: (v) => (v == null ? "–" : v < 0.001 ? "<0.001" : Number(v).toFixed(3)),
  money: (v) =>
    v == null ? "–" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 }),
};

function niceTicks(lo, hi, n = 4) {
  if (!isFinite(lo) || !isFinite(hi)) return [];
  if (lo === hi) {
    hi = lo + 1;
  }
  const span = hi - lo;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
  const err = span / n / step0;
  const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// ticks for log(1+x) data, placed at round percentages
function logPctTicks(lo, hi) {
  const cand = [-0.95, -0.9, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4, 9, 19, 49];
  const all = cand.map((c) => Math.log(1 + c)).filter((v) => v >= lo && v <= hi);
  const gap = (hi - lo) / 5;
  // keep 0, then add ticks outward that are at least `gap` apart so labels never collide
  const out = all.includes(0) ? [0] : [];
  for (const v of all.filter((v) => v > 0)) if (v - Math.max(...out, -Infinity) >= gap) out.push(v);
  for (const v of all.filter((v) => v < 0).reverse()) if (Math.min(...out, Infinity) - v >= gap) out.push(v);
  return out.sort((a, b) => a - b);
}

function timeTicks(lo, hi, maxN = 7) {
  const out = [];
  const d = new Date(lo);
  d.setUTCDate(1);
  d.setUTCHours(12, 0, 0, 0);
  const months = (hi - lo) / (30 * 864e5);
  const every = months > 14 ? 3 : months > 7 ? 2 : 1;
  if (months < 1.5) {
    const days = (hi - lo) / 864e5;
    const st = days > 30 ? 7 : days > 14 ? 3 : 1;
    const s = new Date(lo);
    s.setUTCHours(12, 0, 0, 0);
    for (let t = s.getTime(); t <= hi; t += st * 864e5) if (t >= lo) out.push(t);
    return out;
  }
  while (d.getTime() <= hi) {
    if (d.getTime() >= lo && d.getUTCMonth() % every === 0) out.push(d.getTime());
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out.length > maxN ? out.filter((_, i) => i % Math.ceil(out.length / maxN) === 0) : out;
}

function bisect(points, x) {
  let lo = 0,
    hi = points.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo][0] - x) <= Math.abs(points[hi][0] - x) ? lo : hi;
}

function pathFor(points, sx, sy) {
  let d = "",
    pen = false;
  for (const [x, y] of points) {
    if (y == null || !isFinite(y)) {
      pen = false;
      continue;
    }
    d += (pen ? "L" : "M") + sx(x).toFixed(1) + "," + sy(y).toFixed(1);
    pen = true;
  }
  return d;
}

export function legend(container, items) {
  const lg = h("div", "legend");
  for (const it of items) {
    const row = h("span", "legend-item");
    const key = h("span", "key " + (it.kind || "line"));
    key.style.setProperty("--c", it.color);
    row.appendChild(key);
    row.appendChild(document.createTextNode(it.label));
    lg.appendChild(row);
  }
  container.appendChild(lg);
  return lg;
}

function tooltipEl(wrap) {
  const t = h("div", "tooltip");
  t.setAttribute("role", "status");
  wrap.appendChild(t);
  return t;
}

function placeTip(tip, wrap, px, py) {
  const W = wrap.clientWidth;
  tip.style.display = "block";
  const tw = tip.offsetWidth;
  let left = px + 14;
  if (left + tw > W - 4) left = px - tw - 14;
  tip.style.left = Math.max(4, left) + "px";
  tip.style.top = Math.max(0, py - 10) + "px";
}

function fillTip(tip, title, rows) {
  tip.replaceChildren();
  if (title) tip.appendChild(h("div", "tt-title", title));
  for (const r of rows) {
    const row = h("div", "tt-row");
    if (r.color) {
      const k = h("span", "tt-key");
      k.style.setProperty("--c", r.color);
      row.appendChild(k);
    }
    row.appendChild(h("strong", "tt-val", r.value));
    if (r.label) row.appendChild(h("span", "tt-label", r.label));
    tip.appendChild(row);
  }
}

/**
 * lineChart(container, {height, x:{type,domain,format}, y:{domain,format,ticks,zero}, series:[{label,color,points,area,band,width,dim}],
 *            markers:[{x,y,shape,tip:[title,rows],onClick,selected,muted}], rules:[{x,label}], legend:true, xTip})
 */
export function lineChart(container, o) {
  container.replaceChildren();
  const wrap = h("div", "chart-wrap");
  container.appendChild(wrap);
  const H = o.height || 240;
  const W = Math.max(280, container.clientWidth || 600);
  const m = { t: 12, r: o.rightPad ?? 16, b: 26, l: o.leftPad ?? 46 };
  const svg = el(
    "svg",
    { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": o.aria || "chart" },
    wrap,
  );
  const series = o.series.filter((s) => s.points && s.points.length);
  const xs = series.flatMap((s) => [s.points[0][0], s.points[s.points.length - 1][0]]);
  const xd = o.x?.domain || [Math.min(...xs), Math.max(...xs)];
  let yd = o.y?.domain;
  if (!yd) {
    let lo = Infinity,
      hi = -Infinity;
    for (const s of series) {
      for (const p of s.points)
        if (p[1] != null && isFinite(p[1])) {
          lo = Math.min(lo, p[1]);
          hi = Math.max(hi, p[1]);
        }
      if (s.band)
        for (let i = 0; i < s.band.lo.length; i++) {
          lo = Math.min(lo, s.band.lo[i]);
          hi = Math.max(hi, s.band.hi[i]);
        }
    }
    if (o.y?.zero !== false) lo = Math.min(lo, 0);
    const pad = (hi - lo) * 0.08 || 0.01;
    yd = [o.y?.zero !== false && lo >= 0 ? 0 : lo - pad, hi + pad];
    if (o.y?.max != null) yd[1] = Math.min(yd[1], o.y.max);
  }
  const sx = (x) => m.l + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * (W - m.l - m.r);
  const sy = (y) => H - m.b - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * (H - m.t - m.b);
  const yt = o.y?.logPct ? logPctTicks(yd[0], yd[1]) : niceTicks(yd[0], yd[1], o.y?.ticks || 4);
  const gGrid = el("g", { class: "grid" }, svg);
  for (const t of yt) {
    el("line", { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: t === 0 ? "baseline" : "gridline" }, gGrid);
    const lab = el("text", { x: m.l - 6, y: sy(t) + 4, class: "tick", "text-anchor": "end" }, gGrid);
    lab.textContent = o.y?.format ? o.y.format(t) : t;
  }
  const xt = o.x?.type === "linear" ? niceTicks(xd[0], xd[1], 8) : timeTicks(xd[0], xd[1]);
  for (const t of xt) {
    const lab = el("text", { x: sx(t), y: H - 8, class: "tick", "text-anchor": "middle" }, gGrid);
    lab.textContent = o.x?.format
      ? o.x.format(t)
      : new Date(t).toLocaleDateString(undefined, {
          month: "short",
          timeZone: "UTC",
          ...(xd[1] - xd[0] < 120 * 864e5 ? { day: "numeric" } : {}),
        });
  }
  for (const r of o.rules || []) {
    if (r.x < xd[0] || r.x > xd[1]) continue;
    el("line", { x1: sx(r.x), x2: sx(r.x), y1: m.t, y2: H - m.b, class: "rule" + (r.strong ? " strong" : "") }, svg);
    if (r.label) {
      const tx = el("text", { x: sx(r.x) + 4, y: m.t + 10 + (r.row || 0) * 12, class: "rule-label" }, svg);
      tx.textContent = r.label;
    }
  }
  if (o.shade)
    for (const sh of o.shade) {
      el(
        "rect",
        { x: sx(sh.x0), y: m.t, width: Math.max(0, sx(sh.x1) - sx(sh.x0)), height: H - m.t - m.b, class: "shade" },
        svg,
      );
    }
  const gS = el("g", {}, svg);
  for (const s of series) {
    if (s.band) {
      let d = "";
      s.points.forEach((p, i) => {
        d += (i ? "L" : "M") + sx(p[0]) + "," + sy(s.band.hi[i]);
      });
      for (let i = s.points.length - 1; i >= 0; i--) d += "L" + sx(s.points[i][0]) + "," + sy(s.band.lo[i]);
      el("path", { d: d + "Z", fill: s.color, "fill-opacity": 0.12, stroke: "none" }, gS);
    }
    if (s.area) {
      const pts = s.points.filter((p) => p[1] != null);
      if (pts.length) {
        const d =
          pathFor(pts, sx, sy) +
          `L${sx(pts[pts.length - 1][0])},${sy(Math.max(yd[0], 0))}L${sx(pts[0][0])},${sy(Math.max(yd[0], 0))}Z`;
        el("path", { d, fill: s.color, "fill-opacity": 0.1, stroke: "none" }, gS);
      }
    }
    el(
      "path",
      {
        d: pathFor(s.points, sx, sy),
        fill: "none",
        stroke: s.color,
        "stroke-width": s.width || 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        opacity: s.dim ? 0.55 : 1,
      },
      gS,
    );
  }
  // crosshair + tooltip
  const cross = el("line", { y1: m.t, y2: H - m.b, class: "crosshair", visibility: "hidden" }, svg);
  const dots = series.map((s) => el("circle", { r: 4, fill: s.color, class: "cross-dot", visibility: "hidden" }, svg));
  const tip = tooltipEl(wrap);
  const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
  let markerHover = false;
  const showX = (px, py) => {
    if (markerHover) return;
    const x = xd[0] + ((px - m.l) / (W - m.l - m.r)) * (xd[1] - xd[0]);
    let nx = null;
    const rows = [];
    series.forEach((s, i) => {
      const j = bisect(s.points, x);
      const p = s.points[j];
      if (!p || Math.abs(p[0] - x) > (o.snap || (xd[1] - xd[0]) / 40) || p[1] == null) {
        dots[i].setAttribute("visibility", "hidden");
        return;
      }
      nx = nx ?? p[0];
      dots[i].setAttribute("cx", sx(p[0]));
      dots[i].setAttribute("cy", sy(p[1]));
      dots[i].setAttribute("visibility", "visible");
      rows.push({
        color: s.color,
        value: o.y?.tipFormat ? o.y.tipFormat(p[1]) : o.y?.format ? o.y.format(p[1]) : String(p[1]),
        label: s.label,
      });
    });
    if (nx == null) {
      tip.style.display = "none";
      cross.setAttribute("visibility", "hidden");
      return;
    }
    cross.setAttribute("x1", sx(nx));
    cross.setAttribute("x2", sx(nx));
    cross.setAttribute("visibility", "visible");
    fillTip(tip, o.xTip ? o.xTip(nx) : o.x?.format ? o.x.format(nx) : fmt.date(nx), rows);
    placeTip(tip, wrap, px, py);
  };
  const hide = () => {
    tip.style.display = "none";
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
  };
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    showX(e.clientX - r.left, e.clientY - r.top);
  });
  hit.addEventListener("pointerleave", hide);
  // markers
  const gM = el("g", {}, svg);
  for (const mk of o.markers || []) {
    if (mk.x < xd[0] || mk.x > xd[1] || mk.y == null) continue;
    const cx = sx(mk.x),
      cy = sy(Math.max(yd[0], Math.min(yd[1], mk.y)));
    const g = el(
      "g",
      {
        class: "marker" + (mk.selected ? " selected" : "") + (mk.muted ? " muted" : ""),
        tabindex: 0,
        role: "button",
        "aria-label": mk.aria || "signal",
      },
      gM,
    );
    const s = mk.selected ? 7 : 5.5;
    if (mk.shape === "up")
      el("path", { d: `M${cx},${cy - s - 1}L${cx + s},${cy + s - 1}L${cx - s},${cy + s - 1}Z`, class: "mk-shape" }, g);
    else if (mk.shape === "down")
      el("path", { d: `M${cx},${cy + s + 1}L${cx + s},${cy - s + 1}L${cx - s},${cy - s + 1}Z`, class: "mk-shape" }, g);
    else el("circle", { cx, cy, r: s - 1, class: "mk-shape" + (mk.shape === "ring" ? " ring" : "") }, g);
    el("circle", { cx, cy, r: 13, fill: "transparent" }, g);
    const enter = (e) => {
      markerHover = true;
      hide();
      markerHover = true;
      if (mk.tip) {
        fillTip(tip, mk.tip[0], mk.tip[1]);
        placeTip(tip, wrap, cx, cy);
      }
    };
    const leave = () => {
      markerHover = false;
      tip.style.display = "none";
    };
    g.addEventListener("pointerenter", enter);
    g.addEventListener("focus", enter);
    g.addEventListener("pointerleave", leave);
    g.addEventListener("blur", leave);
    if (mk.onClick) {
      g.addEventListener("click", mk.onClick);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          mk.onClick();
        }
      });
    }
  }
  if (o.legend !== false && series.length > 1)
    legend(
      container,
      series
        .map((s) => ({ label: s.label, color: s.color, kind: s.area ? "rect" : "line" }))
        .concat(o.extraLegend || []),
    );
  else if (o.extraLegend) legend(container, o.extraLegend);
  return { sx, sy, svg };
}

/** scatter(container, {height, x:{label,format}, y:{label,format}, groups:[{label,color,points:[{x,y,tip}] , fit:{a,b}}]}) */
export function scatter(container, o) {
  container.replaceChildren();
  const wrap = h("div", "chart-wrap");
  container.appendChild(wrap);
  const H = o.height || 300,
    W = Math.max(280, container.clientWidth || 600);
  const m = { t: 12, r: 16, b: 40, l: 52 };
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart" }, wrap);
  const all = o.groups.flatMap((g) => g.points);
  const xl = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))];
  const yl = [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
  const padx = (xl[1] - xl[0]) * 0.06,
    pady = (yl[1] - yl[0]) * 0.08;
  const xd = [xl[0] - padx, xl[1] + padx],
    yd = [yl[0] - pady, yl[1] + pady];
  const sx = (x) => m.l + ((x - xd[0]) / (xd[1] - xd[0])) * (W - m.l - m.r);
  const sy = (y) => H - m.b - ((y - yd[0]) / (yd[1] - yd[0])) * (H - m.t - m.b);
  for (const t of o.y.logPct ? logPctTicks(yd[0], yd[1]) : niceTicks(yd[0], yd[1], 5)) {
    el(
      "line",
      { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: Math.abs(t) < 1e-12 ? "baseline" : "gridline" },
      svg,
    );
    el("text", { x: m.l - 6, y: sy(t) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = o.y.format
      ? o.y.format(t)
      : t;
  }
  for (const t of niceTicks(xd[0], xd[1], 6)) {
    if (t === 0) el("line", { x1: sx(0), x2: sx(0), y1: m.t, y2: H - m.b, class: "baseline" }, svg);
    el("text", { x: sx(t), y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, svg).textContent = o.x.format
      ? o.x.format(t)
      : t;
  }
  el("text", { x: (m.l + W - m.r) / 2, y: H - 4, class: "axis-label", "text-anchor": "middle" }, svg).textContent =
    o.x.label || "";
  el(
    "text",
    {
      x: 12,
      y: (H - m.b + m.t) / 2,
      class: "axis-label",
      "text-anchor": "middle",
      transform: `rotate(-90 12 ${(H - m.b + m.t) / 2})`,
    },
    svg,
  ).textContent = o.y.label || "";
  const tip = tooltipEl(wrap);
  for (const g of o.groups) {
    if (g.fit) {
      el(
        "line",
        {
          x1: sx(xl[0]),
          x2: sx(xl[1]),
          y1: sy(g.fit.a + g.fit.b * xl[0]),
          y2: sy(g.fit.a + g.fit.b * xl[1]),
          stroke: g.color,
          "stroke-width": 2,
          opacity: 0.9,
        },
        svg,
      );
    }
  }
  for (const g of o.groups) {
    for (const p of g.points) {
      const gg = el("g", { class: "pt", tabindex: 0 }, svg);
      el(
        "circle",
        {
          cx: sx(p.x),
          cy: sy(p.y),
          r: 4.5,
          fill: g.color,
          stroke: "var(--surface-1)",
          "stroke-width": 2,
          opacity: g.dim ? 0.6 : 1,
        },
        gg,
      );
      el("circle", { cx: sx(p.x), cy: sy(p.y), r: 12, fill: "transparent" }, gg);
      const show = () => {
        fillTip(tip, p.tip?.[0] || "", p.tip?.[1] || []);
        placeTip(tip, wrap, sx(p.x), sy(p.y));
      };
      gg.addEventListener("pointerenter", show);
      gg.addEventListener("focus", show);
      gg.addEventListener("pointerleave", () => (tip.style.display = "none"));
      gg.addEventListener("blur", () => (tip.style.display = "none"));
      if (p.onClick) gg.addEventListener("click", p.onClick);
    }
  }
  legend(
    container,
    o.groups.map((g) => ({ label: g.label, color: g.color, kind: "dot" })),
  );
}

/** hbars(container, rows:[{label,value,display,color,note}], {max}) - horizontal bars, value at the tip */
export function hbars(container, rows, o = {}) {
  container.replaceChildren();
  const max = o.max || Math.max(...rows.map((r) => r.value)) || 1;
  const list = h("div", "hbars");
  for (const r of rows) {
    const row = h("div", "hbar-row");
    row.appendChild(h("div", "hbar-label", r.label));
    const track = h("div", "hbar-track");
    const bar = h("div", "hbar");
    bar.style.width = Math.max(0.5, (r.value / max) * 100) + "%";
    bar.style.setProperty("--c", r.color || "var(--series-1)");
    track.appendChild(bar);
    const v = h("span", "hbar-val", r.display ?? String(r.value));
    track.appendChild(v);
    row.appendChild(track);
    if (r.note) row.appendChild(h("div", "hbar-note", r.note));
    list.appendChild(row);
  }
  container.appendChild(list);
}

export { h, el };
