import { Component, OnDestroy, OnInit, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import {
  CROP_MAX_ZOOM, CROP_OUT, CROP_VIEW, clampOffset, coverScale, cropSource, zoomAt,
} from './crop-math';

const QUALITY = 0.85;

/**
 * "Adjust photo" dialog: the person drags the image and zooms until the face fills the
 * square, then only that square is saved (400×400, WebP or JPEG) — smaller to store and
 * the face is easy to see. Nothing leaves the browser.
 */
@Component({
  selector: 'app-photo-crop',
  template: `
    <div class="crop-backdrop" (click)="cancelled.emit()" aria-hidden="true"></div>
    <div class="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <h2 id="crop-title">Adjust photo</h2>
      @if (error()) {
        <p class="crop-error" role="alert">{{ error() }}</p>
      } @else {
        <p class="crop-hint">Drag to move, scroll or use the slider to zoom. The circle shows how it appears on cards.</p>
        <div class="crop-view" tabindex="0" aria-label="Photo crop area. Arrow keys move, plus and minus zoom."
          [style.width.px]="VIEW" [style.height.px]="VIEW"
          (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)"
          (wheel)="wheel($event)" (keydown)="key($event)">
          @if (url()) {
            <img [src]="url()" alt="" draggable="false"
              [style.width.px]="iw() * scale()" [style.height.px]="ih() * scale()"
              [style.left.px]="tx()" [style.top.px]="ty()" />
          }
          <div class="crop-ring" aria-hidden="true"></div>
        </div>
        <label class="crop-zoom">Zoom
          <input type="range" min="1" [max]="MAX" step="0.01" [value]="zoom()"
            aria-label="Zoom" (input)="setZoom(+$any($event.target).value)" />
        </label>
      }
      <div class="crop-actions">
        <button type="button" class="crop-cancel" (click)="cancelled.emit()">Cancel</button>
        @if (!error()) {
          <button type="button" class="crop-save" [disabled]="!ready() || saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Use photo' }}
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .crop-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 110; }
    .crop-dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 111;
      width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem;
      display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
    }
    h2 { font-family: var(--font-serif); font-size: 1.25rem; margin: 0; color: var(--ink); align-self: flex-start; }
    .crop-hint { margin: 0; font-size: 0.8125rem; color: var(--ink-soft); align-self: flex-start; }
    .crop-error { margin: 0; color: #a23b2d; align-self: flex-start; }
    .crop-view {
      position: relative; overflow: hidden; border-radius: 6px; background: var(--paper-2);
      cursor: grab; touch-action: none; user-select: none;
      &:active { cursor: grabbing; }
      &:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    }
    .crop-view img { position: absolute; max-width: none; pointer-events: none; }
    .crop-ring {
      position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
      border: 2px solid rgba(255,255,255,.9); box-shadow: 0 0 0 999px rgba(0,0,0,.35);
    }
    .crop-zoom { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8125rem; color: var(--ink-soft); width: 100%; }
    .crop-zoom input { flex: 1; accent-color: var(--accent); }
    .crop-actions { display: flex; gap: 0.75rem; justify-content: flex-end; width: 100%; }
    .crop-cancel {
      padding: 0.45rem 1rem; background: transparent; color: var(--ink);
      border: 1px solid var(--line); border-radius: 7px; cursor: pointer;
    }
    .crop-save {
      padding: 0.45rem 1.1rem; background: var(--accent); color: #fff; border: none; border-radius: 7px; cursor: pointer;
      &:disabled { opacity: .5; cursor: default; }
    }
  `],
})
export class PhotoCropComponent implements OnInit, OnDestroy {
  readonly file = input.required<Blob>();
  readonly done = output<Blob>();
  readonly cancelled = output<void>();

  protected readonly VIEW = CROP_VIEW;
  protected readonly MAX = CROP_MAX_ZOOM;

