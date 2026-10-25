import { Component, ElementRef, HostListener, Injector, afterNextRender, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ExportService } from '../../export/export.service';
import type { PageFormat } from '../../export/chart-export';

type Kind = 'file' | 'pdf' | 'svg' | 'jpg';
const LABEL: Record<Kind, string> = { file: 'file', pdf: 'PDF', svg: 'SVG', jpg: 'JPG' };

/**
 * Drop-down under the top bar's Export button: the GEDCOM file, plus the tree
 * chart (whole drawing of the current tree view) as PDF, SVG or JPG.
 */
@Component({
  selector: 'app-export-menu',
  template: `
    @if (isOpen()) {
      <div class="menu-backdrop" (click)="close(true)" aria-hidden="true"></div>
      <div class="menu" role="group" aria-label="Export options">
        <button type="button" class="item" [disabled]="!!busy()" (click)="run('file')">
          <span class="title">Family tree file</span>
          <span class="hint">.gdz with photos, else .ged</span>
        </button>

        <div class="section">Chart · current tree view</div>
        @if (!exportService.chart()) {
          <p class="note">Open the Tree view to export the chart.</p>
        }
        <div class="pdf-row">
          <button type="button" class="item" [disabled]="!chartReady()" (click)="run('pdf')">
            <span class="title">PDF</span>
            <span class="hint">printable pages</span>
          </button>
          <select aria-label="PDF page size" [disabled]="!chartReady()"
            [value]="pdfSize()" (change)="pdfSize.set($any($event.target).value)">
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="a2">A2</option>
            <option value="letter">Letter</option>
            <option value="legal">Legal</option>
            <option value="tabloid">Tabloid</option>
          </select>
        </div>
        <button type="button" class="item" [disabled]="!chartReady()" (click)="run('svg')">
          <span class="title">SVG image</span>
          <span class="hint">vector, sharp at any zoom</span>
        </button>
        <button type="button" class="item" [disabled]="!chartReady()" (click)="run('jpg')">
          <span class="title">JPG image</span>
          <span class="hint">high resolution, one image</span>
        </button>

        @if (busy()) {
          <p class="note" role="status">Exporting {{ busy() }}…</p>
        }
        @if (error()) {
          <p class="note error" role="alert">{{ error() }}</p>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .menu-backdrop { position: fixed; inset: 0; z-index: 90; }
    .menu {
      position: fixed; top: 60px; right: 0.75rem; z-index: 91;
      width: min(300px, calc(100vw - 1.5rem));
      display: flex; flex-direction: column; gap: 2px; padding: 0.4rem;
      background: var(--card); border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.12);
    }
    .item {
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px; flex: 1;
      padding: 0.5rem 0.65rem; min-height: 44px; text-align: left;
      background: none; border: none; border-radius: 7px; cursor: pointer; color: var(--ink);
      &:hover:not(:disabled) { background: var(--paper-2); }
      &:disabled { opacity: .45; cursor: default; }
    }
    .title { font-size: 0.9375rem; }
    .hint { font-size: 0.75rem; color: var(--ink-soft); }
    .section {
      margin: 0.4rem 0.65rem 0.1rem; font-size: 0.6875rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .05em; color: var(--ink-soft);
    }
    .pdf-row { display: flex; align-items: center; gap: 0.4rem; }
    select {
      padding: 0.25rem 0.4rem; border: 1px solid var(--line); border-radius: 6px;
      background: var(--paper); color: var(--ink); font-size: 1rem;
    }
    .note { margin: 0.25rem 0.65rem; font-size: 0.8125rem; color: var(--ink-soft); }
    .error { color: #a23b2d; }
  `],
})
export class ExportMenuComponent {
  protected readonly exportService = inject(ExportService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  // The button that opened the menu: Escape and an outside click give focus back to it.
  private opener: HTMLElement | null = null;

  readonly isOpen = signal(false);
  readonly busy = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly pdfSize = signal<PageFormat>('a4');
  readonly chartReady = computed(() => !!this.exportService.chart() && !this.busy());

  toggle(): void {
    this.error.set(null);
    if (this.isOpen()) return this.close();
    this.opener = document.activeElement as HTMLElement | null;
    this.isOpen.set(true);
    afterNextRender(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.menu button:not([disabled])')?.focus(), { injector: this.injector });
  }

  close(restoreFocus = false): void {
    this.isOpen.set(false);
    if (restoreFocus) this.opener?.focus();
    this.opener = null;
  }

  // Escape closes the menu wherever focus is (it is not modal, so focus may have left it).
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close(true);
  }

  async run(kind: Kind): Promise<void> {
    const chart = this.exportService.chart();
    if (this.busy() || (kind !== 'file' && !chart)) return;
    this.busy.set(LABEL[kind]);
    this.error.set(null);
    try {
      if (kind === 'file') {
        await this.exportService.export();
      } else {
        const chartExport = await import('../../export/chart-export'); // lazy: only when used
        if (kind === 'pdf') await chartExport.exportTreePdf(chart!, this.pdfSize());
        else if (kind === 'svg') await chartExport.exportTreeSvg(chart!);
        else await chartExport.exportTreeJpg(chart!);
      }
      this.close();
    } catch (e) {
      this.error.set(`Export failed: ${(e as Error).message || e}`);
    } finally {
      this.busy.set(null);
    }
  }
}
