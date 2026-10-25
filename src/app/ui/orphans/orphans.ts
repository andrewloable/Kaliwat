import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { EditService } from '../../core/edit/edit.service';
import { OrphansService } from './orphans.service';
import { trapModal } from '../dialog/modal-keys';

/**
 * Banner + picker for people not connected to the main tree. Nothing is deleted
 * until the user ticks the groups to remove and confirms; unticked groups stay.
 * The List view shows the banner; the app shows the dialog once, so the footer can open it from any view.
 */
@Component({
  selector: 'app-orphans',
  template: `
    @if (banner() && orphans.bannerVisible()) {
      <div class="orphan-banner" role="status">
        {{ total() }} {{ total() === 1 ? 'person is' : 'people are' }} not connected to the main tree.
        <button type="button" class="link-btn" (click)="orphans.open()">Review</button>
        <button type="button" class="link-btn" (click)="orphans.dismiss()">Dismiss</button>
      </div>
    }
    @if (dialog() && orphans.reviewing()) {
      <div class="backdrop" (click)="close()" aria-hidden="true"></div>
      <div #panel class="panel" role="dialog" aria-modal="true" aria-labelledby="orphans-title">
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
      padding: 0.125rem 1.25rem; background: var(--paper-2); border-bottom: 1px solid var(--line); /* the 44px buttons give the height */
      font-size: 0.875rem; color: var(--ink-soft); display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;
    }
    .link-btn {
      background: none; border: none; padding: 0 0.25rem; cursor: pointer; color: var(--accent); text-decoration: underline; font-size: inherit;
      display: inline-flex; align-items: center; min-height: 44px; /* touch target */
    }
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
  protected readonly orphans = inject(OrphansService);
  private readonly editService = inject(EditService);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private releaseModal?: () => void;

  /** Show the banner (the List view) and/or the review dialog (rendered once by the app). */
  readonly banner = input(true);
  readonly dialog = input(true);

  readonly groups = this.orphans.groups;
  readonly total = this.orphans.total;
  readonly picked = signal(new Set<string>());
  readonly pickedIds = computed(() => this.groups().filter((g) => this.picked().has(g.key)).flatMap((g) => g.ids));
  readonly pickedCount = computed(() => this.pickedIds().length);

  // When the review opens (from the banner or the footer): focus moves in, Tab stays inside, Escape closes it.
  private readonly armModal = effect(() => {
    if (!this.dialog() || !this.orphans.reviewing() || this.releaseModal) return;
    afterNextRender(() => {
      const el = this.panel()?.nativeElement;
      if (el && !this.releaseModal) this.releaseModal = trapModal(el, () => this.close());
    }, { injector: this.injector });
  });

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
    this.releaseModal?.();
    this.releaseModal = undefined;
    this.picked.set(new Set());
    this.orphans.close();
  }
}
