import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
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

  onImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.importService.importFile(file);
    input.value = ''; // allow re-importing the same file
  }
}
