export let playerContainer: HTMLElement | null = null;

export function initUtils(container: HTMLElement) {
  playerContainer = container;
}

export function debugLog(msg: string) {
  window.nekori!.player!.log(msg);
}

export function showError(msg: string) {
  debugLog('ERROR: ' + msg);
}

export function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function cleanupIframe(iframe: HTMLIFrameElement) {
  const overlay = iframe.closest<HTMLElement>('[data-avs-challenge-overlay]');
  try {
    iframe.src = 'about:blank';
  } catch (e) {
    //
  }
  setTimeout(function () {
    try {
      if (overlay) overlay.remove();
      else iframe.remove();
    } catch (e) {
      //
    }
  }, 200);
}
