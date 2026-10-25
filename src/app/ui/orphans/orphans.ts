import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { TreeStore } from '../../core/tree-store/tree.store';
import { EditService, orphanGroups } from '../../core/edit/edit.service';

/**
 * Banner + picker for people not connected to the main tree. Nothing is deleted
 * until the user ticks the groups to remove and confirms; unticked groups stay.
 */
@Component({
  selector: 'app-orphans',
  template: `
    @if (groups().length && !dismissed()) {
      <div class="orphan-banner" role="status">
        {{ total() }} {{ total() === 1 ? 'person is' : 'people are' }} not connected to the main tree.
        <button type="button" class="link-btn" (click)="reviewing.set(true)">Review</button>
        <button type="button" class="link-btn" (click)="dismissed.set(true)">Dismiss</button>
      </div>
    }
    @if (reviewing()) {
      <div class="backdrop" (click)="close()" aria-hidden="true"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="orphans-title">
        <h2 id="orphans-title">Not connected to the main tree</h2>
        <p class="hint">Tick the groups you want to delete. Unticked groups are kept.</p>
        <ul>
          @for (g of groups(); track g.key) {
            <li>
              <label>
                <input type="checkbox" [checked]="picked().has(g.key)" (change)="toggle(g.key)" />
                <span class="names">{{ g.label }}</span>
                <span class="count">{{ g.ids.length }}</span>
              </label>
            </li>
          }
        </ul>
        <div class="actions">
          <button type="button" class="keep-btn" (click)="close()">Cancel</button>
          <button type="button" class="delete-btn" [disabled]="!pickedCount()" (click)="deletePicked()">
            Delete {{ pickedCount() }} {{ pickedCount() === 1 ? 'person' : 'people' }}
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .orphan-banner {
      padding: 0.5rem 1.25rem; background: var(--paper-2); border-bottom: 1px solid var(--line);
      font-size: 0.875rem; color: var(--ink-soft); display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;
    }
    .link-btn { background: none; border: none; padding: 0; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: inherit; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 100; }
    .panel {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 101;
      width: min(440px, calc(100vw - 32px)); max-height: 80vh; overflow-y: auto;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem;
      display: flex; flex-direction: column; gap: 0.75rem;
    }
    h2 { font-family: var(--font-serif); font-size: 1.25rem; margin: 0; color: var(--ink); }
    .hint { margin: 0; font-size: 0.875rem; color: var(--ink-soft); }
    ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 7px; }
    li + li { border-top: 1px solid var(--line); }
    label { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.7rem; cursor: pointer; }
    input { accent-color: var(--accent); }
    .names { flex: 1; font-family: var(--font-serif); color: var(--ink); }
    .count { font-size: 0.8125rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .keep-btn {
      padding: 0.4rem 1rem; background: transparent; color: var(--ink);
      border: 1px solid var(--line); border-radius: 7px; cursor: pointer;
    }
    .delete-btn {
      padding: 0.4rem 1rem; background: #a23b2d; color: #fff; border: none; border-radius: 7px; cursor: pointer;
      &:disabled { opacity: .5; cursor: default; }
    }
  `],
})
export class OrphansComponent {
  private readonly store = inject(TreeStore);
  private readonly editService = inject(EditService);

  readonly reviewing = signal(false);
  readonly dismissed = signal(false);
  readonly picked = signal(new Set<string>());

  readonly groups = computed(() => {
    const names = new Map(this.store.individuals().map((i) => [i.id, i.names[0]?.full || '(no name)']));
    return orphanGroups(this.store.individuals(), this.store.unions()).map((ids) => {
      const shown = ids.slice(0, 3).map((id) => names.get(id)).join(', ');
      return { key: ids[0], ids, label: ids.length > 3 ? `${shown} +${ids.length - 3} more` : shown };
    });
  });
  readonly total = computed(() => this.groups().reduce((n, g) => n + g.ids.length, 0));
  readonly pickedIds = computed(() => this.groups().filter((g) => this.picked().has(g.key)).flatMap((g) => g.ids));
  readonly pickedCount = computed(() => this.pickedIds().length);

  toggle(key: string): void {
    this.picked.update((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  deletePicked(): void {
    this.editService.deletePeople(this.pickedIds());
    this.close();
  }

  close(): void {
    this.picked.set(new Set());
    this.reviewing.set(false);
  }
}
