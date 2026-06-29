import {
  ApplicationConfig, provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection, APP_INITIALIZER, inject,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { PersistenceService } from './core/db/persistence.service';
import { TreeStore } from './core/tree-store/tree.store';

function restoreTreeFactory(persistence: PersistenceService, store: TreeStore) {
  return async () => {
    const treeId = await persistence.loadLatestTreeId();
    if (!treeId) return;
    const [individuals, unions] = await Promise.all([
      persistence.loadIndividuals(treeId),
      persistence.loadUnions(treeId),
    ]);
    if (!individuals.length) return;
    store.setTreeId(treeId);
    store.setIndividuals(individuals);
    store.setUnions(unions);
    store.importStatus.set({ kind: 'success', treeId, total: individuals.length, skipped: 0, warnings: [] });
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      useFactory: (p: PersistenceService, s: TreeStore) => restoreTreeFactory(p, s),
      deps: [PersistenceService, TreeStore],
      multi: true,
    },
  ],
};
