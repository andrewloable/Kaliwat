import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopBarComponent } from './ui/top-bar/top-bar';
import { OrphansComponent } from './ui/orphans/orphans';
import { OrphansService } from './ui/orphans/orphans.service';
import { TreeStore } from './core/tree-store/tree.store';
import { MediaService } from './media/media.service';
import { version } from '../../package.json';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopBarComponent, OrphansComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App {
  protected readonly version = version;
  // Unconnected people: the footer entry is always there while any exist, on every view.
  protected readonly orphans = inject(OrphansService);
  protected readonly store = inject(TreeStore);
  protected readonly media = inject(MediaService);
}
