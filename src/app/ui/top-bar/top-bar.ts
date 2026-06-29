import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SearchService } from '../../core/search/search.service';
import { TreeStore } from '../../core/tree-store/tree.store';
import { ImportService } from '../../core/import/import.service';
import { ExportService } from '../../export/export.service';

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
})
export class TopBarComponent {
  readonly search = inject(SearchService);
  readonly store = inject(TreeStore);
  private readonly importService = inject(ImportService);
  private readonly exportService = inject(ExportService);

  onImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.importService.importFile(file);
    input.value = ''; // allow re-importing the same file
  }

  export(): void {
    void this.exportService.export();
  }
}
