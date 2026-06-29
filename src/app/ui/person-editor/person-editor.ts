import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeStore } from '../../core/tree-store/tree.store';
import { EditService, PersonFormData } from '../../core/edit/edit.service';
import { MediaService } from '../../media/media.service';
import { MAX_MEDIA_BYTES } from '../../gedcom/gedzip/gedzip';
import { Individual, GedcomNode } from '../../core/model/types';

type ConnectKind = 'parent' | 'partner' | 'child';

interface PersonDetail {
  label: string;
  value: string;
  href?: string; // mailto:/tel:/https: when the value is actionable
}

function lifespan(indi: Individual): string {
  const y = (t: string) => indi.events.find((e) => e.type === t)?.date?.match(/\d{4}/)?.[0];
  const b = y('BIRT');
  const d = y('DEAT');
  return b || d ? `${b ?? '?'}–${d ?? ''}`.replace(/–$/, '') : '';
}

// GEDCOM escapes a literal '@' as '@@'.
const gedUnescape = (v: string) => v.replace(/@@/g, '@');

function walk(node: GedcomNode, fn: (n: GedcomNode) => void): void {
  for (const c of node.children) {
    fn(c);
    walk(c, fn);
  }
}

/** Friendly label for an EVEN "fact" whose value is a known social URL. */
export function factLabel(type: string, value: string): string {
  const v = value.toLowerCase();
  if (v.includes('facebook.com')) return 'Facebook';
  if (v.includes('twitter.com') || v.includes('x.com')) return 'Twitter / X';
  if (v.includes('instagram.com')) return 'Instagram';
  if (v.includes('linkedin.com')) return 'LinkedIn';
  return type || 'Fact';
}

/**
 * Pull contact details + extra facts out of a person's raw GEDCOM subtree:
 * EMAIL (often under RESI, which we don't model as an event), PHON, WWW, and
 * generic EVEN facts (e.g. a Facebook URL with `2 TYPE`).
 */