  readonly url = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly ready = signal(false);
  readonly saving = signal(false);
  readonly iw = signal(0);
  readonly ih = signal(0);
  readonly zoom = signal(1);
  readonly scale = signal(1);
  readonly tx = signal(0);
  readonly ty = signal(0);

  private img: HTMLImageElement | null = null;
  private drag: { id: number; x: number; y: number } | null = null;

  async ngOnInit(): Promise<void> {
    const objectUrl = URL.createObjectURL(this.file());
    this.url.set(objectUrl);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      this.img = img;
      this.iw.set(img.naturalWidth);
      this.ih.set(img.naturalHeight);
      const base = coverScale(img.naturalWidth, img.naturalHeight);
      this.scale.set(base);
      // start centred
      this.tx.set(clampOffset((CROP_VIEW - img.naturalWidth * base) / 2, img.naturalWidth * base));
      this.ty.set(clampOffset((CROP_VIEW - img.naturalHeight * base) / 2, img.naturalHeight * base));
      this.ready.set(true);
    } catch {
      this.error.set("This image can't be read. Try a JPG, PNG or WebP photo.");
    }
  }

  ngOnDestroy(): void {
    const u = this.url();
    if (u) URL.revokeObjectURL(u);
  }

  private base(): number {
    return coverScale(this.iw(), this.ih());
  }

  /** Zoom to z (1…MAX) keeping the point (fx, fy) in the view fixed. */
  private applyZoom(z: number, fx = CROP_VIEW / 2, fy = CROP_VIEW / 2): void {
    const zz = Math.min(CROP_MAX_ZOOM, Math.max(1, z));
    const next = this.base() * zz;
    const o = zoomAt(this.iw(), this.ih(), this.scale(), this.tx(), this.ty(), next, fx, fy);
    this.zoom.set(zz);
    this.scale.set(next);
    this.tx.set(o.tx);
    this.ty.set(o.ty);
  }

  setZoom(z: number): void {
    if (this.ready()) this.applyZoom(z);
  }

  private pan(dx: number, dy: number): void {
    this.tx.set(clampOffset(this.tx() + dx, this.iw() * this.scale()));
    this.ty.set(clampOffset(this.ty() + dy, this.ih() * this.scale()));
  }

  down(e: PointerEvent): void {
    if (!this.ready()) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  move(e: PointerEvent): void {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    this.pan(e.clientX - this.drag.x, e.clientY - this.drag.y);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  up(e: PointerEvent): void {
    if (this.drag?.id === e.pointerId) this.drag = null;
  }

  wheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.ready()) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.applyZoom(this.zoom() * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  }

  key(e: KeyboardEvent): void {
    const step = 12;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    if (moves[e.key]) { e.preventDefault(); this.pan(...moves[e.key]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); this.setZoom(this.zoom() + 0.2); }
    else if (e.key === '-') { e.preventDefault(); this.setZoom(this.zoom() - 0.2); }
  }

  /** Crop the visible square out of the original image and emit it. */
  async save(): Promise<void> {
    const img = this.img;
    if (!img || this.saving()) return;
    this.saving.set(true);
    try {
      const { sx, sy, side } = cropSource(this.scale(), this.tx(), this.ty());
      const draw = (whiteBackground: boolean) => {
        const canvas = document.createElement('canvas');
        canvas.width = CROP_OUT;
        canvas.height = CROP_OUT;
        const ctx = canvas.getContext('2d')!;
        if (whiteBackground) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CROP_OUT, CROP_OUT); }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP_OUT, CROP_OUT);
        return canvas;
      };
      const toBlob = (c: HTMLCanvasElement, type: string) =>
        new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, QUALITY));
      let blob = await toBlob(draw(false), 'image/webp');
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(draw(true), 'image/jpeg'); // no WebP encoder
      if (!blob) throw new Error('encode failed');
      this.done.emit(blob);
    } catch {
      this.error.set("Couldn't save the cropped photo. Please try another image.");
    } finally {
      this.saving.set(false);
    }
  }
}
