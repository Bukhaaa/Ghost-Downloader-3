function fourccAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

// An MP4's length from its first bytes. A faststart file opens with ftyp then moov, whose mvhd
// holds the duration; a fragmented one (DASH) leaves that 0 and states it in moov/mvex/mehd.
// A mid-file range or a moov at the tail yields 0.
export function parseMp4Duration(head: Uint8Array): number {
  if (head.length < 8 || fourccAt(head, 4) !== "ftyp") { return 0; }
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  // The payload of the first `type` box in [start, end), cut short where the head ends.
  const payloadOf = (type: string, start: number, end: number): [number, number] | null => {
    for (let offset = start; offset + 8 <= end;) {
      const size = view.getUint32(offset);
      if (size < 8) { return null; }
      if (fourccAt(head, offset + 4) === type) { return [offset + 8, Math.min(offset + size, end)]; }
      offset += size;
    }
    return null;
  };
  const moov = payloadOf("moov", 0, head.length);
  const mvhd = moov && payloadOf("mvhd", ...moov);
  if (!moov || !mvhd) { return 0; }
  const [at] = mvhd;
  const isVersion1 = view.getUint8(at) === 1;
  if (at + (isVersion1 ? 32 : 20) > head.length) { return 0; }
  const timescale = view.getUint32(at + (isVersion1 ? 20 : 12));
  const fragmentDuration = (): number => {
    const mvex = payloadOf("mvex", ...moov);
    const mehd = mvex && payloadOf("mehd", ...mvex);
    if (!mehd) { return 0; }
    const isMehdVersion1 = view.getUint8(mehd[0]) === 1;
    if (mehd[0] + (isMehdVersion1 ? 12 : 8) > head.length) { return 0; }
    return isMehdVersion1 ? Number(view.getBigUint64(mehd[0] + 4)) : view.getUint32(mehd[0] + 4);
  };
  const duration = (isVersion1 ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16)) || fragmentDuration();
  return timescale > 0 ? duration / timescale : 0;
}
