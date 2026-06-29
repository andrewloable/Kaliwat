import { ParseResult } from './gedcom-parser';

export interface ParserClient {
  parse(file: File): Promise<ParseResult>;
  abort(): void;
}

export function createParserClient(): ParserClient {
  let worker: Worker | null = null;

  return {
    parse(file: File): Promise<ParseResult> {
      worker?.terminate();
      worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });

      return new Promise<ParseResult>((resolve, reject) => {
        worker!.onmessage = (e: MessageEvent) => {
          const { type, payload } = e.data;
          worker!.terminate();
          worker = null;
          if (type === 'aborted') {
            resolve({ ast: [], report: [], aborted: true });
          } else {
            resolve(payload as ParseResult);
          }
        };
        worker!.onerror = (err) => {
          worker?.terminate();
          worker = null;
          reject(err);
        };
        file.arrayBuffer().then((buf) => {
          worker?.postMessage({ type: 'parse', payload: buf }, [buf]);
        }, reject);
      });
    },

    abort() {
      worker?.postMessage({ type: 'abort' });
    },
  };
}
