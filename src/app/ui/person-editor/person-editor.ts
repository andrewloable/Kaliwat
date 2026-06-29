import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeStore } from '../../core/tree-store/tree.store';
import { EditService, PersonFormData } from '../../core/edit/edit.service';
import { Individual } from '../../core/model/types';

function blankForm(): PersonFormData {
  return { given: '', surname: '', sex: 'U', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', notes: '' };
}

function indi2form(indi: Individual): PersonFormData {
  const n = indi.names[0];
  const birth = indi.events.find((e) => e.type === 'BIRT');
  const death = indi.events.find((e) => e.type === 'DEAT');
  return {
    given: n?.given ?? '', surname: n?.surname ?? '', sex: (indi.sex as 'M' | 'F' | 'U') ?? 'U',
    birthDate: birth?.date ?? '', birthPlace: birth?.place ?? '',
    deathDate: death?.date ?? '', deathPlace: death?.place ?? '',
    notes: indi.notes[0] ?? '',
  };
}

/**
 * Shared add/edit-person dialog. Hosted by both the list and the tree so a
 * person can be edited from either view. Call open('new') or open(personId).
 */
@Component({
  selector: 'app-person-editor',
  imports: [FormsModule],
  template: `
    @if (state() !== 'closed') {
      <div class="edit-backdrop" (click)="close()" aria-hidden="true"></div>
      <aside class="edit-panel" role="dialog" aria-modal="true" [attr.aria-label]="state() === 'new' ? 'Add person' : 'Edit person'">
        <h2 class="panel-title">{{ state() === 'new' ? 'Add person' : 'Edit person' }}</h2>
        <form class="edit-form" (ngSubmit)="save()">
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
          @if (error()) {
            <p class="edit-error" role="alert">{{ error() }}</p>
          }
          <div class="panel-actions">
            <button class="cancel-btn" type="button" (click)="close()">Cancel</button>
            <button class="save-btn" type="submit">Save</button>
          </div>
        </form>
      </aside>
    }
  `,
  styles: [`
    .edit-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 100; }
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
export class PersonEditorComponent {
  private readonly store = inject(TreeStore);
  private readonly editService = inject(EditService);

  // 'closed' | 'new' | '<person id>'
  readonly state = signal<'closed' | 'new' | string>('closed');
  readonly error = signal<string | null>(null);
  form: PersonFormData = blankForm();

  /** Open the dialog to add a new person ('new') or edit an existing one (id). */
  open(target: 'new' | string): void {
    this.error.set(null);
    if (target === 'new') {
      this.form = blankForm();
      this.state.set('new');
      return;
    }
    const indi = this.store.individuals().find((i) => i.id === target);
    if (!indi) return;
    this.form = indi2form(indi);
    this.state.set(target);
  }

  close(): void { this.state.set('closed'); }

  save(): void {
    if (!this.form.given.trim() && !this.form.surname.trim()) {
      this.error.set('Please enter at least a given name or surname.');
      return;
    }
    const state = this.state();
    if (state === 'new') this.editService.createIndividual(this.form);
    else this.editService.updateIndividual(state, this.form);
    this.close();
  }
}
