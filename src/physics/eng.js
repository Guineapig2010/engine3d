// RASP (.eng) thrust-curve parser and motor helpers.
// Format: ';' comment lines, then a header
//   <name> <diameter mm> <length mm> <delays> <prop mass kg> <total mass kg> <mfr>
// followed by "time thrust" pairs (seconds, newtons). Thrust is implicitly 0 at t=0.

export function parseEng(text) {
  const lines = text.split(/\r?\n/);
  const comments = [];
  let header = null;
  const nums = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      if (!header) comments.push(line.replace(/^;+\s?/, ''));
      continue;
    }
    if (!header) {
      const p = line.split(/\s+/);
      if (p.length < 7) throw new Error('Bad .eng header: ' + line);
      header = {
        name: p[0],
        diameter: parseFloat(p[1]),
        length: parseFloat(p[2]),
        delays: p[3],
        propMass: parseFloat(p[4]),
        totalMass: parseFloat(p[5]),
        mfr: p.slice(6).join(' '),
      };
      continue;
    }
    for (const tok of line.split(/[\s,]+/)) {
      if (tok === '') continue;
      const v = parseFloat(tok);
      if (!Number.isNaN(v)) nums.push(v);
    }
  }
  if (!header) throw new Error('No .eng header found');
  const points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  if (!points.length) throw new Error('No thrust data in .eng file');
  // Ensure monotonic time and an explicit (0,0) start.
  points.sort((a, b) => a[0] - b[0]);
  if (points[0][0] > 0) points.unshift([0, 0]);
  // Ensure thrust ends at zero.
  if (points[points.length - 1][1] !== 0) {
    const last = points[points.length - 1];
    points.push([last[0] + 0.01, 0]);
  }
  return { ...header, points, comments };
}

/** Integrate a curve and return its certification-style statistics. */
export function curveStats(points) {
  let impulse = 0;
  let peak = 0;
  let firstT = null;
  for (let i = 1; i < points.length; i++) {
    const [t0, f0] = points[i - 1];
    const [t1, f1] = points[i];
    impulse += 0.5 * (f0 + f1) * (t1 - t0);
  }
  for (const [t, f] of points) {
    if (f > peak) peak = f;
    if (firstT === null && f > 0) firstT = t;
  }
  const burnTime = points[points.length - 1][0];
  // NAR-style burn time: from 5% of peak to 5% of peak on tail-off.
  const thr = 0.05 * peak;
  let tStart = 0;
  let tEnd = burnTime;
  for (let i = 1; i < points.length; i++) {
    if (points[i][1] >= thr) {
      const [t0, f0] = points[i - 1];
      const [t1, f1] = points[i];
      tStart = f1 === f0 ? t0 : t0 + ((thr - f0) / (f1 - f0)) * (t1 - t0);
      break;
    }
  }
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i - 1][1] >= thr) {
      const [t0, f0] = points[i - 1];
      const [t1, f1] = points[i];
      tEnd = f1 === f0 ? t1 : t0 + ((f0 - thr) / (f0 - f1)) * (t1 - t0);
      break;
    }
  }
  const certBurn = Math.max(1e-3, tEnd - tStart);
  return { impulse, peak, burnTime, avgThrust: impulse / certBurn, certBurnTime: certBurn };
}

/** NAR impulse class letter for a total impulse in N·s. */
export function impulseClass(I) {
  const classes = [
    [0.3125, '1/8A'], [0.625, '1/4A'], [1.25, '1/2A'], [2.5, 'A'], [5, 'B'], [10, 'C'],
    [20, 'D'], [40, 'E'], [80, 'F'], [160, 'G'], [320, 'H'], [640, 'I'], [1280, 'J'],
  ];
  for (const [max, letter] of classes) if (I <= max * 1.0001) return letter;
  return '>J';
}

/** Percentage of the class range used: e.g. a 9 N·s C motor is "90% C". */
export function classPercent(I, letter = impulseClass(I)) {
  const upper = { '1/8A': 0.3125, '1/4A': 0.625, '1/2A': 1.25, A: 2.5, B: 5, C: 10, D: 20, E: 40, F: 80, G: 160, H: 320, I: 640, J: 1280 }[letter];
  if (!upper) return 100;
  const lower = upper / 2;
  return Math.round(((I - lower) / (upper - lower)) * 100);
}
