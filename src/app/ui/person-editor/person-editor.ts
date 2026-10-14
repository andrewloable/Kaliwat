import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TreeStore } from '../../core/tree-store/tree.store';
import { EditService, PersonFormData, trimSet, validateFact, FACT_KINDS, FactKind } from '../../core/edit/edit.service';
import { PhotoCropComponent } from '../photo-crop/photo-crop';
import { QuickAddRelativeComponent } from './quick-add-relative';
import type { RelativeKind } from '../../core/edit/relative-defaults';
import { MediaService } from '../../media/media.service';
import { MAX_MEDIA_BYTES } from '../../gedcom/gedzip/gedzip';
import { Individual, GedcomNode, GedcomEvent } from '../../core/model/types';
import { LIFE_EVENT_TYPES, lifeEventLabel } from '../../core/model/life-events';

type ConnectKind = 'parent' | 'partner' | 'child';

interface PersonDetail {
  label: string;
  value: string;
  href?: string; // mailto:/tel:/https: when the value is actionable
  node?: GedcomNode; // the record node it was read from, so it can be removed
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
      add({ label: 'Email', value: email, href: 'mailto:' + email, node: n });
    } else if (n.tag === 'PHON') {
      add({ label: 'Phone', value: n.value, href: 'tel:' + n.value.replace(/\s+/g, ''), node: n });
    } else if (n.tag === 'WWW') {
      add({ label: 'Website', value: n.value, href: n.value, node: n });
    } else if (n.tag === 'EVEN') {
      const value = gedUnescape(n.value);
      const type = n.children.find((c) => c.tag === 'TYPE')?.value ?? '';
      const isUrl = /^https?:\/\//i.test(value);
      add({ label: isUrl ? factLabel(type, value) : (type || 'Fact'), value, href: isUrl ? value : undefined, node: n });
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
  imports: [FormsModule, PhotoCropComponent, QuickAddRelativeComponent],
  template: `
    @if (state() !== 'closed') {
      <div class="edit-backdrop" (click)="close()" aria-hidden="true"></div>
      <aside #panel class="edit-panel" role="dialog" aria-modal="true"
        [attr.aria-label]="quickAdd() ? 'Add relative' : state() === 'new' ? 'Add person' : 'Edit person'">
        @if (quickAdd(); as kind) {
          <app-quick-add-relative [anchorId]="state()" [kind]="kind" (done)="backToAnchor()" (cancelled)="backToAnchor()" />
        } @else {
        <h2 class="panel-title">{{ state() === 'new' ? 'Add person' : 'Edit person' }}</h2>
        <form class="edit-form" (ngSubmit)="save()">
          <div class="essentials">
            @if (state() !== 'new') {
            <div class="photo-col">
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
            <div class="names">
              <label>
                Given name
                <input class="field-input" [(ngModel)]="form.given" name="given" required autocomplete="off" />
              </label>
              <label>
                Surname
                <input class="field-input" [(ngModel)]="form.surname" name="surname" autocomplete="off" />
              </label>
            </div>
          </div>
          <fieldset class="sex">
            <legend>Sex</legend>
            @for (o of sexOptions; track o.v) {
              <label class="sex-opt">
                <input type="radio" name="sex" [value]="o.v" [(ngModel)]="form.sex" />
                <span>{{ o.label }}</span>
              </label>
            }
          </fieldset>
          <label>
            Facebook
            <input class="field-input" name="facebook" type="url" inputmode="url" autocomplete="off"
              placeholder="facebook.com/name" [value]="facebook()" (input)="facebook.set(fb.value)" #fb />
          </label>
          @if (state() !== 'new') {
            <div class="field-group-label">Add relative</div>
            <div class="relatives">
              <button type="button" class="rel-btn" (click)="addRelative('parent')">+ Parent</button>
              <button type="button" class="rel-btn" (click)="addRelative('spouse')">+ Spouse</button>
              <button type="button" class="rel-btn" (click)="addRelative('sibling')">+ Sibling</button>
              <button type="button" class="rel-btn" (click)="addRelative('child')">+ Child</button>
            </div>
          }

          <details class="section" [open]="state() === 'new'">
            <summary>Birth &amp; death{{ lifeSummary() }}</summary>
            <div class="section-body">
              <div class="field-row">
                <label>
                  Birth date
                  <input class="field-input" [(ngModel)]="form.birthDate" name="birthDate" placeholder="e.g. 15 JUN 1940" autocomplete="off" />
                </label>
                <label>
                  Birth place
                  <input class="field-input" [(ngModel)]="form.birthPlace" name="birthPlace" autocomplete="off" />
                </label>
              </div>
              <div class="field-row">
                <label>
                  Death date
                  <input class="field-input" [(ngModel)]="form.deathDate" name="deathDate" placeholder="e.g. 3 MAR 2010" autocomplete="off" />
                </label>
                <label>
                  Death place
                  <input class="field-input" [(ngModel)]="form.deathPlace" name="deathPlace" autocomplete="off" />
                </label>
              </div>
            </div>
          </details>
          <details class="section">
            <summary>Notes{{ form.notes ? ' · added' : '' }}</summary>
            <div class="section-body">
              <textarea class="field-input field-textarea" [(ngModel)]="form.notes" name="notes" rows="3" aria-label="Notes"></textarea>
            </div>
          </details>
          @if (state() !== 'new') {
            <details class="section">
              <summary>Contacts &amp; facts ({{ otherDetails().length }})</summary>
              <div class="section-body">
                @if (otherDetails().length) {
            <ul class="details-list">
              @for (d of otherDetails(); track $index) {
                <li class="detail-row">
                  <span class="detail-label">{{ d.label }}</span>
                  <span class="detail-line">
                    @if (d.href) {
                      <a class="detail-value" [href]="d.href" target="_blank" rel="noopener noreferrer">{{ d.value }}</a>
                    } @else {
                      <span class="detail-value">{{ d.value }}</span>
                    }
                    @if (d.node) {
                      <button type="button" class="delete-link" [attr.aria-label]="'Remove ' + d.label + ' ' + d.value"
                        (click)="removeDetail(d)">Remove</button>
                    }
                  </span>
                </li>
              }
            </ul>
                }
                <div class="field-group-label">Add a fact</div>
            <div class="fact-row">
              <select class="field-input" aria-label="Kind of fact" [(ngModel)]="factKind" name="factKind">
                @for (k of factKinds; track k.kind) {
                  <option [value]="k.kind">{{ k.label }}</option>
                }
              </select>
              <input class="field-input" [(ngModel)]="factValue" name="factValue" autocomplete="off"
                aria-label="Fact value" [placeholder]="factPlaceholder()" (keydown.enter)="addFact(); $event.preventDefault()" />
              <button type="button" class="rel-btn" (click)="addFact()">Add</button>
            </div>
              </div>
            </details>
            <details class="section">
              <summary>Life events ({{ lifeEvents().length }})</summary>
              <div class="section-body">
            @if (lifeEvents().length) {
              <ul class="details-list">
                @for (ev of lifeEvents(); track ev) {
                  <li class="detail-row">
                    <span class="detail-label">{{ eventLabel(ev) }}</span>
                    <span class="detail-line">
                      <span class="detail-value">{{ eventSummary(ev) }}</span>
                      <button type="button" class="delete-link" [attr.aria-label]="'Remove ' + eventLabel(ev)"
                        (click)="removeLifeEvent(ev)">Remove</button>
                    </span>
                  </li>
                }
              </ul>
            }
            <div class="event-form">
              <select class="field-input" aria-label="Kind of event" [(ngModel)]="eventTag" name="eventTag">
                @for (t of eventTypes; track t.tag) {
                  <option [value]="t.tag">{{ t.label }}</option>
                }
              </select>
              @if (eventType()?.custom) {
                <input class="field-input" [(ngModel)]="eventTitle" name="eventTitle" autocomplete="off"
                  aria-label="Event name" placeholder="Name of the event" />
              }
              <div class="field-row">
                <input class="field-input" [(ngModel)]="eventDate" name="eventDate" autocomplete="off"
                  aria-label="Event date" placeholder="e.g. 12 MAR 1990" />
                <input class="field-input" [(ngModel)]="eventPlace" name="eventPlace" autocomplete="off"
                  aria-label="Event place" placeholder="Place" />
              </div>
              @if (eventType()?.description; as hint) {
                <input class="field-input" [(ngModel)]="eventDescription" name="eventDescription" autocomplete="off"
                  aria-label="Event description" [placeholder]="hint"
                  (keydown.enter)="addLifeEvent(); $event.preventDefault()" />
              }
              <button type="button" class="rel-btn" (click)="addLifeEvent()">Add event</button>
            </div>
              </div>
            </details>
            @if (relations().any) {
              <details class="section">
                <summary>Family links ({{ relationCount() }})</summary>
                <div class="section-body">
            <ul class="details-list">
              @for (f of relations().parents; track f.unionId) {
                <li class="detail-row">
                  <span class="detail-label">Parents</span>
                  <span class="detail-line">
                    <span class="detail-value">{{ f.label }}</span>
                    <button type="button" class="delete-link" [attr.aria-label]="'Remove as child of ' + f.label"
                      (click)="removeAsChild(f.unionId)">Remove as child</button>
                  </span>
                </li>
              }
              @for (p of relations().partners; track p.unionId + p.personId) {
                <li class="detail-row">
                  <span class="detail-label">Spouse / partner</span>
                  <span class="detail-line">
                    <span class="detail-value">{{ p.name }}</span>
                    <button type="button" class="delete-link" [attr.aria-label]="'Remove as spouse of ' + p.name"
                      title="Their children stay with the other parent"
                      (click)="removeAsSpouse(p.unionId)">Remove as spouse</button>
                  </span>
                </li>
              }
              @for (c of relations().children; track c.unionId + c.childId) {
                <li class="detail-row">
                  <span class="detail-label">Child</span>
                  <span class="detail-line">
                    <span class="detail-value">{{ c.name }}</span>
                    <button type="button" class="delete-link" [attr.aria-label]="'Remove as parent of ' + c.name"
                      (click)="removeAsParent(c.childId, c.unionId)">Remove as parent</button>
                  </span>
                </li>
              }
            </ul>
                </div>
              </details>
            }
            <details class="section">
              <summary>Connect existing person</summary>
              <div class="section-body">
            <p class="connect-note">Connecting as a parent or child moves them out of their current family.</p>
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
              </div>
            </details>
            @if (trimOptions().length > 1) {
              <details class="section">
                <summary>Trim branch</summary>
                <div class="section-body connect-picker">
              @if (confirmingTrim(); as t) {
                <span class="confirm-text">
                  Keep only {{ t.label }}
                  {{ t.count ? 'and delete ' + t.count + ' other ' + (t.count === 1 ? 'person' : 'people') + ' permanently' : '(nothing to delete: everyone is also related through this side)' }}?
                </span>
                <div class="relatives">
                  <button type="button" class="confirm-delete" (click)="trim(t.unionId)">Trim</button>
                  <button type="button" class="keep-btn" (click)="confirmingTrim.set(null)">Cancel</button>
                </div>
              } @else {
                <span class="confirm-text">Choose the side to keep. Relatives connected only through the other sides are deleted.</span>
                <div class="relatives">
                  @for (t of trimOptions(); track t.unionId) {
                    <button type="button" class="rel-btn" (click)="confirmingTrim.set(t)">
                      Keep {{ t.label }} <span class="ci-years">−{{ t.count }}</span>
                    </button>
                  }
                </div>
              }
                </div>
              </details>
            }
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
          <div class="panel-footer">
            @if (error()) {
              <p class="edit-error" role="alert">{{ error() }}</p>
            }
            <div class="panel-actions">
              <button class="cancel-btn" type="button" (click)="close()">Cancel</button>
              <button class="save-btn" type="submit">Save</button>
            </div>
          </div>
        </form>
        }
      </aside>
      @if (cropFile(); as f) {
        <app-photo-crop [file]="f" (done)="onCropped($event)" (cancelled)="cropFile.set(null)" />
      }
    }
  `,
  styles: [`
    .edit-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 100; }
    .edit-panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(420px, 100vw);
      background: var(--paper); z-index: 101;
      padding: 1.5rem 1.25rem 0;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 1rem;
      box-shadow: -4px 0 24px rgba(0,0,0,.12);
    }
    .panel-title { font-family: var(--font-serif); font-size: 1.375rem; margin: 0; color: var(--ink); }
    .edit-form { display: flex; flex-direction: column; gap: 0.875rem; }
    .essentials { display: flex; gap: 0.875rem; align-items: flex-start; }
    .names { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .photo-col { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; }
    .sex { display: flex; gap: 0.5rem; border: none; margin: 0; padding: 0; }
    .sex legend { font-size: 0.8125rem; color: var(--ink-soft); padding: 0; margin-bottom: 0.3rem; }
    .sex-opt {
      flex: 1; flex-direction: row; align-items: center; justify-content: center; gap: 0.4rem;
      min-height: 44px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper-2);
      font-size: 0.9375rem; color: var(--ink); cursor: pointer;
      &:has(input:checked) { border-color: var(--accent); color: var(--accent); }
    }
    .section { border-top: 1px solid var(--line); }
    .section summary {
      min-height: 44px; display: flex; align-items: center; cursor: pointer;
      font-size: 0.75rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .05em; font-weight: 600;
    }
    .section-body { display: flex; flex-direction: column; gap: 0.75rem; padding-bottom: 0.75rem; }
    .panel-footer {
      position: sticky; bottom: 0; z-index: 1; background: var(--paper);
      border-top: 1px solid var(--line); padding: 0.75rem 0;
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .field-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; }
    label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8125rem; color: var(--ink-soft); }
    .field-input {
      min-width: 0;
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
    .connect-note { margin: 0; font-size: 0.8125rem; color: var(--ink-soft); }
    .detail-line { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
    .fact-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; }
    .event-form { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
    .event-form .field-input { width: 100%; }
    .event-form .field-row { width: 100%; }
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
    .panel-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
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
  readonly quickAdd = signal<RelativeKind | null>(null);
  protected readonly sexOptions: { v: 'M' | 'F' | 'U'; label: string }[] = [
    { v: 'M', label: 'Male' }, { v: 'F', label: 'Female' }, { v: 'U', label: 'Unknown' },
  ];
  // Facebook link edited in the essentials block; applied on Save.
  readonly facebook = signal('');
  private fbNode: GedcomNode | undefined;
  private fbOriginal = '';
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);
  form: PersonFormData = blankForm();

  // Add-a-fact form (email, phone, website, social links).
  protected readonly factKinds = FACT_KINDS;
  factKind: FactKind = 'email';
  factValue = '';
  protected readonly factPlaceholder = () => FACT_KINDS.find((k) => k.kind === this.factKind)?.placeholder ?? '';

  // Life events (baptism, occupation, …): the list shown, and the add form.
  protected readonly eventTypes = LIFE_EVENT_TYPES;
  protected readonly eventLabel = (ev: GedcomEvent) => lifeEventLabel(ev);
  eventTag = 'BAPM';
  eventTitle = '';
  eventDate = '';
  eventPlace = '';
  eventDescription = '';
  protected readonly eventType = () => LIFE_EVENT_TYPES.find((t) => t.tag === this.eventTag);
  readonly lifeEvents = computed(() => {
    const id = this.state();
    if (id === 'closed' || id === 'new') return [];
    const indi = this.store.individuals().find((i) => i.id === id);
    return (indi?.events ?? []).filter((e) => e.type !== 'BIRT' && e.type !== 'DEAT');
  });

  /** "12 MAR 1990 · Iloilo · Teacher" */
  protected eventSummary(ev: GedcomEvent): string {
    return [ev.date, ev.place, ev.description].filter(Boolean).join(' · ') || '—';
  }

  // A picked photo waits here while the person adjusts the crop.
  readonly cropFile = signal<Blob | null>(null);

  // Contact details + extra facts (email, Facebook, …) read from the raw record.
  readonly details = computed(() => {
    const id = this.state();
    if (id === 'closed' || id === 'new') return [];
    return extractDetails(this.store.individuals().find((i) => i.id === id) ?? null);
  });

  /** Details minus the Facebook link that has its own field. */
  readonly otherDetails = computed(() => this.details().filter((d) => d.node !== this.fbNode || !this.fbNode));
  readonly relationCount = computed(() => {
    const r = this.relations();
    return r.parents.length + r.partners.length + r.children.length;
  });
  /** " · b. 7 JAN 1968 · d. 3 MAR 2018" for the collapsed Birth & death summary. */
  protected lifeSummary(): string {
    const f = this.form;
    const part = (tag: string, date?: string, place?: string) => {
      const v = [date, place].filter(Boolean).join(', ');
      return v ? ` · ${tag} ${v}` : '';
    };
    return part('b.', f.birthDate, f.birthPlace) + part('d.', f.deathDate, f.deathPlace);
  }

  // Trim branch: one "keep this side" option per union this person belongs to (as
  // child or partner), with how many people keeping only that side would delete.
  readonly trimOptions = computed(() => {
    const id = this.state();
    if (id === 'closed' || id === 'new') return [];
    const unions = this.store.unions();
    const names = new Map(this.store.individuals().map((i) => [i.id, i.names[0]?.full || '(no name)']));
    return unions
      .filter((u) => u.spouseIds.includes(id) || u.childLinks.some((c) => c.childId === id))
      .map((u) => {
        const others = u.spouseIds.filter((s) => s !== id).map((s) => names.get(s)).join(' & ');
        const label = u.spouseIds.includes(id)
          ? (others ? `family with ${others}` : 'children')
          : `parents' side${others ? ` (${others})` : ''}`;
        return { unionId: u.id, label, count: trimSet(unions, id, u.id).length };
      });
  });
  readonly confirmingTrim = signal<{ unionId: string; label: string; count: number } | null>(null);

  // The person's family links, each removable: their parents' family, partners, children.
  readonly relations = computed(() => {
    const id = this.state();
    const none = { parents: [] as { unionId: string; label: string }[], partners: [] as { unionId: string; personId: string; name: string }[],
      children: [] as { unionId: string; childId: string; name: string }[], any: false };
    if (id === 'closed' || id === 'new') return none;
    const names = new Map(this.store.individuals().map((i) => [i.id, i.names[0]?.full || '(no name)']));
    const nm = (x: string) => names.get(x) ?? '(unknown)';
    const unions = this.store.unions();
    const parents = unions
      .filter((u) => u.childLinks.some((c) => c.childId === id))
      .map((u) => ({ unionId: u.id, label: u.spouseIds.map(nm).join(' & ') || '(parents not recorded)' }));
    const mine = unions.filter((u) => u.spouseIds.includes(id));
    const partners = mine.flatMap((u) => u.spouseIds.filter((s) => s !== id)
      .map((s) => ({ unionId: u.id, personId: s, name: nm(s) })));
    const children = mine.flatMap((u) => u.childLinks.map((c) => ({ unionId: u.id, childId: c.childId, name: nm(c.childId) })));
    return { parents, partners, children, any: parents.length + partners.length + children.length > 0 };
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
    this.confirmingTrim.set(null);
    this.connectKind.set(null);
    this.connectQuery.set('');
    this.fbNode = undefined;
    this.fbOriginal = '';
    this.facebook.set('');
    if (target === 'new') {
      this.form = blankForm();
      this.state.set('new');
      return;
    }
    const indi = this.store.individuals().find((i) => i.id === target);
    if (!indi) return;
    const fb = extractDetails(indi).find((d) => d.label === 'Facebook' && d.node);
    this.fbNode = fb?.node;
    this.fbOriginal = fb?.value ?? '';
    this.facebook.set(this.fbOriginal);
    this.form = indi2form(indi);
    this.state.set(target);
  }

  close(): void {
    this.quickAdd.set(null);
    this.cropFile.set(null);
    this.confirmingDelete.set(false);
    this.confirmingTrim.set(null);
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

  /** Keep the edited person with their `unionId` side; delete their other relatives. */
  trim(unionId: string): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    this.editService.trimToSide(id, unionId);
    this.confirmingTrim.set(null);
  }

  /** Open the quick-add form for a relative; nothing is created until it is saved. */
  addRelative(kind: RelativeKind): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    this.error.set(null);
    this.quickAdd.set(kind);
  }

  /** Leave the quick-add form and show the person it was started from, top of the panel.
   *  Their unsaved edits are untouched (the form is only hidden). */
  backToAnchor(): void {
    this.quickAdd.set(null);
    afterNextRender(() => { const el = this.panel()?.nativeElement; if (el) el.scrollTop = 0; }, { injector: this.injector });
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
    this.cropFile.set(file); // opens the photo editor
  }

  /** The cropped photo from the editor: save it as the person's photo. */
  async onCropped(photo: Blob): Promise<void> {
    const id = this.state();
    this.cropFile.set(null);
    if (id === 'closed' || id === 'new') return;
    await this.editService.setPhoto(id, photo);
  }

  /** Remove the edited person as a child of the family `unionId`. */
  removeAsChild(unionId: string): void {
    const id = this.state();
    if (id !== 'closed' && id !== 'new') this.editService.removeChildLink(id, unionId);
  }

  /** Remove the edited person as a spouse in the family `unionId`. */
  removeAsSpouse(unionId: string): void {
    const id = this.state();
    if (id !== 'closed' && id !== 'new') this.editService.removeSpouse(id, unionId);
  }

  /** Remove a child of the edited person (they stop being the person's child). */
  removeAsParent(childId: string, unionId: string): void {
    this.editService.removeChildLink(childId, unionId);
  }

  /** Add the typed fact to the person's record. */
  addFact(): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    const err = this.editService.addFact(id, this.factKind, this.factValue);
    this.error.set(err);
    if (!err) this.factValue = '';
  }

  /** Add the typed life event to the person's record. */
  addLifeEvent(): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    const err = this.editService.addLifeEvent(id, {
      tag: this.eventTag, date: this.eventDate, place: this.eventPlace,
      description: this.eventDescription, title: this.eventTitle,
    });
    this.error.set(err);
    if (!err) { this.eventDate = ''; this.eventPlace = ''; this.eventDescription = ''; this.eventTitle = ''; }
  }

  removeLifeEvent(ev: GedcomEvent): void {
    const id = this.state();
    if (id === 'closed' || id === 'new') return;
    this.editService.removeLifeEvent(id, ev);
  }

  /** Remove a fact shown under Details. */
  removeDetail(d: PersonDetail): void {
    const id = this.state();
    if (id === 'closed' || id === 'new' || !d.node) return;
    this.editService.removeFact(id, d.node);
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
    const fb = this.facebook().trim();
    const fbChanged = fb !== this.fbOriginal;
    const bad = fbChanged && fb ? validateFact('facebook', fb) : null;
    if (bad) { this.error.set(bad); return; }
    if (state !== 'new' && !this._flushPending(state)) return;
    const id = state === 'new' ? this.editService.createIndividual(this.form) : state;
    if (state !== 'new') this.editService.updateIndividual(state, this.form);
    if (fbChanged) {
      if (this.fbNode) this.editService.removeFact(id, this.fbNode);
      if (fb) this.editService.addFact(id, 'facebook', fb);
    }
    this.close();
  }

  /** Save what was typed into the fact / life-event rows but never added. False if it was invalid. */
  private _flushPending(id: string): boolean {
    if (this.factValue.trim()) {
      const err = this.editService.addFact(id, this.factKind, this.factValue);
      if (err) { this.error.set(err); return false; }
      this.factValue = '';
    }
    if ([this.eventDate, this.eventPlace, this.eventDescription, this.eventTitle].some((v) => v.trim())) {
      this.addLifeEvent();
      if (this.error()) return false;
    }
    return true;
  }
}
