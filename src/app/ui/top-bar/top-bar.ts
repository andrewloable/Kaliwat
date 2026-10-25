import { Component, ElementRef, Injector, afterNextRender, inject, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SearchService } from '../../core/search/search.service';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { CompareComponent } from '../compare/compare';
import { ExportMenuComponent } from '../export-menu/export-menu';

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink, RouterLinkActive, CompareComponent, ExportMenuComponent],
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
}
