import { Injectable, computed, inject, signal } from '@angular/core';
import { TreeStore } from '../../core/tree-store/tree.store';
import { orphanGroups } from '../../core/edit/edit.service';

/**
 * People not connected to the main tree, kept up to date on every change to the people or families.
 * Shared by the List view's banner, the footer entry (always reachable) and the review dialog.
 */
@Injectable({ providedIn: 'root' })
export class OrphansService {
  private readonly store = inject(TreeStore);

  // Bumped by scan(): the check runs again even though nothing changed (it already re-runs on every change).
  private readonly rescans = signal(0);

  readonly groups = computed(() => {
    this.rescans();
    const names = new Map(this.store.individuals().map((i) => [i.id, i.names[0]?.full || '(no name)']));
    return orphanGroups(this.store.individuals(), this.store.unions()).map((ids) => {
      const shown = ids.slice(0, 3).map((id) => names.get(id)).join(', ');
      return { key: ids[0], ids, label: ids.length > 3 ? `${shown} +${ids.length - 3} more` : shown };
    });
  });
  readonly total = computed(() => this.groups().reduce((n, g) => n + g.ids.length, 0));

  readonly reviewing = signal(false);
  // Dismiss hides the banner for this count only: a different number of unconnected people shows it again.
  private readonly dismissedAt = signal<number | null>(null);
  readonly bannerVisible = computed(() => this.total() > 0 && this.total() !== this.dismissedAt());

  /** When the check last ran on demand, and over how many people. */
  readonly lastScan = signal<{ people: number; at: Date } | null>(null);

  /** Run the check again now (the review's "Scan again", and every time the review opens). */
  scan(): void {
    this.rescans.update((n) => n + 1);
    this.groups();
    this.lastScan.set({ people: this.store.individuals().length, at: new Date() });
  }

  open(): void { this.scan(); this.reviewing.set(true); }
  close(): void { this.reviewing.set(false); }
  dismiss(): void { this.dismissedAt.set(this.total()); }
}
