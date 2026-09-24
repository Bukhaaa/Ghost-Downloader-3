/*
 * Ghost Downloader — MSE attribution probe (MAIN world).
 * Proxy layout derived from cat-catch (catch-script/catch.js); upstream is GPL-3.0.
 * We post tagged, typed signals to the ISOLATED-world attribution engine instead of
 * capturing buffers. Built as a standalone IIFE bundle (see scripts/build.mjs).
 */
import {postMediaSignal} from "./attribution-signal";

declare global {
  interface Window {
    __gdMseAttributionInstalled?: boolean;
  }
}

type GhostXMLHttpRequest = XMLHttpRequest & { __gdUrl?: string };

(function installGhostDownloaderMseAttribution() {
  if (window.__gdMseAttributionInstalled) { return; }
  window.__gdMseAttributionInstalled = true;

  const mediaSourceIdByInstance = new WeakMap<MediaSource, string>();
  let mediaSourceCounter = 0;

  function mediaSourceId(mediaSource: MediaSource): string {
    let id = mediaSourceIdByInstance.get(mediaSource);
    if (id == null) {
      mediaSourceCounter += 1;
      id = `ms-${mediaSourceCounter}`;
      mediaSourceIdByInstance.set(mediaSource, id);
    }
    return id;
  }

  // Record blob URL → MediaSource so the attribution engine can attribute <video>.src to a MS.
  if (typeof window.URL?.createObjectURL === "function" && typeof window.MediaSource !== "undefined") {
    const originalCreateObjectUrl = window.URL.createObjectURL;
    window.URL.createObjectURL = function patchedCreateObjectURL(source: Blob | MediaSource): string {
      const url = originalCreateObjectUrl(source);
      if (source instanceof MediaSource) {
        postMediaSignal({ kind: "mse_objecturl", mediaSourceId: mediaSourceId(source), objectUrl: url });
      }
      return url;
    };
  }

  if (typeof window.MediaSource !== "undefined") {
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function patchedAddSourceBuffer(this: MediaSource, mimeType: string): SourceBuffer {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      const sourceId = mediaSourceId(this);
      postMediaSignal({ kind: "mse_source_buffer_added", mediaSourceId: sourceId, mimeType });
      try {
        const originalAppendBuffer = sourceBuffer.appendBuffer;
        sourceBuffer.appendBuffer = function patchedAppendBuffer(this: SourceBuffer, data: BufferSource): void {
          postMediaSignal({ kind: "mse_buffer_appended", mediaSourceId: sourceId, mimeType });
          return originalAppendBuffer.call(this, data);
        };
      } catch {
        // Frozen SourceBuffer prototype on some players.
      }
      return sourceBuffer;
    };
  }

  function probeStreamContent(response: Response, url: string): void {
    try {
      const contentLength = parseInt(response.headers.get("content-length") || "", 10);
      if (contentLength > 2_000_000) { return; }
      const reader = response.clone().body?.getReader();
      if (!reader) { return; }
      reader.read().then(({ value }) => {
        reader.cancel();
        if (!value || value[0] !== 0x23) { return; }
        const text = new TextDecoder().decode(value);
        if (!text.startsWith("#EXTM3U")) { return; }
        postMediaSignal({
          kind: "stream_detected",
          url,
          isMaster: text.includes("#EXT-X-STREAM-INF"),
        });
      }).catch(() => {});
    } catch { /* Opaque response — clone() throws. */ }
  }

  function fourccAt(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  // A faststart MP4 opens with ftyp then moov, whose first child mvhd holds the duration.
  // A mid-file range, a fragmented file or a moov at the tail yields 0.
  function parseMp4Duration(head: Uint8Array): number {
    if (head.length < 8 || fourccAt(head, 4) !== "ftyp") { return 0; }
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let offset = 0;
    while (offset + 16 <= head.length) {
      const boxSize = view.getUint32(offset);
      if (fourccAt(head, offset + 4) === "moov") {
        const mvhd = offset + 8;
        if (mvhd + 16 > head.length || fourccAt(head, mvhd + 4) !== "mvhd") { return 0; }
        const isVersion1 = view.getUint8(mvhd + 8) === 1;
        if (mvhd + (isVersion1 ? 40 : 28) > head.length) { return 0; }
        const timescale = view.getUint32(mvhd + (isVersion1 ? 28 : 20));
        const duration = isVersion1 ? Number(view.getBigUint64(mvhd + 32)) : view.getUint32(mvhd + 24);
        return timescale > 0 ? duration / timescale : 0;
      }
      if (boxSize < 8) { return 0; }
      offset += boxSize;
    }
    return 0;
  }

  // Two players loading at once interleave their fetches and buffer appends; each MP4's
  // duration is what tells their files apart.
  function probeMp4Duration(response: Response, url: string): void {
    try {
      if (!/^(video|audio)\/mp4/i.test(response.headers.get("content-type") ?? "")) { return; }
      const reader = response.clone().body?.getReader();
      if (!reader) { return; }
      reader.read().then(({ value }) => {
        reader.cancel();
        const duration = value ? parseMp4Duration(value) : 0;
        if (duration > 0) { postMediaSignal({ kind: "duration_detected", url, duration }); }
      }).catch(() => {});
    } catch { /* Opaque response — clone() throws. */ }
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input ?? "");
      const promise = originalFetch(input, init);
      promise.then((response) => {
        try {
          const resolvedUrl = response?.url || url;
          postMediaSignal({
            kind: "request_completed",
            url: resolvedUrl,
            contentType: response?.headers?.get?.("content-type") ?? "",
          });
          probeStreamContent(response, resolvedUrl);
          probeMp4Duration(response, resolvedUrl);
        } catch {
          // Opaque response.
        }
      }).catch(() => {});
      return promise;
    };
  }

  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(this: GhostXMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
      this.__gdUrl = String(url);
      return (originalOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function patchedSend(this: GhostXMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
      const xhr = this;
      xhr.addEventListener("loadend", () => {
        const resolvedUrl = xhr.responseURL || xhr.__gdUrl || "";
        try {
          postMediaSignal({
            kind: "request_completed",
            url: resolvedUrl,
            contentType: xhr.getResponseHeader?.("content-type") ?? "",
          });
        } catch {
          // Opaque response.
        }
        try {
          if ((xhr.responseType === "" || xhr.responseType === "text") && xhr.responseText?.startsWith("#EXTM3U")) {
            postMediaSignal({
              kind: "stream_detected",
              url: resolvedUrl,
              isMaster: xhr.responseText.includes("#EXT-X-STREAM-INF"),
            });
          }
        } catch { /* responseText throws on non-text responseType. */ }
      });
      return originalSend.call(this, body);
    };
  } catch {
    // Frozen XHR prototype on some players.
  }
})();
