import { parseGedcomBytes, MAX_BYTES } from './gedcom-parser';

let aborted = false;

self.addEventListener('message', (e: MessageEvent) => {
  const { type, payload } = e.data as { type: string; payload: unknown };

  if (type === 'abort') {
    aborted = true;
    self.postMessage({ type: 'aborted' });
    return;
  }

  if (type === 'parse') {
    aborted = false;
    const buffer = payload as ArrayBuffer;

    if (buffer.byteLength > MAX_BYTES) {
      self.postMessage({
        type: 'result',
        payload: {
          ast: [],
          report: [{ message: `File exceeds maximum size of ${MAX_BYTES / 1024 / 1024} MB` }],
          aborted: true,
        },
      });
      return;
    }

    const bytes = new Uint8Array(buffer);
    const result = parseGedcomBytes(bytes);

    if (aborted) {
      self.postMessage({ type: 'aborted' });
      return;
    }

    self.postMessage({ type: 'result', payload: result });
  }
});