export function extractDetails(indi: Individual | null): PersonDetail[] {
  if (!indi?.rawRef) return [];
  const out: PersonDetail[] = [];
  const seen = new Set<string>();
  const add = (d: PersonDetail) => {
    const key = d.label + '|' + d.value;
    if (!seen.has(key)) { seen.add(key); out.push(d); }
  };
  walk(indi.rawRef, (n) => {
    if (!n.value) return;
    if (n.tag === 'EMAIL') {
      const email = gedUnescape(n.value);
      add({ label: 'Email', value: email, href: 'mailto:' + email });
    } else if (n.tag === 'PHON') {
      add({ label: 'Phone', value: n.value, href: 'tel:' + n.value.replace(/\s+/g, '') });
    } else if (n.tag === 'WWW') {
      add({ label: 'Website', value: n.value, href: n.value });
    } else if (n.tag === 'EVEN') {
      const value = gedUnescape(n.value);
      const type = n.children.find((c) => c.tag === 'TYPE')?.value ?? '';
      const isUrl = /^https?:\/\//i.test(value);
      add({ label: isUrl ? factLabel(type, value) : (type || 'Fact'), value, href: isUrl ? value : undefined });
    }
  });
  return out;
}

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
          @if (details().length) {
            <div class="field-group-label">Details</div>
            <ul class="details-list">
              @for (d of details(); track $index) {
                <li class="detail-row">
                  <span class="detail-label">{{ d.label }}</span>
                  @if (d.href) {
                    <a class="detail-value" [href]="d.href" target="_blank" rel="noopener noreferrer">{{ d.value }}</a>
                  } @else {
                    <span class="detail-value">{{ d.value }}</span>
                  }
                </li>
              }
            </ul>
          }
          @if (state() !== 'new') {
            <div class="field-group-label">Photo</div>
            <div class="photo-row">
              @if (photoUrl(); as url) {
                <img class="photo-thumb" [src]="url" alt="Photo of this person" />
              } @else {
                <div class="photo-placeholder" aria-hidden="true">No photo</div>
              }
              <div class="photo-actions">
                <label class="rel-btn photo-pick">
                  {{ photoUrl() ? 'Replace photo' : 'Add photo' }}
                  <input type="file" accept="image/*" hidden (change)="onPickPhoto($event)" />
                </label>
                @if (photoUrl()) {
                  <button type="button" class="delete-link" (click)="onRemovePhoto()">Remove photo</button>
                }
              </div>
            </div>
          }
          @if (state() !== 'new') {
            <div class="field-group-label">Add relative</div>
            <div class="relatives">
              <button type="button" class="rel-btn" (click)="addRelative('parent')">+ Parent</button>
              <button type="button" class="rel-btn" (click)="addRelative('spouse')">+ Spouse</button>
              <button type="button" class="rel-btn" (click)="addRelative('sibling')">+ Sibling</button>
              <button type="button" class="rel-btn" (click)="addRelative('child')">+ Child</button>
            </div>
          }
          @if (state() !== 'new') {
            <div class="field-group-label">Connect existing person</div>
            @if (!connectKind()) {
              <div class="relatives">
                <button type="button" class="rel-btn" (click)="startConnect('parent')">As parent</button>
                <button type="button" class="rel-btn" (click)="startConnect('partner')">As partner</button>
                <button type="button" class="rel-btn" (click)="startConnect('child')">As child</button>
              </div>
            } @else {
              <div class="connect-picker">
                <input #cq class="field-input" type="search" autocomplete="off"
                  [value]="connectQuery()" (input)="connectQuery.set(cq.value)"
                  [attr.placeholder]="'Search someone to connect as ' + connectKind() + '…'" />
                <ul class="connect-results">
                  @for (c of connectCandidates(); track c.id) {
                    <li>
                      <button type="button" class="connect-item" (click)="connectTo(c.id)">
                        <span class="ci-name">{{ c.name }}</span>
                        <span class="ci-years">{{ c.years }}</span>
                      </button>
                    </li>
                  } @empty {
                    <li class="ci-empty">No matching people</li>
                  }
                </ul>
                <button type="button" class="keep-btn" (click)="cancelConnect()">Cancel</button>
              </div>
            }
          }
          <div class="panel-actions">
            <button class="cancel-btn" type="button" (click)="close()">Cancel</button>
            <button class="save-btn" type="submit">Save</button>
          </div>
          @if (state() !== 'new') {
            <div class="danger-row">
              @if (!confirmingDelete()) {
                <button type="button" class="delete-link" (click)="confirmingDelete.set(true)">Delete this person</button>
              } @else {
                <span class="confirm-text">Delete permanently?</span>
                <button type="button" class="confirm-delete" (click)="deletePerson()">Delete</button>
                <button type="button" class="keep-btn" (click)="confirmingDelete.set(false)">Keep</button>
              }
            </div>
          }
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
    .details-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
    .detail-row { display: flex; flex-direction: column; gap: 1px; }
    .detail-label { font-size: 0.75rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .04em; }
    .detail-value { font-size: 0.9375rem; color: var(--ink); word-break: break-word; }
    a.detail-value { color: var(--accent); text-decoration: underline; }
    .relatives { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .rel-btn {
      padding: 0.4rem 0.75rem; background: var(--paper-2);
      border: 1px solid var(--line); border-radius: 7px;
      font-size: 0.875rem; color: var(--ink); cursor: pointer;
      &:hover { border-color: var(--accent); color: var(--accent); }
    }
    .photo-row { display: flex; align-items: center; gap: 0.875rem; }
    .photo-thumb {
      width: 72px; height: 72px; object-fit: cover;
      border-radius: 8px; border: 1px solid var(--line); background: var(--paper-2);
    }
    .photo-placeholder {
      width: 72px; height: 72px; display: flex; align-items: center; justify-content: center;
      border-radius: 8px; border: 1px dashed var(--line); background: var(--paper-2);
      font-size: 0.75rem; color: var(--ink-soft); text-align: center;
    }
    .photo-actions { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
    .photo-pick { cursor: pointer; }
    .danger-row {
      display: flex; align-items: center; gap: 0.625rem;
      margin-top: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--line);
    }
    .delete-link {
      background: none; border: none; padding: 0; cursor: pointer;
      font-size: 0.875rem; color: #a23b2d; text-decoration: underline;
    }
    .confirm-text { font-size: 0.875rem; color: var(--ink); }
    .confirm-delete {
      padding: 0.35rem 0.85rem; background: #a23b2d; color: #fff;
      border: none; border-radius: 7px; font-size: 0.875rem; cursor: pointer;
      &:hover { filter: brightness(1.08); }
    }
    .keep-btn {
      padding: 0.35rem 0.75rem; background: transparent; color: var(--ink-soft);
      border: 1px solid var(--line); border-radius: 7px; font-size: 0.875rem; cursor: pointer;
    }
    .connect-picker { display: flex; flex-direction: column; gap: 0.5rem; }
    .connect-results {
      list-style: none; margin: 0; padding: 0;
      max-height: 200px; overflow-y: auto;
      border: 1px solid var(--line); border-radius: 7px; background: var(--card);
    }
    .connect-item {
      display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem;
      width: 100%; padding: 0.45rem 0.7rem;
      background: transparent; border: none; border-bottom: 1px solid var(--line);
      text-align: left; cursor: pointer;
      &:hover { background: var(--paper-2); }
    }
    .ci-name { font-family: var(--font-serif); font-size: 0.95rem; color: var(--ink); }
    .ci-years { font-size: 0.8125rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
    .ci-empty { padding: 0.6rem 0.7rem; font-size: 0.875rem; color: var(--ink-soft); font-style: italic; }
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
  protected readonly media = inject(MediaService);

  /** The person's primary photo as a local object URL, or null. */
  readonly photoUrl = computed(() => {
    const id = this.state();
    if (id === 'closed' || id === 'new') return null;
    const indi = this.store.individuals().find((i) => i.id === id);
    return this.media.avatar(this.store.currentTreeId(), indi?.mediaIds[0])();
  });

  // 'closed' | 'new' | '<person id>'
  readonly state = signal<'closed' | 'new' | string>('closed');
  readonly error = signal<string | null>(null);
  readonly confirmingDelete = signal(false);
  form: PersonFormData = blankForm();

  // Contact details + extra facts (email, Facebook, …) read from the raw record.
  readonly details = computed(() => {
    const id = this.state();
    if (id === 'closed' || id === 'new') return [];
    return extractDetails(this.store.individuals().find((i) => i.id === id) ?? null);
  });

  // Connect-to-existing-person picker.
  readonly connectKind = signal<ConnectKind | null>(null);
  readonly connectQuery = signal('');
  readonly connectCandidates = computed(() => {
    const current = this.state();
    const q = this.connectQuery().toLowerCase().trim();
    return this.store.individuals()
      .filter((i) => i.id !== current)
      .map((i) => ({ id: i.id, name: i.names[0]?.full || '(no name)', years: lifespan(i) }))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  });

  /** Open the dialog to add a new person ('new') or edit an existing one (id). */
  open(target: 'new' | string): void {
    this.error.set(null);
    this.confirmingDelete.set(false);
    this.connectKind.set(null);
    this.connectQuery.set('');
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

  close(): void {
    this.confirmingDelete.set(false);
    this.connectKind.set(null);
    this.connectQuery.set('');
    this.state.set('closed');
  }

  /** Delete the person being edited (after the inline confirm). */
  deletePerson(): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    this.editService.deleteIndividual(id);
    this.close();
  }

  /** Create a blank relative wired to the person being edited, then switch the
   *  editor to the new person so the user can name them. */
  addRelative(kind: 'parent' | 'spouse' | 'sibling' | 'child'): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    const newId =
      kind === 'parent' ? this.editService.addParent(id)
      : kind === 'spouse' ? this.editService.addSpouse(id)
      : kind === 'sibling' ? this.editService.addSibling(id)
      : this.editService.addChild(id);
    this.open(newId);
  }

  /** Add or replace the edited person's photo from a chosen image file. */
  async onPickPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file later
    const id = this.state();
    if (!file || id === 'closed' || id === 'new') return;
    if (!file.type.startsWith('image/')) { this.error.set('Please choose an image file.'); return; }
    if (file.size > MAX_MEDIA_BYTES) {
      this.error.set(`Image too large (max ${Math.round(MAX_MEDIA_BYTES / 1e6)} MB).`);
      return;
    }
    this.error.set(null);
    await this.editService.setPhoto(id, file);
  }

  /** Remove the edited person's photo. */
  async onRemovePhoto(): Promise<void> {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    await this.editService.removePhoto(id);
  }

  startConnect(kind: ConnectKind): void {
    this.error.set(null);
    this.connectQuery.set('');
    this.connectKind.set(kind);
  }

  cancelConnect(): void {
    this.connectKind.set(null);
    this.connectQuery.set('');
  }

  /** Link the person being edited to an existing person by the chosen role. */
  connectTo(otherId: string): void {
    const id = this.state();
    const kind = this.connectKind();
    if (id === 'closed' || id === 'new' || !kind) return;
    const err =
      kind === 'parent' ? this.editService.addParentChild(otherId, id)   // other is parent of current
      : kind === 'child' ? this.editService.addParentChild(id, otherId)  // current is parent of other
      : this.editService.linkSpouses(id, otherId);                       // partner
    if (err) {
      this.error.set(err.message);
    } else {
      this.cancelConnect();
    }
  }

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
