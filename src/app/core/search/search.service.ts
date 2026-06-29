import { Injectable, signal } from '@angular/core';

/**
 * Shared search state. The search box lives in the top bar but the result list
 * lives in another component, so the query has to be app-level state rather than
 * local to either one. Signal-based so any view (list now, tree later) can react.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly query = signal('');
}
