// 2-D side-profile drawing of the analysed rocket (nose to the left), with
// stage joints, motors, CG (checkered) and CP (red) markers.
export function drawDiagram(canvas, geom, { stations = [], motors = [], xcg = null, xcp = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || !geom) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = geom.length;
  let maxR = geom.refRadius;
  for (let i = 0; i < geom.nSlices; i++) maxR = Math.max(maxR, geom.rb[i] + geom.finSpan[i]);
  const pad = 12;
  const s = Math.min((w - 2 * pad) / L, (h - 2 * pad - 14) / (2 * maxR));
  const cy = h / 2 - 4;
  const X = (x) => pad + x * s;
  // fins
  g.fillStyle = 'rgba(255,181,71,0.35)';
  g.strokeStyle = 'rgba(255,181,71,0.9)';
  for (const sign of [-1, 1]) {
    g.beginPath();
    let open = false;
    for (let i = 0; i < geom.nSlices; i++) {
      const x = geom.xs[i];
      const sp = geom.finSpan[i];
      const rb = geom.rb[i] || (i > 0 ? geom.rb[i - 1] : 0);
      if (sp > 0) {
        if (!open) {
          g.moveTo(X(x), cy + sign * rb * s);
          open = true;
        }
        g.lineTo(X(x), cy + sign * (rb + sp) * s);
      } else if (open) {
        g.lineTo(X(x), cy + sign * rb * s);
        g.closePath();
        g.fill();
        g.stroke();
        g.beginPath();
        open = false;
      }
    }
    if (open) {
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  // body
  g.beginPath();
  g.moveTo(X(0), cy);
  for (let i = 0; i < geom.nSlices; i++) if (geom.rb[i] > 0) g.lineTo(X(geom.xs[i]), cy - geom.rb[i] * s);
  for (let i = geom.nSlices - 1; i >= 0; i--) if (geom.rb[i] > 0) g.lineTo(X(geom.xs[i]), cy + geom.rb[i] * s);
  g.closePath();
  g.fillStyle = 'rgba(200,210,225,0.25)';
  g.fill();
  g.strokeStyle = '#d6dde6';
  g.lineWidth = 1.2;
  g.stroke();
  // motors
  for (const m of motors) {
    const x0 = L - (m.yAft + m.len);
    g.fillStyle = m.color || 'rgba(198,40,40,0.75)';
    g.fillRect(X(x0), cy + (m.lat - m.r) * s, m.len * s, 2 * m.r * s);
  }
  // stage joints
  g.strokeStyle = 'rgba(120,200,255,0.9)';
  g.setLineDash([4, 3]);
  for (const st of stations) {
    const x = L - st;
    g.beginPath();
    g.moveTo(X(x), cy - maxR * s);
    g.lineTo(X(x), cy + maxR * s);
    g.stroke();
  }
  g.setLineDash([]);
  const R = Math.max(5, Math.min(9, geom.refRadius * s));
  if (xcg !== null) {
    const x = X(xcg);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x, cy, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(x, cy);
    g.arc(x, cy, R, -Math.PI / 2, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x, cy);
    g.arc(x, cy, R, Math.PI / 2, Math.PI);
    g.closePath();
    g.fill();
    g.strokeStyle = '#111';
    g.beginPath();
    g.arc(x, cy, R, 0, Math.PI * 2);
    g.stroke();
  }
  if (xcp !== null) {
    const x = X(xcp);
    g.fillStyle = '#ff3030';
    g.beginPath();
    g.arc(x, cy, R * 0.85, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x, cy, R * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#8b96a3';
  g.font = '10px system-ui';
  g.textAlign = 'left';
  g.fillText(`L ${(L * 1000).toFixed(0)} mm  ·  Ø ${(geom.refDiameter * 1000).toFixed(1)} mm`, pad, h - 4);
  g.textAlign = 'right';
  g.fillText('◐ CG   ● CP', w - pad, h - 4);
}
