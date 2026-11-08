// On-screen HUD for the walk-around game: crosshair, interaction prompt,
// checklist, close-up instructions, telemetry and a pointer to the rocket.
const $ = (s) => document.querySelector(s);

export class Hud {
  constructor() {
    this.prompt = $('#prompt');
    this.cross = $('#crosshair');
    this.hint = $('#closeupHint');
    this.check = $('#checklist');
    this.marker = $('#rocketMarker');
    this.lastPrompt = null;
    this.lastHint = null;
  }

  setPrompt(text, key = 'E') {
    const v = text ? `${key}|${text}` : '';
    if (v === this.lastPrompt) return;
    this.lastPrompt = v;
    if (!text) this.prompt.classList.add('hidden');
    else {
      this.prompt.innerHTML = `<kbd>${key}</kbd> ${text}`;
      this.prompt.classList.remove('hidden');
    }
  }

  closeup(on) {
    document.body.classList.toggle('in-closeup', on);
    this.hint.classList.toggle('hidden', !on);
    if (!on) this.lastHint = null;
  }

  setCloseupHint(html) {
    if (html === this.lastHint) return;
    this.lastHint = html;
    this.hint.innerHTML = html;
  }

  setChecklist(items) {
    const html = items.map((it) => `<li class="${it.done ? 'done' : it.current ? 'current' : ''}">${it.label}</li>`).join('');
    if (html !== this.lastCheck) {
      this.lastCheck = html;
      this.check.innerHTML = html;
    }
  }

  /** Arrow at the screen edge pointing to an off-screen target. */
  setMarker(info) {
    const m = this.marker;
    if (!info) {
      m.classList.add('hidden');
      return;
    }
    m.classList.remove('hidden');
    m.style.left = `${info.x}px`;
    m.style.top = `${info.y}px`;
    m.querySelector('.arrow').style.transform = `rotate(${info.angle}rad)`;
    m.querySelector('.arrow').style.opacity = info.onScreen ? 0 : 1;
    m.querySelector('.label').textContent = info.label;
  }
}
