import { OFFSCREEN_PATH } from '../shared/constants';
import { isResponse, type OffscreenRequest } from '../shared/messages';
import type { SoundPattern } from '../shared/types';

/** 서비스 워커는 오디오를 재생할 수 없으므로 offscreen 문서(AUDIO_PLAYBACK)를 사용한다. */
let creating: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;
  // 동시에 두 번 생성하면 "Only a single offscreen document" 오류가 나므로 진행 중인 생성을 공유
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: '예매 버튼 활성화 및 오픈 시각 알림음 재생',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function playSound(pattern: SoundPattern): Promise<void> {
  await ensureOffscreenDocument();
  const request: OffscreenRequest = { target: 'offscreen', type: 'PLAY_SOUND', pattern };
  const response: unknown = await chrome.runtime.sendMessage(request);
  if (!isResponse(response)) throw new Error('offscreen 문서가 응답하지 않습니다.');
  if (!response.ok) throw new Error(response.error);
}
