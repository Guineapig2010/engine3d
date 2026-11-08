// Side-panel UI: rocket set-up, motors & staging, recovery, launch site and the
// full motor catalogue. Pure DOM; talks to the App through a small interface.
import { allMotors, motorsByClass, getMotor, getCurve, registerEngText } from '../physics/motors.js';
import { EXAMPLES } from '../data/examples.js';
import { ROD_SPECS } from '../scene/launchPad.js';
import { LineChart } from './charts.js';
import { drawDiagram } from './diagram.js';
import { describePart } from '../physics/assembly.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CURVE_COLORS = ['#ff6a1f', '#4fc3f7', '#81c784', '#ce93d8', '#ffd54f', '#f06292'];

export function motorLabel(m) {
  return `${m.designation} · ${m.mfr} · ${m.impulse.toFixed(1)} N·s · ${Math.round(m.diameter)} mm`;
}

export class Panel {
  constructor(app) {
    this.app = app;
    this.tab = 'rocket';
    this.body = $('#tabBody');
    this.catalogSel = new Set(['Estes-C6-5']);
    this.catalogSort = null;
    for (const b of document.querySelectorAll('#tabs button')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.render();
      });
    }
  }

  render() {
    const fn = { rocket: this.renderRocket, motors: this.renderMotors, recovery: this.renderRecovery, site: this.renderSite, catalog: this.renderCatalog }[this.tab];
    fn.call(this);
  }

  /** Refresh only live read-outs (stability, prediction) without rebuilding forms. */
  refreshLive() {
    const st = this.app.state;
    const pred = this.app.prediction;
    const box = $('#liveStats');
    if (box && pred) box.innerHTML = this.liveHtml(pred);
    const dg = $('#diagram');
    if (dg && this.app.geom) {
      const stab = pred?.stability?.[0];
      drawDiagram(dg, this.app.geom, {
        stations: st.stations,
        motors: this.app.motorLayout().flatMap((s) => s.motors.map((m) => ({ yAft: m.yAft, len: m.motor.length / 1000, r: m.motor.diameter / 2000, lat: m.lat[0], color: 'rgba(198,40,40,0.8)' }))),
        xcg: stab?.xcg ?? null,
        xcp: stab?.xcp ?? null,
      });
    }
    const curve = $('#stageCurves');
    if (curve) this.drawStageCurves(curve);
  }

  liveHtml(pred) {
    const s = pred.summary;
    const stab = pred.stability[0];
    const pct = Math.max(0, Math.min(100, (stab.margin / 5) * 100));
    const color = stab.margin < 1 ? 'var(--bad)' : stab.margin > 3.75 ? 'var(--warn)' : 'var(--good)';
    const stageStab = pred.stability.length > 1 ? pred.stability.map((x, i) => `S${i + 1}+: ${x.margin.toFixed(2)}`).join(' · ') : '';
    return `
      <div class="stats">
        <div><span>Predicted apogee</span><b>${s.apogee.toFixed(0)} m</b></div>
        <div><span>Max speed</span><b>${s.maxSpeed.toFixed(0)} m/s</b></div>
        <div><span>Liftoff mass</span><b>${(s.liftoffMass * 1000).toFixed(0)} g</b></div>
        <div><span>Rod exit</span><b>${s.rodExitSpeed ? s.rodExitSpeed.toFixed(1) + ' m/s' : '—'}</b></div>
        <div><span>CG (from nose)</span><b>${(stab.xcg * 1000).toFixed(0)} mm</b></div>
        <div><span>CP (from nose)</span><b>${(stab.xcp * 1000).toFixed(0)} mm</b></div>
        <div><span>Drag Cd</span><b>${s.cdAtLiftoff ? s.cdAtLiftoff.toFixed(2) : '—'}</b></div>
        <div><span>Ideal delay</span><b>${s.idealDelay != null ? s.idealDelay.toFixed(1) + ' s' : '—'}</b></div>
      </div>
      <div class="stability">
        Stability margin: <b style="color:${color}">${stab.margin.toFixed(2)} cal</b> ${stageStab ? `<span class="hint">(${stageStab})</span>` : ''}
        <div class="bar"><i style="left:calc(${pct}% - 1px)"></i></div>
        <div class="hint">≥ 1 caliber is stable · 1–2 ideal · &gt; 3 weathercocks</div>
      </div>`;
  }

  // ------------------------------------------------------------------ rocket
  renderRocket() {
    const app = this.app;
    const st = app.state;
    const g = app.geom;
    const ex = EXAMPLES.map((e) => `<button class="example ${st.exampleId === e.id ? 'active' : ''}" data-ex="${e.id}"><b>${esc(e.name)}</b><span>${esc(e.blurb)}</span></button>`).join('');
    const fins = g ? g.finSets.map((f) => `${f.count} fins — root ${(f.Cr * 1000).toFixed(0)} mm, tip ${(f.Ct * 1000).toFixed(0)} mm, span ${(f.span * 1000).toFixed(0)} mm, sweep ${(f.sweep * 1000).toFixed(0)} mm`).join('<br>') : '';
    const mounts = g?.motorMounts?.length
      ? g.motorMounts.map((m) => `${m.motorDiameter} mm${m.minimumDiameter ? ' (minimum-diameter body)' : ''}${Math.hypot(m.x, m.z) > 0.002 ? ` at (${(m.x * 1000).toFixed(0)}, ${(m.z * 1000).toFixed(0)}) mm` : ' centred'}`).join(', ')
      : 'none found — motors are centred for you';
    const parts = app.detected
      ? `<div class="section"><h3>Separate parts detected — stacked automatically</h3>
          <div class="hint">Your file has ${app.detected.parts.length} separate pieces. They were oriented, ordered bottom → top and joined (coupler stubs seated into the stage above). Re-order if needed:</div>
          <ul class="parts-list">${st.partOrder
            .map((idx, i) => `<li><b>${i + 1}</b><span>${esc(describePart(app.detected.parts[idx]))}</span>
              <button data-pmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↓</button>
              <button data-pmove="${i}" data-dir="1" ${i === st.partOrder.length - 1 ? 'disabled' : ''}>↑</button></li>`)
            .reverse()
            .join('')}</ul>
          <label class="toggle"><input type="checkbox" id="noAssemble"> Treat as one assembled model instead</label></div>`
      : st.assembleDisabled
        ? `<div class="section"><label class="toggle"><input type="checkbox" id="noAssemble" checked> Treat as one assembled model (auto-stacking off)</label></div>`
        : '';
    this.body.innerHTML = `
      <div class="section"><h3>Example rockets</h3><div class="examples">${ex}</div></div>
      <div class="section"><h3>Your rocket</h3>
        <div class="file-btn"><label>Load STL file…<input type="file" id="stlInput" accept=".stl,model/stl"></label></div>
        <div class="hint" style="margin-top:6px">Any STL works (binary or ASCII). You can also drag &amp; drop it onto the 3-D view. Stages exported as separate side-by-side parts are stacked for you.</div>
      </div>
      <div class="section"><h3>Model: ${esc(st.stlName || '')}</h3>
        <div class="row"><label>STL units</label><select id="units">
          ${['mm', 'cm', 'm', 'in'].map((u) => `<option value="${u}" ${st.units === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="row"><label>Long axis</label><select id="axis">
          ${['auto', 'x', 'y', 'z'].map((u) => `<option value="${u}" ${st.axis === u ? 'selected' : ''}>${u === 'auto' ? 'auto-detect' : u.toUpperCase()}</option>`).join('')}</select>
          <button id="flip" title="Swap which end is the nose">Flip nose ⇅</button></div>
        <div class="row"><label>Paint</label><input type="color" id="color" value="${st.color}"><label style="flex:0 0 auto;color:var(--muted)">Nose</label><input type="color" id="noseColor" value="${st.noseColor}"></div>
        ${g ? `<div class="hint">Length ${(g.length * 1000).toFixed(0)} mm · Ø ${(g.refDiameter * 1000).toFixed(1)} mm · nose ${(g.noseLength * 1000).toFixed(0)} mm · ${g.triangles.toLocaleString()} triangles<br>${fins || 'No fins detected'}<br>Motor mount: ${mounts}</div>` : ''}
      </div>
      ${parts}
      <div class="section"><h3>Mass &amp; drag</h3>
        <div class="row"><label>Airframe mass</label><input type="number" id="mass" min="1" step="1" value="${st.massAuto ? Math.round(app.estimatedMass * 1000) : st.massG}" ${st.massAuto ? 'disabled' : ''}><span class="unit">g</span></div>
        <div class="row"><label></label><label class="toggle"><input type="checkbox" id="massAuto" ${st.massAuto ? 'checked' : ''}> Estimate from the model (no motor, no chute)</label></div>
        <div class="row"><label>Nose weight</label><input type="number" id="noseWeight" min="0" step="1" value="${st.noseWeightG}"><span class="unit">g</span></div>
        <div class="row"><label>Drag coefficient</label><input type="number" id="cd" min="0.1" max="2" step="0.01" placeholder="auto" value="${st.cdOverride ?? ''}"><span class="unit">Cd</span></div>
      </div>
      <div class="section"><h3>Stability &amp; prediction</h3>
        <canvas class="diagram" id="diagram"></canvas>
        <div id="liveStats"></div>
      </div>`;
    this.body.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => app.loadExample(b.dataset.ex)));
    $('#stlInput').addEventListener('change', (e) => e.target.files[0] && app.loadFile(e.target.files[0]));
    $('#units').addEventListener('change', (e) => app.setGeometryOption({ units: e.target.value }));
    $('#axis').addEventListener('change', (e) => app.setGeometryOption({ axis: e.target.value }));
    $('#flip').addEventListener('click', () => app.setGeometryOption({ flip: !st.flip }));
    $('#color').addEventListener('input', (e) => app.setColor(e.target.value, null));
    $('#noseColor').addEventListener('input', (e) => app.setColor(null, e.target.value));
    $('#massAuto').addEventListener('change', (e) => {
      st.massAuto = e.target.checked;
      if (!st.massAuto) st.massG = Math.round(app.estimatedMass * 1000);
      app.configChanged();
      this.render();
    });
    $('#mass').addEventListener('change', (e) => {
      st.massG = Math.max(1, +e.target.value);
      app.configChanged();
    });
    $('#noseWeight').addEventListener('change', (e) => {
      st.noseWeightG = Math.max(0, +e.target.value);
      app.configChanged();
    });
    $('#cd').addEventListener('change', (e) => {
      st.cdOverride = e.target.value ? +e.target.value : null;
      app.configChanged();
    });
    this.body.querySelectorAll('[data-pmove]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = +b.dataset.pmove;
        const j = i + +b.dataset.dir;
        const o = st.partOrder;
        [o[i], o[j]] = [o[j], o[i]];
        app.setGeometryOption({ partOrder: o.slice() });
      })
    );
    $('#noAssemble')?.addEventListener('change', (e) => app.setGeometryOption({ assembleDisabled: e.target.checked }));
    this.refreshLive();
  }

  // ------------------------------------------------------------------ motors
  motorOptions(selectedId, dia, showAll) {
    let html = '';
    for (const [cls, list] of motorsByClass()) {
      const items = list.filter((m) => showAll || !dia || Math.abs(m.diameter - dia) < 1.5);
      if (!items.length) continue;
      html += `<optgroup label="${cls} motors">${items.map((m) => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(motorLabel(m))}</option>`).join('')}</optgroup>`;
    }
    return html;
  }

  renderMotors() {
    const app = this.app;
    const st = app.state;
    const layout = app.motorLayout();
    const n = st.stages.length;
    let html = `<div class="section"><h3>Stages</h3>
      <div class="row"><label>Number of stages</label><select id="nStages">${[1, 2, 3].map((k) => `<option ${k === n ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
    if (n > 1) {
      st.stations.forEach((s, i) => {
        html += `<div class="row"><label>Joint ${i + 1}/${i + 2} from tail</label><input type="number" data-station="${i}" step="1" value="${(s * 1000).toFixed(1)}" ${app.detected ? 'disabled' : ''}><span class="unit">mm</span></div>`;
      });
      html += `<div class="row"><label>Staging</label><select id="stagingMethod">
        <option value="direct" ${st.staging.method === 'direct' ? 'selected' : ''}>Direct (black-powder burn-through)</option>
        <option value="electronic" ${st.staging.method === 'electronic' ? 'selected' : ''}>Electronic timer</option></select></div>`;
      if (st.staging.method === 'electronic')
        html += `<div class="row"><label>Timer after burnout</label><input type="number" id="stagingDelay" min="0" step="0.1" value="${st.staging.delay}"><span class="unit">s</span></div>`;
      html += `<div class="hint">Real black-powder staging: the booster must be a <b>-0</b> motor (green label). When it burns out, burning particles blow forward and light the next motor. Composite motors can't do this.</div>`;
    }
    html += '</div>';
    st.stages.forEach((sg, k) => {
      const m = getMotor(sg.motorId);
      const mount = layout[k]?.mountDiameter;
      const role = n === 1 ? 'Single stage' : k === 0 ? 'Booster (stage 1)' : k === n - 1 ? `Sustainer (stage ${k + 1})` : `Middle stage ${k + 1}`;
      html += `<div class="stage-card"><h4>${role} ${m ? `<span class="motor-badge badge-${m.usage}">${m.usage === 'single' ? 'single stage' : m.usage === 'upper' ? 'upper stage' : m.usage}</span>` : ''}</h4>
        <div class="row"><label>Motor</label><select data-motor="${k}">${this.motorOptions(sg.motorId, mount, sg.showAll)}</select></div>
        <div class="row"><label></label><label class="toggle"><input type="checkbox" data-showall="${k}" ${sg.showAll ? 'checked' : ''}> Show all sizes (mount: ${mount ? mount + ' mm' : 'unknown'})</label></div>
        <div class="row"><label>Motors in cluster</label><select data-count="${k}">${[1, 2, 3, 4, 5, 7].map((c) => `<option ${c === sg.count ? 'selected' : ''}>${c}</option>`).join('')}</select>
          ${sg.count >= 4 ? `<label class="toggle"><input type="checkbox" data-center="${k}" ${sg.center ? 'checked' : ''}> centre motor</label>` : ''}</div>
        <div class="row"><label>Motor sticks out</label><input type="number" data-overhang="${k}" step="1" value="${(sg.overhangMM ?? (k === 0 ? 4 : 8)).toFixed(0)}"><span class="unit">mm</span></div>
        ${m ? `<div class="stats">
          <div><span>Total impulse</span><b>${m.impulse.toFixed(2)} N·s</b></div>
          <div><span>Class</span><b>${m.classPercent}% ${m.cls}</b></div>
          <div><span>Avg thrust</span><b>${m.avgThrust.toFixed(1)} N</b></div>
          <div><span>Peak thrust</span><b>${m.peakThrust.toFixed(1)} N</b></div>
          <div><span>Burn time</span><b>${m.burnTime.toFixed(2)} s</b></div>
          <div><span>Delay</span><b>${m.plugged ? 'plugged' : m.delay + ' s'}</b></div>
          <div><span>Size</span><b>${m.diameter}×${m.length} mm</b></div>
          <div><span>Mass</span><b>${m.totalMass.toFixed(1)} g</b></div>
          </div><div class="hint">${esc(m.propellant)} · placed ${layout[k]?.auto ? 'automatically ' : ''}${layout[k]?.motors.length > 1 ? 'in a ' + layout[k].motors.length + '-motor cluster' : 'on the centre line'} at the aft end of the stage</div>` : ''}
        </div>`;
    });
    html += `<div class="section"><h3>Thrust curves (certified data)</h3><canvas class="curve" id="stageCurves"></canvas></div>
      <div class="section"><h3>Custom motor</h3><div class="file-btn"><label>Import RASP .eng file…<input type="file" id="engInput" accept=".eng"></label></div></div>`;
    this.body.innerHTML = html;
    $('#nStages').addEventListener('change', (e) => app.setStageCount(+e.target.value));
    $('#stagingMethod')?.addEventListener('change', (e) => {
      st.staging.method = e.target.value;
      app.configChanged();
      this.render();
    });
    $('#stagingDelay')?.addEventListener('change', (e) => {
      st.staging.delay = +e.target.value;
      app.configChanged();
    });
    this.body.querySelectorAll('[data-station]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stations[+el.dataset.station] = +el.value / 1000;
        st.stations.sort((a, b) => a - b);
        app.configChanged(true);
      })
    );
    this.body.querySelectorAll('[data-motor]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stages[+el.dataset.motor].motorId = el.value;
        app.configChanged(true);
        this.render();
      })
    );
    this.body.querySelectorAll('[data-showall]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stages[+el.dataset.showall].showAll = el.checked;
        this.render();
      })
    );
    this.body.querySelectorAll('[data-count]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stages[+el.dataset.count].count = +el.value;
        app.configChanged(true);
        this.render();
      })
    );
    this.body.querySelectorAll('[data-center]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stages[+el.dataset.center].center = el.checked;
        app.configChanged(true);
      })
    );
    this.body.querySelectorAll('[data-overhang]').forEach((el) =>
      el.addEventListener('change', () => {
        st.stages[+el.dataset.overhang].overhangMM = +el.value;
        app.configChanged(true);
      })
    );
    $('#engInput').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) this.importEng(f);
    });
    this.refreshLive();
  }

  async importEng(file) {
    try {
      const created = registerEngText(await file.text(), file.name);
      this.app.toast(`Imported ${created.map((m) => m.designation).join(', ')} from ${file.name}`);
      this.render();
    } catch (err) {
      this.app.toast('Could not read .eng file: ' + err.message);
    }
  }

  drawStageCurves(canvas) {
    if (!canvas._chart) canvas._chart = new LineChart(canvas, { yLabel: 'Thrust (N)' });
    const series = this.app.state.stages
      .map((sg, i) => {
        const m = getMotor(sg.motorId);
        if (!m) return null;
        return { name: `S${i + 1} ${m.designation}${sg.count > 1 ? ' ×' + sg.count : ''}`, color: CURVE_COLORS[i], unit: 'N', points: getCurve(m.curve).points.map(([t, f]) => [t, f * sg.count]) };
      })
      .filter(Boolean);
    canvas._chart.set({ series, xLabel: 't (s)', yLabel: 'Thrust (N)' });
  }

  // ------------------------------------------------------------------ recovery
  renderRecovery() {
    const app = this.app;
    const r = app.state.recovery;
    this.body.innerHTML = `
      <div class="section"><h3>Recovery system</h3>
        <div class="row"><label>Type</label><select id="recType">
          <option value="parachute" ${r.type === 'parachute' ? 'selected' : ''}>Parachute</option>
          <option value="streamer" ${r.type === 'streamer' ? 'selected' : ''}>Streamer</option>
          <option value="none" ${r.type === 'none' ? 'selected' : ''}>None (featherweight / lawn dart)</option></select></div>
        ${r.type === 'parachute' ? `
        <div class="row"><label>Canopy diameter</label><select id="chuteSize">${[12, 15, 18, 24, 30, 36].map((d) => `<option value="${d}" ${d === r.diameterIn ? 'selected' : ''}>${d}" (${(d * 2.54).toFixed(0)} cm)</option>`).join('')}</select></div>
        <div class="row"><label>Drag coefficient</label><input type="number" id="recCd" step="0.05" min="0.3" max="1.5" value="${r.cd}"></div>
        <div class="hint">Flat plastic hex/octagon chutes ≈ 0.75 (based on flat diameter). Dome nylon chutes ≈ 1.2–1.5.</div>` : ''}
        ${r.type === 'streamer' ? `
        <div class="row"><label>Streamer width</label><input type="number" id="stW" step="5" min="10" value="${r.streamerWidth}"><span class="unit">mm</span></div>
        <div class="row"><label>Streamer length</label><input type="number" id="stL" step="25" min="100" value="${r.streamerLength}"><span class="unit">mm</span></div>
        <div class="row"><label>Drag coefficient</label><input type="number" id="recCd" step="0.05" min="0.05" max="1" value="${r.cd}"></div>` : ''}
        ${r.type !== 'none' ? `<div class="row"><label>Colour</label><input type="color" id="recColor" value="${r.color}"></div>
        <div class="row"><label>Recovery mass</label><input type="number" id="recMass" step="1" min="0" value="${r.massG}"><span class="unit">g</span></div>
        <div class="hint">Includes shock cord and wadding. It rides just behind the nose cone.</div>` : ''}
      </div>
      <div class="section"><h3>Prediction</h3><div id="liveStats"></div></div>`;
    $('#recType').addEventListener('change', (e) => {
      r.type = e.target.value;
      if (r.type === 'streamer' && !(r.cd < 0.6)) r.cd = 0.25;
      if (r.type === 'parachute' && r.cd < 0.5) r.cd = 0.75;
      app.configChanged(true);
      this.render();
    });
    const num = (id, key, f = (x) => x) =>
      $(id)?.addEventListener('change', (e) => {
        r[key] = f(+e.target.value);
        app.configChanged(true);
      });
    num('#chuteSize', 'diameterIn');
    num('#recCd', 'cd');
    num('#stW', 'streamerWidth');
    num('#stL', 'streamerLength');
    num('#recMass', 'massG');
    $('#recColor')?.addEventListener('change', (e) => {
      r.color = e.target.value;
      app.configChanged(true);
    });
    this.refreshLive();
  }

  // ------------------------------------------------------------------ site
  renderSite() {
    const app = this.app;
    const L = app.state.launch;
    this.body.innerHTML = `
      <div class="section"><h3>Launch pad</h3>
        <div class="row"><label>Launch rod</label><select id="rod">${Object.entries(ROD_SPECS).map(([k, v]) => `<option value="${k}" ${k === L.rod ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        <div class="row"><label>Rod angle</label><input type="range" id="angle" min="0" max="30" step="1" value="${L.angle}"><span class="unit" id="angleV">${L.angle}°</span></div>
        <div class="row"><label>Lean toward</label><input type="range" id="azimuth" min="0" max="359" step="1" value="${L.azimuth}"><span class="unit" id="azV">${compass(L.azimuth)}</span></div>
        <div class="hint">Safety code: rod within 30° of vertical. Lean slightly into the wind and away from spectators.</div>
      </div>
      <div class="section"><h3>Weather</h3>
        <div class="row"><label>Wind speed</label><input type="range" id="wind" min="0" max="9" step="0.5" value="${L.windSpeed}"><span class="unit" id="windV">${L.windSpeed} m/s</span></div>
        <div class="row"><label>Wind from</label><input type="range" id="windFrom" min="0" max="359" step="1" value="${L.windFrom}"><span class="unit" id="windFromV">${compass(L.windFrom)}</span></div>
        <div class="row"><label>Gustiness</label><input type="range" id="gust" min="0" max="0.6" step="0.05" value="${L.gust}"><span class="unit" id="gustV">${Math.round(L.gust * 100)}%</span></div>
        <div class="row"><label>Temperature</label><input type="number" id="temp" step="1" value="${L.tempC}"><span class="unit">°C</span></div>
        <div class="row"><label>Site elevation</label><input type="number" id="elev" step="10" value="${L.elevation}"><span class="unit">m</span></div>
        <div class="hint">Wind is measured at 10 m and follows a 1/7-power profile with height. NAR code: don't fly in winds above 20 mph (9 m/s).</div>
      </div>
      <div class="section"><h3>Realism</h3>
        <label class="toggle"><input type="checkbox" id="variability" ${L.variability ? 'checked' : ''}> Real-world variability: motor impulse ±3.5 %, delay ±10 %, igniter timing, cluster light-up stagger</label>
      </div>
      <div class="section"><h3>Prediction</h3><div id="liveStats"></div></div>`;
    $('#rod').addEventListener('change', (e) => {
      L.rod = e.target.value;
      app.configChanged(true);
    });
    const slider = (id, key, out, f) =>
      $(id).addEventListener('input', (e) => {
        L[key] = +e.target.value;
        $(out).textContent = f(L[key]);
        app.configChanged(key === 'angle' || key === 'azimuth');
      });
    slider('#angle', 'angle', '#angleV', (v) => v + '°');
    slider('#azimuth', 'azimuth', '#azV', compass);
    slider('#wind', 'windSpeed', '#windV', (v) => v + ' m/s');
    slider('#windFrom', 'windFrom', '#windFromV', compass);
    slider('#gust', 'gust', '#gustV', (v) => Math.round(v * 100) + '%');
    $('#temp').addEventListener('change', (e) => {
      L.tempC = +e.target.value;
      app.configChanged();
    });
    $('#elev').addEventListener('change', (e) => {
      L.elevation = +e.target.value;
      app.configChanged();
    });
    $('#variability').addEventListener('change', (e) => {
      L.variability = e.target.checked;
      app.configChanged();
    });
    this.refreshLive();
  }

  // ------------------------------------------------------------------ catalog
  renderCatalog() {
    const motors = allMotors();
    let html = `<div class="section"><h3>Every motor, mapped from certification data</h3>
      <div class="hint">${motors.length} motor variants from 1/4A to F. Each delay version (e.g. C6-0, C6-3, C6-5, C6-7) is its own entry with its own timing and mass. Click rows to compare curves; use one in your rocket with the Motors tab.</div>
      <canvas class="curve" id="catCurve" style="height:200px;margin-top:8px"></canvas>
      <div id="catInfo" class="hint" style="margin-top:6px"></div></div>
      <table class="catalog-table"><thead><tr>
        <th>Motor</th><th>Mfr</th><th>N·s</th><th>Avg N</th><th>Peak N</th><th>Burn s</th><th>Delay</th><th>Ø×L</th><th>g</th></tr></thead><tbody>`;
    for (const [cls, list] of motorsByClass()) {
      html += `<tr class="class-head"><td colspan="9">${cls} — ${classRange(cls)}</td></tr>`;
      for (const m of list) {
        html += `<tr data-id="${m.id}" class="${this.catalogSel.has(m.id) ? 'sel' : ''}">
          <td><span class="motor-badge badge-${m.usage}" style="padding:0 5px">&nbsp;</span> ${esc(m.designation)}</td><td>${esc(m.mfr)}</td>
          <td>${m.impulse.toFixed(2)}</td><td>${m.avgThrust.toFixed(1)}</td><td>${m.peakThrust.toFixed(1)}</td><td>${m.burnTime.toFixed(2)}</td>
          <td>${m.plugged ? 'P' : m.delay}</td><td>${m.diameter}×${m.length}</td><td>${m.totalMass.toFixed(1)}</td></tr>`;
      }
    }
    html += `</tbody></table>
      <div class="hint" style="margin-top:8px">Label colours follow Estes: <span class="motor-badge badge-single">single stage</span> <span class="motor-badge badge-booster">booster (-0)</span> <span class="motor-badge badge-upper">upper stage</span> <span class="motor-badge badge-plugged">plugged</span></div>`;
    this.body.innerHTML = html;
    this.body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        const id = tr.dataset.id;
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && this.catalogSel.size >= 1 && !this.catalogSel.has(id) && this.catalogSel.size >= 6) this.catalogSel.clear();
        if (this.catalogSel.has(id)) this.catalogSel.delete(id);
        else this.catalogSel.add(id);
        tr.classList.toggle('sel', this.catalogSel.has(id));
        this.drawCatalog();
      })
    );
    this.drawCatalog();
  }

  drawCatalog() {
    const canvas = $('#catCurve');
    if (!canvas) return;
    if (!canvas._chart) canvas._chart = new LineChart(canvas, { yLabel: 'Thrust (N)' });
    const sel = [...this.catalogSel].map(getMotor).filter(Boolean);
    canvas._chart.set({
      series: sel.map((m, i) => ({ name: m.designation, color: CURVE_COLORS[i % CURVE_COLORS.length], unit: 'N', points: getCurve(m.curve).points })),
    });
    const info = $('#catInfo');
    info.innerHTML = sel
      .map((m) => {
        const c = getCurve(m.curve);
        return `<b>${esc(m.designation)}</b> (${esc(m.mfr)}, ${esc(m.propellant)}): ${m.impulse.toFixed(2)} N·s = ${m.classPercent}% ${m.cls}, burn ${m.burnTime.toFixed(2)} s, ${m.plugged ? 'no ejection charge' : `ejection ${m.delay} s after burnout`}, propellant ${m.propMass.toFixed(1)} g. <i>${esc(c.notes || '')}</i>`;
      })
      .join('<br>');
  }
}

function compass(deg) {
  const n = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return `${n[Math.round(deg / 22.5) % 16]} ${deg}°`;
}

function classRange(cls) {
  const r = { '1/4A': '0.313–0.625', '1/2A': '0.626–1.25', A: '1.26–2.50', B: '2.51–5.00', C: '5.01–10.0', D: '10.01–20.0', E: '20.01–40.0', F: '40.01–80.0', G: '80.01–160' }[cls];
  return r ? r + ' N·s' : '';
}
