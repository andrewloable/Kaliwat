import { Component, computed, inject, ViewChild } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { SearchService } from '../../core/search/search.service';
import { fold, matchesTerms } from '../../core/search/search-util';
import { MediaService } from '../../media/media.service';
import { PersonEditorComponent } from '../../ui/person-editor/person-editor';
import { Individual } from '../../core/model/types';

export interface ListRow {
  id: string;
  displayName: string;
  initials: string;
  subtitle: string;
  birthYear: string;
  deathYear: string;
  sortKey: string;
  searchKey: string;
  mediaId?: string;
}

function toRow(indi: Individual): ListRow {
  const n0 = indi.names[0];
  const name = n0?.full ?? '';
  const parts = name.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

  const birth = indi.events.find((e) => e.type === 'BIRT');
  const death = indi.events.find((e) => e.type === 'DEAT');
  const birthYear = birth?.date?.match(/\d{4}/)?.[0] ?? '';
  const deathYear = death?.date?.match(/\d{4}/)?.[0] ?? '';
  // Secondary line is a hint (birthplace), not the years — the years already
  // show right-aligned, so repeating them under the name was pure noise.
  const subtitle = birth?.place ?? '';
  const sortKey = `${n0?.surname ?? ''} ${n0?.given ?? name}`.trim().toLowerCase();

  return { id: indi.id, displayName: name || '(no name)', initials, subtitle, birthYear, deathYear, sortKey, searchKey: fold(name), mediaId: indi.mediaIds[0] };
}

