import { Component, ElementRef, HostListener, Injector, afterNextRender, inject, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SearchService } from '../../core/search/search.service';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { CompareComponent } from '../compare/compare';
import { ExportMenuComponent } from '../export-menu/export-menu';
import { MergeComponent } from '../merge/merge';

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink, RouterLinkActive, CompareComponent, ExportMenuComponent, MergeComponent],
  templateUrl: './top-bar.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './top-bar.scss',
})
export class TopBarComponent {
  readonly search = inject(SearchService);
  readonly store = inject(TreeStore);
  private readonly importService = inject(ImportService);
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('q');
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('searchToggle');
  private readonly moreBtn = viewChild<ElementRef<HTMLButtonElement>>('moreBtn');
  private readonly firstMoreItem = viewChild<ElementRef<HTMLButtonElement>>('firstMoreItem');

  /** The "More actions" menu (below 360px it holds Compare and Merge). */
  readonly moreOpen = signal(false);

  toggleMore(): void {
    if (this.moreOpen()) return this.closeMore();
    this.moreOpen.set(true);
    afterNextRender(() => this.firstMoreItem()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Closes the menu and puts focus back on its button, so a dialog opened from the menu returns focus there. */
  closeMore(): void {
    this.moreOpen.set(false);
    this.moreBtn()?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.moreOpen()) this.closeMore();
  }

  openSearch(): void {
    this.search.open.set(true);
    afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Close the phone search; the query stays, so the filtered list stays. */
  closeSearch(): void {
    this.search.open.set(false);
    afterNextRender(() => this.toggle()?.nativeElement.focus(), { injector: this.injector });
  }

  onImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.importService.importFile(file);
    input.value = ''; // allow re-importing the same file
  }

  onMerge(e: Event, dialog: MergeComponent): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void dialog.open(file);
    input.value = ''; // allow merging the same file again
  }
}
