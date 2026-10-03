export class Sounds {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.context = null;
    this.lastTick = 0;
  }
  async unlock() {
    if (!this.enabled) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      if (!this.context) {
        this.context = new Audio();
        this.master = this.context.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {}
  }
  tone(frequency, duration, offset = 0, volume = 0.3, type = "sine") {
    if (!this.enabled || this.context?.state !== "running") return;
    const start = this.context.currentTime + offset;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 0.7,
      start + duration,
    );
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  tick() {
    const now = performance.now();
    if (now - this.lastTick < 28) return;
    this.lastTick = now;
    this.tone(1450, 0.035, 0, 0.14, "triangle");
    this.tone(780, 0.025, 0.003, 0.12);
  }
  start() {
    this.tone(260, 0.18, 0, 0.28);
    this.tone(390, 0.2, 0.06, 0.18);
  }
  finish(special = false) {
    for (const [i, note] of (special
      ? [523.25, 659.25, 783.99, 1046.5]
      : [440, 554.37, 659.25]
    ).entries())
      this.tone(note, 0.4, i * 0.07, 0.22);
  }
}
