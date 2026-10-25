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

  readonly groups = computed(() => {
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

  open(): void { this.reviewing.set(true); }
  close(): void { this.reviewing.set(false); }
  dismiss(): void { this.dismissedAt.set(this.total()); }
}
