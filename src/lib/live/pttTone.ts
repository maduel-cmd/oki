let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Demo PTT tone when LiveKit credentials are missing. */
export async function playPttAutoTone(durationMs = 900): Promise<void> {
  const ac = ctx();
  if (ac.state === 'suspended') await ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 520;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ac.destination);
  const now = ac.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.05);
}
