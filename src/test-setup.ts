// Loads an in-memory IndexedDB before every spec. Dexie reads indexedDB when it is first loaded, and the test bundle can
// load it before a spec's own import runs, so specs must not depend on their import order.
import 'fake-indexeddb/auto';