@Component({
  selector: 'app-list',
  imports: [ScrollingModule, PersonEditorComponent],
  template: `
    <div class="list-shell">
      @if (store.importStatus().kind === 'importing') {
        <div class="importing-state" role="status" aria-live="polite">Importing…</div>
      }

      @if (store.importStatus().kind === 'success') {
        @let status = store.importStatus();
        @if (status.kind === 'success' && status.skipped > 0) {
          <div class="import-report" role="status">
            Imported {{ status.total }} people · {{ status.skipped }} lines skipped.
            <button class="report-dismiss" (click)="dismissReport()">Dismiss</button>
          </div>
        }
      }

      @if (store.isEmpty()) {
        <div class="empty-state">
          <div
            class="drop-zone"
            role="region"
            aria-label="Import a family tree"
            [class.drag-over]="isDragOver"
            (dragover)="onDragOver($event)"
            (dragleave)="isDragOver = false"
            (drop)="onDrop($event)"
          >
            <h1 class="drop-prompt">Begin with your family tree</h1>
            <button class="choose-btn" type="button" (click)="triggerPicker()">Choose a file…</button>
            <p class="format-hint">Accepts .ged and .gdz</p>
            <p class="try-sample">or <button class="sample-link" (click)="importSample()">try a sample tree</button></p>
            <hr class="divider" />
            <p class="onboarding-prompt">Starting from scratch?</p>
            <button class="start-btn" type="button" (click)="startWithYourself()">Start with yourself</button>
            <p class="privacy-note">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Your data never leaves this device.
            </p>
          </div>
        </div>
      } @else if (filtered().length === 0) {
        <h1 class="sr-only">People</h1>
        <div class="no-results" role="status">No people match "{{ search.query() }}"</div>
      } @else {
        <h1 class="sr-only">People</h1>
        <cdk-virtual-scroll-viewport itemSize="66" class="scroll-viewport">
          <div
            *cdkVirtualFor="let row of filtered(); trackBy: trackById"
            class="list-row"
            tabindex="0"
            [attr.aria-label]="row.displayName"
            (click)="editor.open(row.id)"
            (keydown.enter)="editor.open(row.id)"
          >
            @let photo = media.avatar(store.currentTreeId(), row.mediaId)();
            @if (photo) {
              <img class="avatar" [src]="photo" alt="" />
            } @else {
              <div class="avatar" aria-hidden="true">{{ row.initials }}</div>
            }
            <div class="row-body">
              <span class="row-name">{{ row.displayName }}</span>
              @if (row.subtitle) {
                <span class="row-hint">{{ row.subtitle }}</span>
              }
            </div>
            <span class="row-years" aria-label="Born {{ row.birthYear }} died {{ row.deathYear }}">
              {{ row.birthYear }}<span class="year-sep">–</span>{{ row.deathYear }}
            </span>
          </div>
        </cdk-virtual-scroll-viewport>
        <button class="add-person-btn" type="button" (click)="editor.open('new')" aria-label="Add person">+</button>
      }

      <input #filePicker type="file" accept=".ged,.gdz" style="display:none" (change)="onFilePicked($event)" aria-label="Choose GEDCOM file" />

      <app-person-editor #editor />
    </div>
  `,
  styles: [`
    .list-shell { display: flex; flex-direction: column; height: calc(100vh - 56px); position: relative; }

    .scroll-viewport { flex: 1; height: calc(100vh - 56px); }

    .importing-state {
      padding: 0.5rem 1.25rem;
      background: var(--paper-2);
      border-bottom: 1px solid var(--line);
      font-size: 0.875rem;
      color: var(--ink-soft);
    }

    .import-report {
      display: flex; align-items: center; gap: 1rem;
      padding: 0.5rem 1.25rem;
      background: #f3ead8;
      border-bottom: 1px solid var(--line);
      font-size: 0.875rem; color: var(--ink);
    }
    .report-dismiss {
      margin-left: auto; background: transparent; border: none;
      font-size: 0.8125rem; color: var(--ink-soft); cursor: pointer;
      text-decoration: underline;
    }

    .list-row {
      display: flex; align-items: center; gap: 0.875rem;
      padding: 12px 1.25rem;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
      &:hover { background: var(--card); }
      &:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
    }

    .avatar {
      flex-shrink: 0;
      width: 42px; height: 42px; border-radius: 50%;
      background: var(--paper-2);
      color: var(--ink-soft);
      font-family: var(--font-serif);
      font-size: 1rem;
      display: flex; align-items: center; justify-content: center;
      object-fit: cover; overflow: hidden;
    }

    .row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

    .row-name {
      font-family: var(--font-serif); font-size: 1.0625rem; color: var(--ink);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .row-hint { font-size: 0.875rem; color: var(--ink-soft); }

    .row-years {
      flex-shrink: 0;
      font-size: 0.875rem; color: var(--ink-soft);
      font-variant-numeric: tabular-nums; text-align: right;
    }
    .year-sep { margin: 0 1px; }

    /* Empty state / drop zone */
    .empty-state {
      display: flex; align-items: center; justify-content: center;
      height: calc(100vh - 56px);
    }
    .drop-zone {
      display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
      border: 2px dashed var(--line); border-radius: 10px;
      background: var(--paper-2);
      padding: 3rem 2.5rem;
      max-width: 380px; width: 90%; text-align: center;
      transition: border-color 0.15s, background 0.15s;
    }
    .drop-zone.drag-over {
      border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--paper-2));
    }
    .drop-prompt { font-family: var(--font-serif); font-size: 1.25rem; color: var(--ink); margin: 0; }
    .choose-btn {
      padding: 0.5rem 1.5rem; min-height: 48px;
      background: var(--accent); color: #fff;
      border: none; border-radius: 8px;
      font-family: var(--font-sans); font-size: 1rem; cursor: pointer;
    }
    .format-hint { font-size: 0.875rem; color: var(--ink-soft); margin: 0; }
    .try-sample { font-size: 0.875rem; color: var(--ink-soft); margin: 0; }
    .sample-link {
      background: transparent; border: none; padding: 0;
      color: var(--accent); cursor: pointer; text-decoration: underline; font-size: inherit;
    }
    .divider { width: 100%; border: none; border-top: 1px solid var(--line); margin: 0.25rem 0; }
    .onboarding-prompt { font-size: 0.875rem; color: var(--ink-soft); margin: 0; }
    .start-btn {
      padding: 0.5rem 1.25rem; min-height: 44px;
      background: var(--paper-2); color: var(--accent);
      border: 1.5px solid var(--accent); border-radius: 8px;
      font-family: var(--font-sans); font-size: 0.9375rem; cursor: pointer;
    }
    .privacy-note {
      display: flex; align-items: center; gap: 0.375rem;
      font-size: 0.8125rem; color: var(--ink-soft); margin: 0;
    }

    /* No-results */
    .no-results { padding: 2rem 1.25rem; color: var(--ink-soft); font-style: italic; }

    /* Add person FAB */
    .add-person-btn {
      position: fixed; bottom: 1.5rem; right: 1.5rem;
      width: 52px; height: 52px; border-radius: 50%;
      background: var(--accent); color: #fff; border: none;
      font-size: 1.75rem; line-height: 1; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
      &:hover { filter: brightness(1.08); }
    }
  `],
})
export class ListComponent {
  readonly store = inject(TreeStore);
  readonly search = inject(SearchService);
  readonly media = inject(MediaService);
  private readonly importService = inject(ImportService);

  @ViewChild(PersonEditorComponent) private editor!: PersonEditorComponent;

  isDragOver = false;

  readonly rows = computed(() =>
    this.store
      .individuals()
      .map(toRow)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
  );
  readonly filtered = computed(() => {
    const q = fold(this.search.query().trim());
    if (!q) return this.rows();
    return this.rows().filter((r) => matchesTerms(r.searchKey, q));
  });

  trackById(_: number, row: ListRow) { return row.id; }

  dismissReport(): void {
    this.store.importStatus.set({ kind: 'idle' });
  }

  triggerPicker(): void {
    (document.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
  }

  startWithYourself(): void {
    // Initialize a new tree if not already present
    if (!this.store.currentTreeId()) {
      const treeId = crypto.randomUUID();
      this.store.setTreeId(treeId);
      this.store.importStatus.set({ kind: 'success', treeId, total: 0, skipped: 0, warnings: [] });
    }
    this.editor.open('new');
  }

  onFilePicked(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.doImport(file);
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver = true;
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) this.doImport(file);
  }

  async importSample(): Promise<void> {
    const resp = await fetch('./sample.ged');
    const blob = await resp.blob();
    const file = new File([blob], 'sample.ged', { type: 'text/plain' });
    await this.doImport(file);
  }

  private async doImport(file: File): Promise<void> {
    await this.importService.importFile(file);
  }
}
