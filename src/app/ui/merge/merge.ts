import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { MergeService, MergeOutcome } from '../../core/merge/merge.service';
import { Choice } from '../../core/merge/merge-apply';
import { FactConflict } from '../../core/merge/merge-plan';
import { TreeStore } from '../../core/tree-store/tree.store';
import { MediaService } from '../../media/media.service';
import { ExportService } from '../../export/export.service';
import { serializeAst } from '../../gedcom/serialize/gedcom-serializer';
import { GedcomNode, UUID } from '../../core/model/types';
import { trapModal } from '../dialog/modal-keys';

type State = 'closed' | 'reading' | 'preview' | 'applying' | 'done' | 'error';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const child = (n: GedcomNode, tag: string) => n.children.find((c) => c.tag === tag)?.value;

/** "a", "a and b", "a, b and c" */
function sentence(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** One side of a difference in words, or null when only the GEDCOM text can show it. */
function describe(n: GedcomNode): string | null {
  if (n.tag === 'NAME') return (n.value ?? '').replace(/\//g, '').trim() || null;
  if (n.tag === 'NOTE') return (n.value ?? '').slice(0, 120) || null;
  const parts = [child(n, 'DATE'), child(n, 'PLAC'), n.value].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Merge a .ged/.gdz into the open tree: what the file adds, a Current/Incoming choice for every difference
 * (like a git merge editor), then the merge. Nothing is written before the Merge button; Cancel, Escape and the
 * backdrop drop the pending merge.
 */
@Component({
  selector: 'app-merge',
  template: `
    @if (state() !== 'closed') {
      <div class="backdrop" (click)="dismiss()" aria-hidden="true"></div>
      <div #panel class="panel" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <h2 id="merge-title">Merge {{ fileName() }} into this tree</h2>
        <p class="status" aria-live="polite">{{ status() }}</p>

        @if (state() === 'preview' && plan(); as p) {
          @if (summary().length) {
            <ul class="summary">
              @for (line of summary(); track line) { <li>{{ line }}</li> }
            </ul>
          } @else {
            <p class="hint">Nothing new: this file matches the tree.</p>
          }
          @if (linksBroken()) {
            <p class="warning" role="alert">
              Kaliwat could not download a test photo from this file's photo links, so {{ webCount() === 1 ? 'that photo' : 'those ' + webCount() + ' photos' }}
              will not appear. Links like these stop working after a while (MyHeritage's expire after a few weeks): export the
              GEDCOM again and merge it soon after, or merge a .gdz that contains the photos.
            </p>
          }

          @if (p.conflicts.length) {
            <h3>Choose which version to keep</h3>
            <div class="bulk">
              <button type="button" class="link-btn" (click)="setAll('current')">Keep all current</button>
              <button type="button" class="link-btn" (click)="setAll('incoming')">Use all incoming</button>
            </div>
            @for (g of groups(); track g.id) {
              <section class="owner">
                <h4>{{ g.title }}</h4>
                @for (c of g.conflicts; track c.key) {
                  @let cur = describe(c.current);
                  @let inc = describe(c.incoming);
                  <!-- Same words on both sides (e.g. only a citation differs): show the GEDCOM text instead. -->
                  @let words = cur !== inc;
                  <fieldset>
                    <legend>{{ c.label }}</legend>
                    @for (side of sides; track side) {
                      <label class="side">
                        <input type="radio" [name]="c.key" [value]="side" [checked]="choiceOf(c.key) === side" (change)="choose(c.key, side)" />
                        <span class="which">{{ side === 'current' ? 'Current' : 'Incoming' }}</span>
                        @if (c.tag === 'OBJE') {
                          @let url = side === 'current' ? currentPhoto(c.currentMediaId) : incomingPhoto(c.incomingMediaId);
                          @if (url) {
                            <img [src]="url" alt="" width="64" height="64" />
                          } @else {
                            <span class="what">{{ fileOf(side === 'current' ? c.current : c.incoming) }}</span>
                          }
                        } @else if (words && (side === 'current' ? cur : inc)) {
                          <span class="what">{{ side === 'current' ? cur : inc }}</span>
                        } @else {
                          <code class="what">{{ gedcom(side === 'current' ? c.current : c.incoming) }}</code>
                        }
                      </label>
                    }
                  </fieldset>
                }
              </section>
            }
          }

          @if (p.warnings.length) {
            <details class="notes">
              <summary>{{ notesLabel() }}</summary>
              <ul>
                @for (w of p.warnings; track $index) { <li>{{ w }}</li> }
              </ul>
            </details>
          }

          <div class="actions">
            @if (anything()) {
              <button type="button" class="link-btn backup" (click)="backup()">{{ backedUp() ? 'Backup downloaded' : 'Download a backup first' }}</button>
              <button type="button" class="keep-btn" (click)="dismiss()">Cancel</button>
              <button type="button" class="merge-btn" (click)="apply()">Merge</button>
            } @else {
              <button type="button" class="keep-btn" (click)="dismiss()">Close</button>
            }
          </div>
        }

        @if (state() === 'applying') {
          <div class="actions">
            <button type="button" class="keep-btn" disabled>Cancel</button>
            <button type="button" class="merge-btn" disabled>Merge</button>
          </div>
        }

        @if (state() === 'done' || state() === 'error' || state() === 'reading') {
          <div class="actions">
            <button type="button" class="keep-btn" (click)="dismiss()">{{ state() === 'reading' ? 'Cancel' : 'Close' }}</button>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 100; }
    .panel {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 101;
      width: min(560px, calc(100vw - 32px)); max-height: 85vh; overflow-y: auto;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem;
      display: flex; flex-direction: column; gap: 0.75rem; overflow-wrap: anywhere;
    }
    h2 { font-family: var(--font-serif); font-size: 1.25rem; margin: 0; color: var(--ink); text-wrap: balance; }
    h3 { font-family: var(--font-serif); font-size: 1.0625rem; margin: 0.25rem 0 0; color: var(--ink); }
    h4 { font-family: var(--font-serif); font-size: 1rem; margin: 0; color: var(--ink); }
    .status:empty { display: none; }
    .status, .hint { margin: 0; font-size: 0.875rem; color: var(--ink-soft); }
    .warning {
      margin: 0; padding: 0.6rem 0.75rem; border-radius: 7px; font-size: 0.875rem; color: var(--ink);
      background: color-mix(in srgb, #a23b2d 8%, var(--paper)); border: 1px solid color-mix(in srgb, #a23b2d 35%, var(--line));
    }
    .summary { margin: 0; padding-left: 1.25rem; color: var(--ink); }
    .bulk { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .owner { display: flex; flex-direction: column; gap: 0.5rem; content-visibility: auto; contain-intrinsic-size: auto 160px; }
    fieldset { margin: 0; padding: 0.25rem 0.75rem 0.5rem; border: 1px solid var(--line); border-radius: 7px; }
    legend { padding: 0 0.25rem; font-size: 0.8125rem; color: var(--ink-soft); }
    .side { display: flex; align-items: center; gap: 0.6rem; min-height: 44px; cursor: pointer; }
    .side + .side { margin-top: 0.25rem; }
    .side input { accent-color: var(--accent); flex-shrink: 0; }
    .which { flex-shrink: 0; width: 4.75rem; font-size: 0.875rem; color: var(--ink-soft); }
    .what { min-width: 0; color: var(--ink); }
    code.what { font-size: 0.75rem; white-space: pre-wrap; }
    img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
    .notes { font-size: 0.875rem; color: var(--ink-soft); }
    .notes summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }
    .notes ul { margin: 0; padding-left: 1.25rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
    .backup { margin-right: auto; }
    .link-btn {
      background: none; border: none; padding: 0 0.25rem; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: 0.875rem;
      display: inline-flex; align-items: center; min-height: 44px; /* touch target */
    }
    .keep-btn, .merge-btn { min-height: 44px; padding: 0.4rem 1rem; border-radius: 7px; cursor: pointer; }
    .keep-btn { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .merge-btn { background: var(--accent); color: #fff; border: none; font-weight: 500; }
    button:disabled { opacity: .5; cursor: default; }
  `],
})
export class MergeComponent {
  private readonly merge = inject(MergeService);
  private readonly store = inject(TreeStore);
  private readonly media = inject(MediaService);
  private readonly exporter = inject(ExportService);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private releaseModal?: () => void;
  private readonly urls = new Map<UUID, string>();

  protected readonly sides: Choice[] = ['current', 'incoming'];
  protected readonly describe = describe;
  protected readonly state = signal<State>('closed');
  protected readonly fileName = signal('');
  protected readonly error = signal('');
  protected readonly result = signal<MergeOutcome | null>(null);
  /** The web-link photos of the merge being applied (the pending merge is gone once it is done). */
  private readonly webAtApply = signal({ count: 0, broken: false });
  protected readonly choices = signal(new Map<string, Choice>());
  protected readonly backedUp = signal(false);
  protected readonly plan = computed(() => this.merge.pending()?.plan ?? null);

  protected readonly webCount = computed(() => this.merge.pending()?.webPhotos ?? 0);
  protected readonly linksBroken = computed(() => this.merge.pending()?.webPhotosWork === false);

  protected readonly summary = computed(() => {
    const pending = this.merge.pending();
    const p = pending?.plan;
    if (!pending || !p) return [];
    // A changed profile picture brings its photo in too, whichever side is kept.
    const contested = p.conflicts.filter((c) => c.incomingMediaId && !p.mediaMatches.has(c.incomingMediaId)).length;
    const links = [...p.newChildLinks.map((l) => l.incomingChildId), ...p.newSpouseLinks.map((l) => l.incomingSpouseId)]
      .filter((id) => p.personMatches.has(id)).length; // links of new people come with them
    const lines: [number, string, string][] = [
      [p.newPeople.length, 'new person', 'new people'],
      [p.newFamilies.length, 'new family', 'new families'],
      [links, 'new parent or spouse link between people already in the tree', 'new parent or spouse links between people already in the tree'],
      [p.newMedia.length + contested - pending.webPhotos, 'new photo', 'new photos'],
      pending.webPhotosWork === false
        ? [pending.webPhotos, 'new photo that is only a web link (not inside the file)', 'new photos that are only web links (not inside the file)']
        : [pending.webPhotos, 'new photo that is only a web link (not inside the file; it loads when shown)', 'new photos that are only web links (not inside the file; they load when shown)'],
      [pending.fills, 'photo already in the tree gets its image from this file', 'photos already in the tree get their image from this file'],
      [p.photoOverwrites.length, 'profile picture that is only a web link is replaced by the photo in this file', 'profile pictures that are only web links are replaced by the photos in this file'],
      [p.factAdditions.length, 'fact added to people and families already in the tree', 'facts added to people and families already in the tree'],
      [p.newRecords.length, 'new source or other record', 'new sources and other records'],
      [p.conflicts.length, 'difference to choose', 'differences to choose'],
    ];
    return lines.filter(([n]) => n > 0).map(([n, one, many]) => count(n, one, many));
  });
  protected readonly anything = computed(() => this.summary().length > 0);
  protected readonly notesLabel = computed(() => count(this.plan()?.warnings.length ?? 0, 'note about this merge', 'notes about this merge'));

  /** The differences grouped by the person or family they belong to, in plan order. */
  protected readonly groups = computed(() => {
    const pending = this.merge.pending();
    if (!pending) return [];
    const people = new Map(pending.current.individuals.map((p) => [p.id, p]));
    const unions = new Map(pending.current.unions.map((u) => [u.id, u]));
    const name = (id: UUID) => people.get(id)?.names[0]?.full || '(no name)';
    const out = new Map<UUID, { id: UUID; title: string; conflicts: FactConflict[] }>();
    for (const c of pending.plan.conflicts) {
      const title = c.ownerKind === 'person'
        ? name(c.currentId)
        : `Family of ${(unions.get(c.currentId)?.spouseIds ?? []).map(name).join(' & ') || 'unknown parents'}`;
      const g = out.get(c.currentId) ?? { id: c.currentId, title, conflicts: [] };
      g.conflicts.push(c);
      out.set(c.currentId, g);
    }
    return [...out.values()];
  });

  protected readonly status = computed(() => {
    switch (this.state()) {
      case 'reading': return this.merge.progress() || `Reading ${this.fileName()}…`;
      case 'applying': return this.merge.progress() || 'Merging…';
      case 'error': return this.error();
      case 'done': return this.doneText();
      default: return '';
    }
  });

  // When the dialog opens: focus moves in, Tab stays inside, Escape closes it (except while merging).
  private readonly armModal = effect(() => {
    if (this.state() === 'closed' || this.releaseModal) return;
    afterNextRender(() => {
      const el = this.panel()?.nativeElement;
      if (el && !this.releaseModal) this.releaseModal = trapModal(el, () => this.dismiss());
    }, { injector: this.injector });
  });

  async open(file: File): Promise<void> {
    this.fileName.set(file.name);
    this.choices.set(new Map());
    this.backedUp.set(false);
    this.state.set('reading');
    const r = await this.merge.preview(file);
    if (this.state() !== 'reading') {
      this.merge.cancel(); // closed while reading
      return;
    }
    if ('error' in r) {
      this.error.set(r.error);
      this.state.set('error');
      return;
    }
    this.state.set('preview');
  }

  protected choiceOf(key: string): Choice {
    return this.choices().get(key) ?? 'current';
  }

  protected choose(key: string, side: Choice): void {
    this.choices.update((m) => new Map(m).set(key, side));
  }

  protected setAll(side: Choice): void {
    this.choices.set(new Map((this.plan()?.conflicts ?? []).map((c) => [c.key, side])));
  }

  protected currentPhoto(id?: UUID): string | null {
    return id ? this.media.avatar(this.store.currentTreeId(), id)() : null;
  }

  /** An object URL for a photo that came in the .gdz (revoked when the dialog closes). */
  protected incomingPhoto(id?: UUID): string | null {
    if (!id) return null;
    let url = this.urls.get(id);
    if (!url) {
      const b = this.merge.pending()?.blobs.find((x) => x.id === id);
      if (!b) return null;
      url = URL.createObjectURL(b.thumb ?? b.blob);
      this.urls.set(id, url);
    }
    return url;
  }

  protected fileOf(n: GedcomNode): string {
    return child(n, 'FILE') ?? (n.pointer ? `Photo ${n.pointer}` : 'A photo');
  }

  protected gedcom(n: GedcomNode): string {
    return serializeAst([n]).trimEnd();
  }

  async backup(): Promise<void> {
    await this.exporter.export();
    this.backedUp.set(true);
  }

  async apply(): Promise<void> {
    this.webAtApply.set({ count: this.webCount(), broken: this.linksBroken() });
    this.state.set('applying');
    const r = await this.merge.apply(this.choices());
    if ('error' in r) {
      this.error.set(r.error);
      this.state.set('error');
      return;
    }
    this.result.set(r);
    this.state.set('done');
  }

  /** Cancel, Escape and the backdrop: drop the pending merge and close (ignored while merging). */
  dismiss(): void {
    if (this.state() === 'applying') return;
    this.merge.cancel();
    this.releaseModal?.();
    this.releaseModal = undefined;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.state.set('closed');
  }

  private doneText(): string {
    const s = this.result();
    if (!s) return '';
    const web = this.webAtApply();
    const photos = s.photosAdded - web.count;
    const added = [
      s.peopleAdded ? count(s.peopleAdded, 'person', 'people') : '',
      s.familiesAdded ? count(s.familiesAdded, 'family', 'families') : '',
      photos > 0 ? count(photos, 'photo', 'photos') : '',
      web.count ? count(web.count, 'photo link', 'photo links') : '',
    ].filter(Boolean);
    const first = added.length ? `Added ${sentence(added)}.` : s.factsAdded || s.imagesFilled || s.linksReplaced ? 'Merged.' : 'Nothing was added.';
    const facts = s.factsAdded ? ` ${count(s.factsAdded, 'fact was', 'facts were')} added to people and families already in the tree.` : '';
    const took = s.tookIncoming ? ` ${count(s.tookIncoming, 'difference took', 'differences took')} the incoming version.` : '';
    const filled = s.imagesFilled ? ` Stored the image of ${count(s.imagesFilled, 'photo', 'photos')} already in the tree.` : '';
    const replaced = s.linksReplaced ? ` Replaced ${count(s.linksReplaced, 'web-link profile picture', 'web-link profile pictures')} with the file's photos.` : '';
    const links = !web.count ? ''
      : web.broken ? ` The photo links did not work in a test download, so ${web.count === 1 ? 'that photo' : 'those photos'} will not appear.`
      : ` Photos from links load when each person is shown.`;
    return first + facts + took + filled + replaced + links;
  }
}
