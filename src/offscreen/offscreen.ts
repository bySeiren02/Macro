import { isOffscreenRequest } from '../shared/messages';
import { errorMessage } from '../shared/result';
import type { SoundPattern } from '../shared/types';

interface Tone {
  readonly freq: number;
  readonly duration: number;
  readonly gap: number;
}

/** 오디오 파일 없이 WebAudio로 알림음을 합성한다 */
const PATTERNS: Readonly<Record<SoundPattern, readonly Tone[]>> = {
  alert: [
    { freq: 880, duration: 0.15, gap: 0.08 },
    { freq: 880, duration: 0.15, gap: 0.08 },
    { freq: 1175, duration: 0.3, gap: 0.25 },
    { freq: 880, duration: 0.15, gap: 0.08 },
    { freq: 880, duration: 0.15, gap: 0.08 },
    { freq: 1175, duration: 0.3, gap: 0 },
  ],
  chime: [
    { freq: 660, duration: 0.18, gap: 0.06 },
    { freq: 990, duration: 0.3, gap: 0 },
  ],
};

let context: AudioContext | null = null;

async function play(pattern: SoundPattern): Promise<void> {
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();
  let t = context.currentTime + 0.05;
  for (const tone of PATTERNS[pattern]) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.duration);
    osc.connect(gain).connect(context.destination);
    osc.start(t);
    osc.stop(t + tone.duration + 0.02);
    t += tone.duration + tone.gap;
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  // 팝업/콘텐츠가 백그라운드로 보내는 메시지도 여기로 오므로, 자신을 대상으로 한 것만 응답
  if (sender.id !== chrome.runtime.id || !isOffscreenRequest(raw)) return false;
  play(raw.pattern).then(
    () => sendResponse({ ok: true, data: null }),
    (e: unknown) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});
