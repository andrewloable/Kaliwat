import { Component, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { EditService, PersonFormData } from '../../core/edit/edit.service';
import { Individual } from '../../core/model/types';

export interface ListRow {
  id: string;
  displayName: string;
  initials: string;
  lifespan: string;
  birthYear: string;
  deathYear: string;
}

function toRow(indi: Individual): ListRow {
  const name = indi.names[0]?.full ?? '';
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
  const lifespan = birthYear || deathYear ? `${birthYear}–${deathYear}` : '';

  return { id: indi.id, displayName: name || '(no name)', initials, lifespan, birthYear, deathYear };
}

function blankForm(): PersonFormData {
  return { given: '', surname: '', sex: 'U', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', notes: '' };
}

function indi2form(indi: Individual): PersonFormData {
  const n = indi.names[0];
  const birth = indi.events.find(e => e.type === 'BIRT');
  const death = indi.events.find(e => e.type === 'DEAT');
  return {
    given: n?.given ?? '', surname: n?.surname ?? '', sex: (indi.sex as 'M' | 'F' | 'U') ?? 'U',
    birthDate: birth?.date ?? '', birthPlace: birth?.place ?? '',
    deathDate: death?.date ?? '', deathPlace: death?.place ?? '',
    notes: indi.notes[0] ?? '',
  };
}

@Component({
  selector: 'app-list',
  imports: [ScrollingModule, FormsModule],
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
            <p class="drop-prompt">Begin with your family tree</p>
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
        <div class="no-results" role="status">No people match "{{ searchQuery }}"</div>
      } @else {
        <cdk-virtual-scroll-viewport itemSize="66" class="scroll-viewport">
          <div
            *cdkVirtualFor="let row of filtered(); trackBy: trackById"
            class="list-row"
            tabindex="0"
            [attr.aria-label]="row.displayName"
            (click)="openEdit(row.id)"
            (keydown.enter)="openEdit(row.id)"
          >
            <div class="avatar" aria-hidden="true">{{ row.initials }}</div>
            <div class="row-body">
              <span class="row-name">{{ row.displayName }}</span>
              <span class="row-hint">{{ row.lifespan }}</span>
            </div>
            <span class="row-years" aria-label="Born {{ row.birthYear }} died {{ row.deathYear }}">
              {{ row.birthYear }}<span class="year-sep">–</span>{{ row.deathYear }}
            </span>
          </div>
        </cdk-virtual-scroll-viewport>
        <button class="add-person-btn" type="button" (click)="openNew()" aria-label="Add person">+</button>
      }

      <input #filePicker type="file" accept=".ged,.gdz" style="display:none" (change)="onFilePicked($event)" aria-label="Choose GEDCOM file" />

      <!-- Edit panel (overlay) -->
      @if (editState() !== 'closed') {
        <div class="edit-backdrop" (click)="closeEdit()" aria-hidden="true"></div>
        <aside class="edit-panel" role="dialog" aria-modal="true" [attr.aria-label]="editState() === 'new' ? 'Add person' : 'Edit person'">
          <h2 class="panel-title">{{ editState() === 'new' ? 'Add person' : 'Edit person' }}</h2>
          <form class="edit-form" (ngSubmit)="saveEdit()">
            <div class="field-row">
              <label>
                Given name
                <input class="field-input" [(ngModel)]="form.given" name="given" required autocomplete="off" />
              </label>
              <label>
                Surname
                <input class="field-input" [(ngModel)]="form.surname" name="surname" autocomplete="off" />
              </label>
            </div>
            <label>
              Sex
              <select class="field-input" [(ngModel)]="form.sex" name="sex">
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="U">Unknown</option>
              </select>
            </label>
            <div class="field-group-label">Birth</div>
            <div class="field-row">
              <label>
                Date
                <input class="field-input" [(ngModel)]="form.birthDate" name="birthDate" placeholder="e.g. 15 JUN 1940" autocomplete="off" />
              </label>
              <label>
                Place
                <input class="field-input" [(ngModel)]="form.birthPlace" name="birthPlace" autocomplete="off" />
              </label>
            </div>
            <div class="field-group-label">Death</div>
            <div class="field-row">
              <label>
                Date
                <input class="field-input" [(ngModel)]="form.deathDate" name="deathDate" placeholder="e.g. 3 MAR 2010" autocomplete="off" />
              </label>
              <label>
                Place
                <input class="field-input" [(ngModel)]="form.deathPlace" name="deathPlace" autocomplete="off" />
              </label>
            </div>
            <label>
              Notes
              <textarea class="field-input field-textarea" [(ngModel)]="form.notes" name="notes" rows="3"></textarea>
            </label>
            @if (editError()) {
              <p class="edit-error" role="alert">{{ editError() }}</p>
            }
            <div class="panel-actions">
              <button class="cancel-btn" type="button" (click)="closeEdit()">Cancel</button>
              <button class="save-btn" type="submit">Save</button>
            </div>
          </form>
        </aside>
      }
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

    /* Edit panel */
    .edit-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.32);
      z-index: 100;
    }
    .edit-panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(420px, 100vw);
      background: var(--paper); z-index: 101;
      padding: 1.5rem 1.25rem;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 1rem;
      box-shadow: -4px 0 24px rgba(0,0,0,.12);
    }
    .panel-title { font-family: var(--font-serif); font-size: 1.375rem; margin: 0; color: var(--ink); }
    .edit-form { display: flex; flex-direction: column; gap: 0.875rem; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8125rem; color: var(--ink-soft); }
    .field-input {
      padding: 0.4rem 0.6rem; border: 1px solid var(--line);
      border-radius: 6px; background: var(--paper-2);
      font-size: 0.9375rem; color: var(--ink);
      &:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
    }
    .field-textarea { resize: vertical; min-height: 72px; font-family: var(--font-sans); }
    .field-group-label { font-size: 0.75rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; margin-top: 0.25rem; }
    .edit-error { font-size: 0.875rem; color: #c0392b; margin: 0; }
    .panel-actions { display: flex; gap: 0.75rem; justify-content: flex-end; padding-top: 0.25rem; }
    .cancel-btn {
      padding: 0.5rem 1rem; background: transparent;
      border: 1px solid var(--line); border-radius: 7px;
      font-size: 0.9375rem; cursor: pointer; color: var(--ink-soft);
    }
    .save-btn {
      padding: 0.5rem 1.25rem; background: var(--accent); color: #fff;
      border: none; border-radius: 7px;
      font-size: 0.9375rem; cursor: pointer;
      &:hover { filter: brightness(1.08); }
    }
  `],
})
export class ListComponent {
  readonly store = inject(TreeStore);
  private readonly importService = inject(ImportService);
  private readonly editService = inject(EditService);

  searchQuery = '';
  isDragOver = false;

  // 'closed' | 'new' | '<uuid>' (editing existing)
  readonly editState = signal<'closed' | 'new' | string>('closed');
  readonly editError = signal<string | null>(null);
  form: PersonFormData = blankForm();

  readonly rows = computed(() => this.store.individuals().map(toRow));
  readonly filtered = computed(() => {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return this.rows();
    return this.rows().filter((r) => r.displayName.toLowerCase().includes(q));
  });

  trackById(_: number, row: ListRow) { return row.id; }

  dismissReport(): void {
    this.store.importStatus.set({ kind: 'idle' });
  }

  triggerPicker(): void {
    (document.querySelector('input[type="file"]') as HTMLInputElement | null)?.click();
  }

  openNew(): void {
    this.form = blankForm();
    this.editError.set(null);
    this.editState.set('new');
  }

  openEdit(id: string): void {
    const indi = this.store.individuals().find(i => i.id === id);
    if (!indi) return;
    this.form = indi2form(indi);
    this.editError.set(null);
    this.editState.set(id);
  }

  closeEdit(): void { this.editState.set('closed'); }

  saveEdit(): void {
    if (!this.form.given.trim() && !this.form.surname.trim()) {
      this.editError.set('Please enter at least a given name or surname.');
      return;
    }
    const state = this.editState();
    if (state === 'new') {
      this.editService.createIndividual(this.form);
    } else {
      this.editService.updateIndividual(state, this.form);
    }
    this.closeEdit();
  }

  startWithYourself(): void {
    // Initialize a new tree if not already present
    if (!this.store.currentTreeId()) {
      const treeId = crypto.randomUUID();
      this.store.setTreeId(treeId);
      this.store.importStatus.set({ kind: 'success', treeId, total: 0, skipped: 0, warnings: [] });
    }
    this.form = blankForm();
    this.editError.set(null);
    this.editState.set('new');
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
