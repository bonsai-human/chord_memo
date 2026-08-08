const API_URL = 'https://www.youtube.com/iframe_api';
export const PLAYER_CONTAINER_ID = 'youtube-player-container';

type PlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued';

const STATE_NAMES: Record<number, PlayerState> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
};

/** watch?v= / youtu.be / embed のいずれからでも動画IDを取り出す */
export function extractVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const hit = url.match(pattern);
    if (hit) return hit[1];
  }
  return /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = API_URL;
    document.head.appendChild(script);
  });
  return apiPromise;
}

let player: any = null;
let currentVideoId: string | null = null;

/** 指定した動画でプレイヤーを用意する。すでに同じ動画なら作り直さない */
export async function initPlayer(url: string): Promise<void> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('YouTube の URL を認識できませんでした');

  await loadApi();

  if (player && currentVideoId === videoId) return;

  const container = document.getElementById(PLAYER_CONTAINER_ID);
  if (!container) throw new Error('プレイヤーの置き場所が見つかりません');

  if (player) {
    player.destroy();
    player = null;
  }

  await new Promise<void>((resolve) => {
    player = new window.YT.Player(container, {
      videoId,
      playerVars: { controls: 1, disablekb: 1, modestbranding: 1, rel: 0 },
      events: { onReady: () => resolve() },
    });
  });
  currentVideoId = videoId;
}

export function isReady(): boolean {
  return !!player;
}

export function getCurrentTime(): number {
  return player?.getCurrentTime?.() ?? 0;
}

export function getState(): PlayerState {
  const code = player?.getPlayerState?.();
  return STATE_NAMES[code] ?? 'unstarted';
}

export function seekTo(seconds: number): void {
  player?.seekTo?.(Math.max(0, seconds), true);
}

/** 音量は 0-100 */
export function setVolume(value: number): void {
  player?.setVolume?.(Math.max(0, Math.min(100, value)));
}

export function play(fromSeconds?: number): void {
  if (!player) return;
  if (fromSeconds !== undefined) player.seekTo(Math.max(0, fromSeconds), true);
  player.playVideo();
}

export function pause(): void {
  player?.pauseVideo?.();
}

export function stop(): void {
  player?.pauseVideo?.();
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
