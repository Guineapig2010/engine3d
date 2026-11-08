// Procedural sound: countdown beeps, relay click, igniter fizz, motor roar
// (shaped by the real thrust), ejection pop. Sound is delayed by distance/343 m/s.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      // white noise buffer
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  beep(freq = 880, dur = 0.12, vol = 0.25) {
    const ctx = this.ensure();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  click() {
    this.burst(0.03, 3000, 0.4);
  }

  burst(dur, freq, vol, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  pop(distance = 0) {
    this.burst(0.35, 400, 0.9 / (1 + distance / 40), distance / 343);
  }

  /** Start a continuous roar whose loudness is driven by setRoar(). */
  startRoar() {
    const ctx = this.ensure();
    if (!ctx || this.roar) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const crackle = ctx.createBiquadFilter();
    crackle.type = 'peaking';
    crackle.frequency.value = 300;
    crackle.gain.value = 8;
    const g = ctx.createGain();
    g.gain.value = 0;
    const delay = ctx.createDelay(5);
    s.connect(lp).connect(crackle).connect(g).connect(delay).connect(this.master);
    s.start();
    this.roar = { s, g, lp, delay };
  }

  setRoar(level, distance) {
    if (!this.roar) return;
    const ctx = this.ctx;
    const att = 1 / (1 + distance / 25);
    this.roar.g.gain.setTargetAtTime(Math.min(1.2, level) * att, ctx.currentTime, 0.03);
    this.roar.lp.frequency.setTargetAtTime(400 + 2600 * att, ctx.currentTime, 0.1);
    this.roar.delay.delayTime.setTargetAtTime(Math.min(4.9, distance / 343), ctx.currentTime, 0.2);
  }

  stopRoar() {
    if (!this.roar) return;
    try {
      this.roar.s.stop();
    } catch {
      /* already stopped */
    }
    this.roar = null;
  }

  fizz() {
    this.burst(0.25, 5000, 0.12);
  }
}
