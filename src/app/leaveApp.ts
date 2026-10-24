/**
 * Full-page navigation to a path another app on the host serves (the hub at
 * `/`, `/support`, another vertical). Replaces the history entry the client
 * router just pushed, so Back does not land on a URL this app cannot render.
 *
 * Its own module so tests can stub it: jsdom's `window.location` cannot be.
 */
export function leaveApp(url: string): void {
  window.location.replace(url);
}
