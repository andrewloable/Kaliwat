import { Component, ElementRef, OnDestroy, afterNextRender, computed, inject, input, output, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeStore } from '../../core/tree-store/tree.store';
import { EditService, validateFact } from '../../core/edit/edit.service';
import { RelativeKind, relativeDefaults } from '../../core/edit/relative-defaults';
import { PhotoCropComponent } from '../photo-crop/photo-crop';
import { MAX_MEDIA_BYTES } from '../../gedcom/gedzip/gedzip';

type Sex = 'M' | 'F' | 'U';

/**
 * Add a parent, spouse, sibling or child in one small form: names, sex, Facebook, photo.
 * Nothing is created until Save; Cancel leaves the tree untouched.
 */
@Component({
  selector: 'app-quick-add-relative',
  imports: [FormsModule, PhotoCropComponent],
  host: { class: 'quick-add' },
  template: `
    <h2 class="panel-title">Add {{ kind() }} of {{ anchorName() }}</h2>
    <form class="qa-form" (ngSubmit)="save(false)">
      <div class="photo-row">
        @if (photoUrl(); as url) {
          <img class="photo-thumb" [src]="url" alt="Chosen photo" />
        } @else {
          <div class="photo-placeholder" aria-hidden="true">No photo</div>
        }
        <div class="photo-actions">
          <label class="rel-btn photo-pick">
            {{ photoUrl() ? 'Replace photo' : 'Add photo' }}
            <input type="file" accept="image/*" hidden (change)="onPick($event)" />
          </label>
          @if (photoUrl()) {
            <button type="button" class="delete-link" (click)="photo.set(null)">Remove photo</button>
          }
        </div>
      </div>

      @if (families().length > 1) {
        <label>
          Other parent
          <select class="field-input" aria-label="Other parent" name="otherParent" [value]="unionId()" (change)="onUnion($any($event.target).value)">
            <option value="">Choose…</option>
            @for (f of families(); track f.id) {
              <option [value]="f.id">{{ f.label }}</option>
            }
          </select>
        </label>
      }

      <div class="field-row">
        <label>
          Given name
          <input #given class="field-input" name="given" autocomplete="off" [value]="givenName()" (input)="givenName.set(given.value)" />
        </label>
        <label>
          Surname
          <input #sur class="field-input" name="surname" autocomplete="off" [value]="surname()" (input)="surname.set(sur.value); surnameTouched = true" />
        </label>
      </div>

      <fieldset class="sex">
        <legend>Sex</legend>
        @for (o of sexOptions; track o.v) {
          <label class="sex-opt">
            <input type="radio" name="sex" [value]="o.v" [checked]="sex() === o.v" (change)="sex.set(o.v)" />
            <span>{{ o.label }}</span>
          </label>
        }
      </fieldset>
      @if (sex() === 'U' && (kind() === 'child' || kind() === 'sibling')) {
        <p class="hint">Pick Male or Female so the tree draws the family correctly.</p>
      }

      <label>
        Facebook (optional)
        <input class="field-input" name="facebook" type="url" inputmode="url" autocomplete="off"
          placeholder="facebook.com/name" [value]="facebook()" (input)="facebook.set(fb.value)" #fb />
      </label>

      @if (error()) {
        <p class="edit-error" role="alert">{{ error() }}</p>
      }
      @if (status()) {
        <p class="hint" role="status">{{ status() }}</p>
      }
      <div class="panel-actions">
        <button class="cancel-btn" type="button" (click)="cancelled.emit()">Cancel</button>
        <button class="cancel-btn" type="button" [disabled]="busy()" (click)="save(true)">Save &amp; add another</button>
        <button class="save-btn" type="submit" [disabled]="busy()">Save</button>
      </div>
    </form>
    @if (cropFile(); as f) {
      <app-photo-crop [file]="f" (done)="onCropped($event)" (cancelled)="cropFile.set(null)" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 1rem; }
    .panel-title { font-family: var(--font-serif); font-size: 1.375rem; margin: 0; color: var(--ink); }
    .qa-form { display: flex; flex-direction: column; gap: 0.875rem; }
    .field-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; }
    label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8125rem; color: var(--ink-soft); }
    .field-input {
      min-width: 0; padding: 0.4rem 0.6rem; border: 1px solid var(--line); border-radius: 6px;
      background: var(--paper-2); font-size: 1rem; color: var(--ink);
      &:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
    }
    .sex { display: flex; gap: 0.5rem; border: none; margin: 0; padding: 0; }
    .sex legend { font-size: 0.8125rem; color: var(--ink-soft); padding: 0; margin-bottom: 0.3rem; }
    .sex-opt {
      flex: 1; flex-direction: row; align-items: center; justify-content: center; gap: 0.4rem;
      min-height: 44px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper-2);
      font-size: 0.9375rem; color: var(--ink); cursor: pointer;
      &:has(input:checked) { border-color: var(--accent); color: var(--accent); }
    }
    .hint { margin: 0; font-size: 0.8125rem; color: var(--ink-soft); }
    .edit-error { font-size: 0.875rem; color: #c0392b; margin: 0; }
    .rel-btn {
      padding: 0.4rem 0.75rem; background: var(--paper-2); border: 1px solid var(--line); border-radius: 7px;
      font-size: 0.875rem; color: var(--ink); cursor: pointer;
    }
    .photo-row { display: flex; align-items: center; gap: 0.875rem; }
    .photo-thumb { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
    .photo-placeholder {
      width: 72px; height: 72px; display: flex; align-items: center; justify-content: center;
      border-radius: 8px; border: 1px dashed var(--line); background: var(--paper-2);
      font-size: 0.75rem; color: var(--ink-soft);
    }
    .photo-actions { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
    .delete-link { background: none; border: none; padding: 0; cursor: pointer; font-size: 0.875rem; color: #a23b2d; text-decoration: underline; }
    .panel-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
    .cancel-btn {
      padding: 0.5rem 0.9rem; background: transparent; border: 1px solid var(--line); border-radius: 7px;
      font-size: 0.9375rem; cursor: pointer; color: var(--ink-soft);
      &:disabled { opacity: .5; cursor: default; }
    }
    .save-btn {
      padding: 0.5rem 1.25rem; background: var(--accent); color: #fff; border: none; border-radius: 7px;
      font-size: 0.9375rem; cursor: pointer;
      &:disabled { opacity: .5; cursor: default; }
    }
    /* Touch targets: every button in the form is at least 44px tall (DESIGN.md). */
    .rel-btn, .delete-link, .cancel-btn, .save-btn {
      min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
    }
  `],
})
export class QuickAddRelativeComponent implements OnDestroy {
  private readonly store = inject(TreeStore);
  private readonly editService = inject(EditService);

