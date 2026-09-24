// The name a page-media download carries. Pages usually title themselves after what's playing,
// but TikTok's and Instagram's titles stay generic ("TikTok - Make Your Day", "Instagram") whatever
// video is on screen, so there the clicked video's own caption names it — or its author when it
// has none.
export function titleForMedia(media: HTMLVideoElement): string {
  const host = location.hostname;
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return tikTokTitle(media) || document.title;
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return instagramTitle(media) || document.title;
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

const INSTAGRAM_ROUTES = new Set(["reels", "reel", "p", "tv", "explore", "direct", "accounts", "stories"]);
// Labels beside the author start with a bullet ("• Follow", "• AI-generated profile"); "Likes"
// stands in for a hidden like count.
const INSTAGRAM_UI_TEXT = /^(•.*|follow|following|ad|sponsored|more|see translation|suggested for you|likes?|comments?|reply|liked by .*|view all .*|paid partnership.*)$/i;

// Instagram's markup has no stable hooks, so its layouts are read by position. Stories carry no
// caption. A post's own page lists comments beside the video, so there the og:title written for
// that post is used. In the feed and the Reels tab the caption is the first free text after the
// author's last profile link within the video's own item — a location sits after the first one.
// Without a caption, the author's @handle names the video.
function instagramTitle(media: HTMLVideoElement): string {
  const article = media.closest("article");
  const item = article ?? outermostItem(media);
  const links = Array.from(item.querySelectorAll("a[href]"));
  const pageHandle = instagramPageHandle(location.pathname);
  const isStory = location.pathname.startsWith("/stories/");
  // A story's URL names its owner. Elsewhere the page may be a feed, so the video's own item
  // speaks first, then the dialog a post opened from the feed sits in.
  const handle = (isStory ? pageHandle || firstHandle(item) : firstHandle(item) || pageHandle)
    || firstHandle(media.closest('[role="dialog"]'));
  const byHandle = handle ? `@${handle}` : "";

  if (isStory) { return byHandle; }
  if (!article && /^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+\//.test(location.pathname)) {
    return instagramMetaCaption() || byHandle;
  }

  const texts = Array.from(item.querySelectorAll('[dir="auto"]'))
    .filter((n) => !n.closest("a") && !n.querySelector('[dir="auto"]'))
    .map((n) => ({ n, text: textOf(n) }))
    .filter(({ text }) => text && text !== handle && !INSTAGRAM_UI_TEXT.test(text) && !/^(?=.*\d)[\d.,:/ KMkmwdhs]+$/.test(text));
  const authorLink = links.filter((a) => instagramHandle(a) === handle).at(-1);
  const caption = texts.find(({ n }) => authorLink && authorLink.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
    ?? texts.reduce<{ text: string } | undefined>((best, t) => (!best || t.text.length > best.text.length ? t : best), undefined);
  return caption?.text || byHandle;
}

// The largest ancestor holding only this video: its post or reel.
function outermostItem(media: HTMLVideoElement): Element {
  let item: Element = media;
  while (item.parentElement && item.parentElement.querySelectorAll("video").length === 1) {
    item = item.parentElement;
  }
  return item;
}

function instagramHandle(link: Element): string {
  const handle = /^\/([A-Za-z0-9._]+)\/(?:reels\/)?$/.exec((link.getAttribute("href") ?? "").split("?")[0])?.[1] ?? "";
  return INSTAGRAM_ROUTES.has(handle) ? "" : handle;
}

function firstHandle(root: Element | null): string {
  return root ? Array.from(root.querySelectorAll("a[href]")).map(instagramHandle).find(Boolean) ?? "" : "";
}

// /stories/<user>/…, /<user>/, /<user>/reels/ and /<user>/reel/<code>/ name their owner;
// highlights live under /stories/highlights/<id>/ and name none.
function instagramPageHandle(path: string): string {
  const story = /^\/stories\/([A-Za-z0-9._]+)\//.exec(path)?.[1];
  if (story) { return story === "highlights" ? "" : story; }
  const first = /^\/([A-Za-z0-9._]+)\//.exec(path)?.[1] ?? "";
  return INSTAGRAM_ROUTES.has(first) ? "" : first;
}

// og:title reads 'Author on Instagram: "caption…' for the post the page was loaded on; moving
// between posts inside the app leaves it behind, hence the shortcode check.
function instagramMetaCaption(): string {
  const meta = (property: string) => document.querySelector(`meta[property="${property}"]`)?.getAttribute("content") ?? "";
  const shortcode = (path: string) => /\/(?:p|reels?)\/([A-Za-z0-9_-]+)/.exec(path)?.[1] ?? "";
  if (!shortcode(location.pathname) || shortcode(meta("og:url")) !== shortcode(location.pathname)) { return ""; }
  const quoted = /:\s*"([\s\S]*)$/.exec(meta("og:title"))?.[1] ?? "";
  return quoted.replace(/"\s*$/, "").replace(/\s+/g, " ").trim();
}

function textOf(element: Element | null): string {
  return element instanceof HTMLElement ? element.innerText.replace(/\s+/g, " ").trim() : "";
}
