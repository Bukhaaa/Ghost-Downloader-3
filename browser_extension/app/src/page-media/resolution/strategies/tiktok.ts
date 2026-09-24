import {isTikTokVideoUrl} from "../url-classify";
import {newestBy} from "../strategy";
import {selectGeneric} from "./generic";
import type {AttributedUrlView, ResolveContext} from "../strategy";
import type {Resolution} from "../../types";

// TikTok's MSE duration runs ~0.15 s past the MP4's own.
const DURATION_TOLERANCE_S = 1;

// TikTok's player fetches one muxed MP4 per video and splits it into audio and video
// SourceBuffers itself (declaring the audio one as video/mp4), so formKind can't tell how many
// URLs to expect — and the feed keeps its neighbours preloaded, so the tab holds several MP4s.
export function selectTikTok(ctx: ResolveContext): Resolution {
  const { src, duration } = ctx.clicked;
  // The embed player plays the MP4 straight from <video src>.
  if (/^https?:/i.test(src)) {
    return { kind: "selection", selection: { kind: "single", url: src, formKind: "muxed" } };
  }

  const videos = ctx.clicked.attributedUrls.filter((r) => isTikTokVideoUrl(r.url));
  const isDurationKnown = (r: AttributedUrlView) => r.duration > 0 && duration > 0;
  const hasSameDuration = (r: AttributedUrlView) =>
    isDurationKnown(r) && Math.abs(r.duration - duration) <= DURATION_TOLERANCE_S;
  const byCapture = (r: AttributedUrlView) => r.capturedAt;
  // A feed loading its first two videos interleaves their appends and can swap the locks, so
  // a lock only counts when no known duration contradicts it.
  const chosen = newestBy(videos.filter((r) => r.isLockedByMse && hasSameDuration(r)), byCapture)
    ?? newestBy(videos.filter(hasSameDuration), byCapture)
    ?? newestBy(videos.filter((r) => r.isLockedByMse && !isDurationKnown(r)), byCapture);
  if (chosen) {
    return { kind: "selection", selection: { kind: "single", url: chosen.url, formKind: "muxed" } };
  }
  // Nothing ties a /video/tos/ MP4 to this player — a LIVE room, say.
  return selectGeneric(ctx);
}
