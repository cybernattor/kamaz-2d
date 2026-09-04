// Pure Web Audio API Sound Synthesizer - Zero external audio files required!

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 1;
  private masterGain: GainNode | null = null;
  
  // Continuous sound nodes
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  
  private hornOsc1: OscillatorNode | null = null;
  private hornOsc2: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  private skidSource: AudioBufferSourceNode | null = null;
  private skidGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Spatialized horns/sirens for remote multiplayer vehicles, keyed by player id.
  // Kept separate from the local player's own horn/siren nodes above so several
  // remote players can honk or run their siren at once, each at its own
  // distance-based volume.
  private remoteHorns: Map<string, { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode }> = new Map();
  private remoteSirens: Map<string, { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode }> = new Map();

  private initialized: boolean = false;

  public init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.35 * this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Create white noise buffer for tire squeals, crashes, and hydrants
      const bufferSize = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.initialized = true;
    } catch (e) {
      console.warn('AudioContext not allowed yet or not supported:', e);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.35 * this.volume, this.ctx.currentTime);
    }
  }

  public setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.isMuted ? 0 : 0.35 * this.volume,
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Update vehicle engine sound pitch and volume dynamically based on speed and throttle
  public updateEngine(speedKmH: number, isThrottle: boolean, isKamaz: boolean) {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (!this.engineOsc1) {
      // Create Engine Synthesizer
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineFilter = this.ctx.createBiquadFilter();

      this.engineOsc1.type = isKamaz ? 'sawtooth' : 'triangle';
      this.engineOsc2.type = 'square';

      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(450, this.ctx.currentTime);

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      this.engineOsc1.start();
      this.engineOsc2.start();
    }

    const baseFreq = isKamaz ? 38 : 55;
    const speedRatio = Math.min(Math.abs(speedKmH) / 100, 1.5);
    const throttleBoost = isThrottle ? 25 : 0;
    const targetFreq1 = baseFreq + speedRatio * 85 + throttleBoost;
    const targetFreq2 = (baseFreq * 1.5) + speedRatio * 110 + (throttleBoost * 0.8);

    const now = this.ctx.currentTime;
    this.engineOsc1.frequency.setTargetAtTime(targetFreq1, now, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(targetFreq2, now, 0.08);

    const targetGain = 0.05 + (isThrottle ? 0.07 : 0.02) + (speedRatio * 0.06);
    this.engineGain?.gain.setTargetAtTime(targetGain, now, 0.08);
  }

  public stopEngine() {
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  // KAMAZ Air Brake Release Hiss
  public playAirBrake() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(3, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    source.stop(now + 0.4);
  }

  // Horn (Heavy Truck or Standard)
  public startHorn(isKamaz: boolean) {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    if (this.hornOsc1) return; // already active

    const now = this.ctx.currentTime;
    this.hornOsc1 = this.ctx.createOscillator();
    this.hornOsc2 = this.ctx.createOscillator();
    this.hornGain = this.ctx.createGain();

    if (isKamaz) {
      // Deep resonant double truck air horn
      this.hornOsc1.type = 'sawtooth';
      this.hornOsc2.type = 'triangle';
      this.hornOsc1.frequency.setValueAtTime(164.8, now); // E3
      this.hornOsc2.frequency.setValueAtTime(220.0, now); // A3
    } else {
      // Standard car horn (F4 + A4)
      this.hornOsc1.type = 'sawtooth';
      this.hornOsc2.type = 'triangle';
      this.hornOsc1.frequency.setValueAtTime(349.23, now);
      this.hornOsc2.frequency.setValueAtTime(440.0, now);
    }

    this.hornGain.gain.setValueAtTime(0, now);
    this.hornGain.gain.linearRampToValueAtTime(0.28, now + 0.05);

    this.hornOsc1.connect(this.hornGain);
    this.hornOsc2.connect(this.hornGain);
    this.hornGain.connect(this.masterGain);

    this.hornOsc1.start(now);
    this.hornOsc2.start(now);
  }

  public stopHorn() {
    if (this.hornGain && this.ctx && this.hornOsc1 && this.hornOsc2) {
      const now = this.ctx.currentTime;
      this.hornGain.gain.linearRampToValueAtTime(0.001, now + 0.08);
      setTimeout(() => {
        try {
          this.hornOsc1?.stop();
          this.hornOsc2?.stop();
          this.hornOsc1?.disconnect();
          this.hornOsc2?.disconnect();
        } catch (_) {
          // ignore
        }
        this.hornOsc1 = null;
        this.hornOsc2 = null;
        this.hornGain = null;
      }, 100);
    }
  }

  // Spatialized horn for a remote multiplayer vehicle. `volume` is the
  // distance-attenuated gain (0 = inaudible, computed by the caller from
  // distance to the local player) rather than a fixed level like the local horn.
  public updateRemoteHorn(id: string, active: boolean, isKamaz: boolean, volume: number) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const existing = this.remoteHorns.get(id);

    if (!active || this.isMuted || volume <= 0.001) {
      if (existing) {
        existing.gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
        setTimeout(() => {
          try {
            existing.osc1.stop();
            existing.osc2.stop();
            existing.osc1.disconnect();
            existing.osc2.disconnect();
          } catch (_) {
            // ignore
          }
        }, 100);
        this.remoteHorns.delete(id);
      }
      return;
    }

    if (!existing) {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      if (isKamaz) {
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(164.8, now);
        osc2.frequency.setValueAtTime(220.0, now);
      } else {
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(349.23, now);
        osc2.frequency.setValueAtTime(440.0, now);
      }

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.05);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);

      this.remoteHorns.set(id, { osc1, osc2, gain });
    } else {
      existing.gain.gain.setTargetAtTime(volume, now, 0.05);
    }
  }

  // Spatialized siren for a remote emergency vehicle. Same volume contract as
  // updateRemoteHorn above.
  public updateRemoteSiren(id: string, active: boolean, volume: number) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const existing = this.remoteSirens.get(id);

    if (!active || this.isMuted || volume <= 0.001) {
      if (existing) {
        existing.gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
        setTimeout(() => {
          try {
            existing.osc.stop();
            existing.lfo.stop();
          } catch (_) {
            // ignore
          }
        }, 120);
        this.remoteSirens.delete(id);
      }
      return;
    }

    if (!existing) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(650, now);

      const lfo = this.ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(0.8, now);

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(300, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      lfo.start(now);

      this.remoteSirens.set(id, { osc, lfo, gain });
    } else {
      existing.gain.gain.setTargetAtTime(volume, now, 0.1);
    }
  }

  // Stop and clean up any remote horn/siren nodes for a player who left
  // (disconnected, or otherwise dropped out of range permanently).
  public clearRemotePlayerSounds(id: string) {
    this.updateRemoteHorn(id, false, false, 0);
    this.updateRemoteSiren(id, false, 0);
  }

  // Stop every remote player's horn/siren, e.g. when the whole multiplayer
  // session drops (the server connection resets, or the socket closes).
  public clearAllRemoteSounds() {
    Array.from(this.remoteHorns.keys()).forEach((id) => this.updateRemoteHorn(id, false, false, 0));
    Array.from(this.remoteSirens.keys()).forEach((id) => this.updateRemoteSiren(id, false, 0));
  }

  // Siren for Emergency Vehicles
  public setSiren(active: boolean) {
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    if (this.isMuted || !active) {
      if (this.sirenGain) {
        this.sirenGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
        setTimeout(() => {
          try {
            this.sirenOsc?.stop();
            this.sirenLfo?.stop();
          } catch (_) {}
          this.sirenOsc = null;
          this.sirenLfo = null;
          this.sirenGain = null;
        }, 120);
      }
      return;
    }

    if (!this.sirenOsc) {
      const now = this.ctx.currentTime;
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenOsc.frequency.setValueAtTime(650, now);

      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'triangle';
      this.sirenLfo.frequency.setValueAtTime(0.8, now); // 0.8 Hz modulation

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(300, now);

      this.sirenLfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);

      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.setValueAtTime(0.18, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);

      this.sirenOsc.connect(filter);
      filter.connect(this.sirenGain);
      this.sirenGain.connect(this.masterGain);

      this.sirenOsc.start(now);
      this.sirenLfo.start(now);
    }
  }

  // Tire Skid / Drift screech
  public updateSkid(isSkidding: boolean, intensity: number = 0.5) {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    if (isSkidding && intensity > 0.15) {
      if (!this.skidGain) {
        this.skidSource = this.ctx.createBufferSource();
        this.skidSource.buffer = this.noiseBuffer;
        this.skidSource.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1100, now);
        filter.Q.setValueAtTime(5, now);

        this.skidGain = this.ctx.createGain();
        this.skidGain.gain.setValueAtTime(0.01, now);

        this.skidSource.connect(filter);
        filter.connect(this.skidGain);
        this.skidGain.connect(this.masterGain);

        this.skidSource.start(now);
      }
      const targetGain = Math.min(0.2, intensity * 0.22);
      this.skidGain.gain.setTargetAtTime(targetGain, now, 0.05);
    } else if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(0.001, now, 0.08);
    }
  }

  // Crash / Impact Sound (Metal/Thud)
  public playCrash(impactForce: number) {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const volume = Math.min(0.6, Math.max(0.1, impactForce * 0.4));

    // Low thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);

    oscGain.gain.setValueAtTime(volume * 0.8, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);

    // Metal crunch noise
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.Q.setValueAtTime(2, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(volume, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.32);
  }

  // Wood / Fence / Crate destruction
  public playCrateBreak() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  // Water Hydrant Gush
  public playHydrantSplash() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.65);
  }

  // Mission Complete / Reward Cash Sound
  public playReward() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.08);

      gain.gain.setValueAtTime(0, now + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.4);
    });
  }

  // Car Door Enter/Exit Click
  public playDoor() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Turn signal click-clack
  public playBlinkerClick() {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.03);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  // Soft two-note chime for the on-screen network feed (chat lines, players
  // joining/leaving). Direction of the interval hints at what happened without
  // needing to glance at the toast: rising for someone arriving, falling for
  // someone leaving, a flat neutral blip for a chat message.
  public playNotification(kind: 'chat' | 'join' | 'leave' = 'chat') {
    if (!this.initialized || this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const [f1, f2] =
      kind === 'join' ? [523.25, 783.99] // C5 -> G5, rising
      : kind === 'leave' ? [659.25, 440.0] // E5 -> A4, falling
      : [740.0, 740.0]; // F#5, flat

    [
      { freq: f1, at: 0 },
      { freq: f2, at: 0.09 },
    ].forEach(({ freq, at }) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + at);

      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.12, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + at);
      osc.stop(now + at + 0.2);
    });
  }
}

export const sound = new SoundEngine();
