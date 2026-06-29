import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./views/list/list').then((m) => m.ListComponent) },
  { path: 'tree', loadComponent: () => import('./views/tree/tree').then((m) => m.TreeViewComponent) },
];
