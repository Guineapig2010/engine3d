// Lightweight canvas line charts with axes, multiple series, event markers and
// a hover read-out. No dependencies.
export class LineChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = { xLabel: 't (s)', yLabel: '', ...opts };
    this.series = [];
    this.markers = [];
    this.cursorX = null;
    this.hover = null;
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = e.clientX - r.left;
      this.draw();
    });
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set({ series = [], markers = [], xLabel, yLabel, xMax } = {}) {
    this.series = series;
    this.markers = markers;
    if (xLabel) this.opts.xLabel = xLabel;
    if (yLabel !== undefined) this.opts.yLabel = yLabel;
    this.xMaxFixed = xMax;
    this.draw();
  }

  setCursor(x) {
    this.cursorX = x;
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--chart-ink').trim() || '#c9d1d9';
    const grid = css.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.08)';
    const pad = { l: 46, r: 10, t: 10, b: 26 };
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of this.series) {
      for (const [x, y] of s.points) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!isFinite(xMin)) {
      g.fillStyle = ink;
      g.font = '12px system-ui';
      g.fillText('No data', w / 2 - 20, h / 2);
      return;
    }
    if (this.xMaxFixed) xMax = this.xMaxFixed;
    xMin = Math.min(0, xMin);
    yMin = Math.min(0, yMin);
    if (yMax === yMin) yMax = yMin + 1;
    const nice = (v) => {
      const p = Math.pow(10, Math.floor(Math.log10(v)));
      const m = v / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    };
    const yStep = nice((yMax - yMin) / 4);
    yMax = Math.ceil(yMax / yStep) * yStep;
    yMin = Math.floor(yMin / yStep) * yStep;
    const xStep = nice((xMax - xMin) / 6 || 1);
    const X = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (w - pad.l - pad.r);
    const Y = (y) => h - pad.b - ((y - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
    g.font = '11px system-ui, sans-serif';
    g.strokeStyle = grid;
    g.fillStyle = ink;
    g.lineWidth = 1;
    for (let y = yMin; y <= yMax + 1e-9; y += yStep) {
      g.beginPath();
      g.moveTo(pad.l, Y(y));
      g.lineTo(w - pad.r, Y(y));
      g.stroke();
      g.textAlign = 'right';
      g.fillText(fmt(y), pad.l - 5, Y(y) + 4);
    }
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
      g.beginPath();
      g.moveTo(X(x), pad.t);
      g.lineTo(X(x), h - pad.b);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(fmt(x), X(x), h - pad.b + 14);
    }
    g.textAlign = 'right';
    g.fillText(this.opts.xLabel, w - pad.r, h - 3);
    g.save();
    g.translate(11, pad.t + 4);
    g.textAlign = 'left';
    g.fillText(this.opts.yLabel, 0, 0);
    g.restore();
    // markers
    for (const m of this.markers) {
      if (m.x < xMin || m.x > xMax) continue;
      g.strokeStyle = m.color || 'rgba(255,200,80,0.5)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(m.x), pad.t);
      g.lineTo(X(m.x), h - pad.b);
      g.stroke();
      g.setLineDash([]);
    }
    // series
    for (const s of this.series) {
      g.strokeStyle = s.color;
      g.lineWidth = s.width || 1.8;
      if (s.dash) g.setLineDash(s.dash);
      g.beginPath();
      s.points.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.stroke();
      g.setLineDash([]);
    }
    // legend
    let lx = pad.l + 6;
    for (const s of this.series) {
      if (!s.name) continue;
      g.fillStyle = s.color;
      g.fillRect(lx, pad.t + 2, 10, 3);
      g.fillStyle = ink;
      g.textAlign = 'left';
      g.fillText(s.name, lx + 14, pad.t + 7);
      lx += g.measureText(s.name).width + 28;
    }
    const cx = this.hover !== null ? xMin + ((this.hover - pad.l) / (w - pad.l - pad.r)) * (xMax - xMin) : this.cursorX;
    if (cx !== null && cx !== undefined && cx >= xMin && cx <= xMax) {
      g.strokeStyle = ink;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.moveTo(X(cx), pad.t);
      g.lineTo(X(cx), h - pad.b);
      g.stroke();
      g.globalAlpha = 1;
      let ty = pad.t + 22;
      g.textAlign = X(cx) > w - 120 ? 'right' : 'left';
      const tx = X(cx) + (g.textAlign === 'right' ? -6 : 6);
      g.fillStyle = ink;
      g.fillText(`${fmt(cx)} s`, tx, ty);
      for (const s of this.series) {
        const y = interp(s.points, cx);
        if (y === null) continue;
        ty += 14;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(X(cx), Y(y), 3, 0, Math.PI * 2);
        g.fill();
        g.fillText(`${fmt(y)}${s.unit ? ' ' + s.unit : ''}`, tx, ty);
      }
    }
  }
}

function interp(pts, x) {
  if (!pts.length || x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m][0] <= x) lo = m;
    else hi = m;
  }
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0';
}