  readonly anchorId = input.required<string>();
  readonly kind = input.required<RelativeKind>();
  readonly done = output<void>();
  readonly cancelled = output<void>();

  private readonly givenEl = viewChild<ElementRef<HTMLInputElement>>('given');

  protected readonly sexOptions: { v: Sex; label: string }[] = [
    { v: 'M', label: 'Male' }, { v: 'F', label: 'Female' }, { v: 'U', label: 'Unknown' },
  ];

  readonly givenName = signal('');
  readonly surname = signal('');
  readonly facebook = signal('');
  surnameTouched = false;
  readonly sex = signal<Sex>('U');
  readonly unionId = signal('');
  readonly error = signal<string | null>(null);
  readonly status = signal<string | null>(null);
  readonly busy = signal(false);
  readonly photo = signal<Blob | null>(null);
  readonly cropFile = signal<Blob | null>(null);
  readonly photoUrl = signal<string | null>(null);
  private url: string | null = null;

  private readonly anchor = computed(() => this.store.individuals().find((i) => i.id === this.anchorId()));
  readonly anchorName = computed(() => this.anchor()?.names[0]?.full || '(no name)');

  /** The families where the anchor is a partner: choices for a child's other parent. */
  readonly families = computed(() => {
    if (this.kind() !== 'child') return [];
    const names = new Map(this.store.individuals().map((i) => [i.id, i.names[0]?.full || '(no name)']));
    return this.store.unions()
      .filter((u) => u.spouseIds.includes(this.anchorId()))
      .map((u) => ({
        id: u.id,
        label: u.spouseIds.filter((s) => s !== this.anchorId()).map((s) => names.get(s)).join(' & ') || 'No other parent recorded',
      }));
  });

  constructor() {
    afterNextRender(() => {
      this.applyDefaults(true);
      this.givenEl()?.nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    if (this.url) URL.revokeObjectURL(this.url);
  }

  private chosenUnion(): string | undefined {
    const f = this.families();
    return this.unionId() || (f.length === 1 ? f[0].id : undefined);
  }

  private applyDefaults(resetSex: boolean): void {
    const a = this.anchor();
    if (!a) return;
    const d = relativeDefaults(this.kind(), a, this.store.individuals(), this.store.unions(), this.chosenUnion());
    if (!this.surnameTouched) this.surname.set(d.surname);
    if (resetSex) this.sex.set(d.sex);
  }

  onUnion(id: string): void {
    this.unionId.set(id);
    this.applyDefaults(false);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.error.set('Please choose an image file.'); return; }
    if (file.size > MAX_MEDIA_BYTES) {
      this.error.set(`Image too large (max ${Math.round(MAX_MEDIA_BYTES / 1e6)} MB).`);
      return;
    }
    this.error.set(null);
    this.cropFile.set(file);
  }

  onCropped(blob: Blob): void {
    this.cropFile.set(null);
    this.photo.set(blob);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.photoUrl.set(this.url);
  }

  async save(another: boolean): Promise<void> {
    if (this.busy()) return;
    const given = this.givenName().trim();
    const surname = this.surname().trim();
    const fb = this.facebook().trim();
    this.status.set(null);
    if (!given && !surname) { this.error.set('Please enter at least a given name or surname.'); return; }
    if (this.families().length > 1 && !this.unionId()) { this.error.set('Choose the other parent.'); return; }
    const bad = fb ? validateFact('facebook', fb) : null;
    if (bad) { this.error.set(bad); return; }
    this.error.set(null);
    this.busy.set(true);
    try {
      const anchor = this.anchorId();
      const data = { given, surname, sex: this.sex() };
      const k = this.kind();
      const id =
        k === 'parent' ? this.editService.addParent(anchor, data)
        : k === 'spouse' ? this.editService.addSpouse(anchor, data)
        : k === 'sibling' ? this.editService.addSibling(anchor, data)
        : this.editService.addChild(anchor, data, this.chosenUnion());
      if (fb) this.editService.addFact(id, 'facebook', fb);
      const photo = this.photo();
      if (photo) await this.editService.setPhoto(id, photo);
      if (!another) { this.done.emit(); return; }
      this.status.set(`Added ${`${given} ${surname}`.trim()}.`);
      this.givenName.set('');
      this.facebook.set('');
      this.surnameTouched = false;
      this.photo.set(null);
      this.photoUrl.set(null);
      this.applyDefaults(true);
      this.givenEl()?.nativeElement.focus();
    } finally {
      this.busy.set(false);
    }
  }
}
