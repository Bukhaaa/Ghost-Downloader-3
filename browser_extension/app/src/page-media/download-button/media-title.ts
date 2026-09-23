// The name a page-media download carries. Pages usually title themselves after what's playing,
// but TikTok's title stays generic ("TikTok - Make Your Day", "Explore - …") whatever video is
// on screen, so there the clicked video's own caption names it — or its author when it has none.
export function titleForMedia(media: HTMLVideoElement): string {
  const host = location.hostname;
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return tikTokTitle(media) || document.title;
  }
  return document.title;
}

// The feed and video pages give each video its own item; the browse view (opened from a
// profile, search or Explore) shows a single video with its caption beside the player.
function tikTokTitle(media: HTMLVideoElement): string {
  const item = media.closest('[data-e2e="recommend-list-item-container"]');
  if (item) {
    const handle = item.querySelector('a[href^="/@"]')?.getAttribute("href")?.slice(1) ?? "";
    return textOf(item.querySelector('[data-e2e="video-desc"]')) || handle;
  }
  if (media.closest('[data-e2e="browse-video"]')) {
    const handle = /^\/(@[^/]+)\//.exec(location.pathname)?.[1] ?? "";
    return textOf(document.querySelector('[data-e2e="browse-video-desc"]')) || handle;
  }
  return "";
}

function textOf(element: Element | null): string {
  return element instanceof HTMLElement ? element.innerText.replace(/\s+/g, " ").trim() : "";
}
