import {fbCdnBitrate, fbCdnDuration, fbCdnVideoId, instagramAssetId, instagramKindOf, isInstagramCdnUrl, stripRangeParams} from "../url-classify";
import type {AttributedUrlView, FindUrlsByIdHint, ResolveContext} from "../strategy";
import type {Resolution} from "../../types";

// efg's duration_s is whole seconds, so it trails the element's duration by up to a second.
const DURATION_TOLERANCE_S = 2;
// Lengths read from the files themselves: a DASH video track can end a frame short of the
// element (23.300 s against 23.337 s), and audio runs a tenth of a second long.
const EXACT_DURATION_TOLERANCE_S = 0.15;

function selectBestPair(
  urls: ReadonlyArray<AttributedUrlView>,
): { video: string; audio: string } | null {
  let bestVideo: { url: string; bitrate: number } | null = null;
  let bestAudio: { url: string; bitrate: number } | null = null;
  for (const entry of urls) {
    const kind = instagramKindOf(entry.url);
    const bitrate = fbCdnBitrate(entry.url);
    if (kind === "video" && (!bestVideo || bitrate > bestVideo.bitrate)) {
      bestVideo = { url: entry.url, bitrate };
    } else if (kind === "audio" && (!bestAudio || bitrate > bestAudio.bitrate)) {
      bestAudio = { url: entry.url, bitrate };
    }
  }
  return bestVideo && bestAudio ? { video: bestVideo.url, audio: bestAudio.url } : null;
}

function highestBitrate(urls: ReadonlyArray<AttributedUrlView>): string | undefined {
  return urls.reduce<AttributedUrlView | undefined>(
    (best, entry) => (!best || fbCdnBitrate(entry.url) > fbCdnBitrate(best.url) ? entry : best),
    undefined,
  )?.url;
}

// Seconds read from the header of one of the asset's files; 0 until the engine has.
function exactDurationOf(urls: ReadonlyArray<AttributedUrlView>): number {
  return Math.max(0, ...urls.map((r) => r.duration));
}

// The feed, the Reels tab and Stories keep their neighbours loaded, and the page's JSON lists
// other posts' representations too, so the tab holds several assets. On Facebook the player
// names its video, and that video's URLs carry the same id. Instagram's player names nothing,
// but its buffer-append lock names the asset — unless the asset's duration contradicts the
// element's, as when two players start together and swap locks. Facebook's players buffer in
// a worker, where no lock is seen, and its Watch page names its video only in the URL, while
// playing suggested ones too.
function selectAssetId(ctx: ResolveContext): string {
  const { duration } = ctx.clicked;
  const { videoId } = ctx.hints;
  const pageVideoId = ctx.pageUrl.searchParams.get("v") ?? /\/videos\/(?:[^/]+\/)?(\d+)/.exec(ctx.pageUrl.pathname)?.[1];
  const urlsByAsset = new Map<string, AttributedUrlView[]>();
  for (const entry of ctx.clicked.attributedUrls) {
    const id = isInstagramCdnUrl(entry.url) ? instagramAssetId(entry.url) : "";
    if (id) { urlsByAsset.set(id, [...(urlsByAsset.get(id) ?? []), entry]); }
  }
  const namesVideo = (urls: AttributedUrlView[], id: string | undefined) => !!id && urls.some((r) => fbCdnVideoId(r.url) === id);
  const named = [...urlsByAsset].find(([, urls]) => namesVideo(urls, videoId));
  if (named) { return named[0]; }
  // With the clicked video named, an asset naming any video is another one.
  const assets = [...urlsByAsset].filter(([, urls]) => !videoId || !urls.some((r) => fbCdnVideoId(r.url)));
  const assetDuration = (urls: AttributedUrlView[]) => Math.max(0, ...urls.map((r) => fbCdnDuration(r.url)));
  const isDurationKnown = (urls: AttributedUrlView[]) => duration > 0 && assetDuration(urls) > 0;
  const hasSameDuration = (urls: AttributedUrlView[]) =>
    isDurationKnown(urls) && Math.abs(assetDuration(urls) - duration) <= DURATION_TOLERANCE_S;
  const isLocked = (urls: AttributedUrlView[]) => urls.some((r) => r.isLockedByMse);
  const sameDuration = assets.filter(([, urls]) => hasSameDuration(urls));
  // Stories often share a second, and a photo set to music runs exactly 15 s. Once the engine
  // has read every candidate's exact length, that decides, and among equal lengths the one
  // the player fetched since it started — its first seconds come prefetched, the rest then.
  const sameLength = sameDuration.every(([, urls]) => exactDurationOf(urls) > 0)
    ? sameDuration.filter(([, urls]) => Math.abs(exactDurationOf(urls) - duration) <= EXACT_DURATION_TOLERANCE_S)
    : [];
  const fetchedSameLength = sameLength.filter(([, urls]) => urls.some((r) => r.isFetchedInSession));
  return assets.find(([, urls]) => isLocked(urls) && hasSameDuration(urls))?.[0]
    ?? sameDuration.find(([, urls]) => namesVideo(urls, pageVideoId))?.[0]
    ?? (sameDuration.length === 1 ? sameDuration[0][0] : undefined)
    ?? (sameLength.length === 1 ? sameLength[0][0] : undefined)
    ?? (fetchedSameLength.length === 1 ? fetchedSameLength[0][0] : undefined)
    // Same-length videos that nothing tells apart would be a guess, so wait instead.
    ?? assets.find(([, urls]) => isLocked(urls) && !isDurationKnown(urls))?.[0]
    ?? (assets.length === 1 && !isDurationKnown(assets[0][1]) ? assets[0][0] : "");
}

export function selectMeta(ctx: ResolveContext, findUrlsByIdHint: FindUrlsByIdHint): Resolution {
  // A player fed straight from <video src> is playing that very file.
  if (/^https?:/i.test(ctx.clicked.src)) {
    return { kind: "selection", selection: { kind: "single", url: stripRangeParams(ctx.clicked.src), formKind: ctx.clicked.formKind } };
  }

  const assetId = selectAssetId(ctx);
  if (!assetId) {
    return { kind: "pending", reason: chrome.i18n.getMessage("waitingForVideoResource") };
  }
  // A sibling session may still hold tracks it prefetched for this asset.
  const urls = [
    ...ctx.clicked.attributedUrls.filter((r) => instagramAssetId(r.url) === assetId),
    ...findUrlsByIdHint(`xpv_asset_id=${assetId}`),
  ];

  const pair = selectBestPair(urls);
  if (pair) {
    return { kind: "selection", selection: { kind: "merge", video: stripRangeParams(pair.video), audio: stripRangeParams(pair.audio) } };
  }
  // A progressive MP4 carries both tracks.
  const muxed = highestBitrate(urls.filter((r) => !instagramKindOf(r.url)));
  if (muxed) {
    return { kind: "selection", selection: { kind: "single", url: stripRangeParams(muxed), formKind: "muxed" } };
  }
  // With a single SourceBuffer the video has no audio track to wait for.
  const silent = ctx.clicked.formKind === "dash" ? undefined : highestBitrate(urls.filter((r) => instagramKindOf(r.url) === "video"));
  if (silent) {
    return { kind: "selection", selection: { kind: "single", url: stripRangeParams(silent), formKind: ctx.clicked.formKind } };
  }
  return { kind: "pending", reason: chrome.i18n.getMessage("waitingForInstagramSeparateTracks") };
}
