import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if ('serviceWorker' in navigator) {
  if (isDevMode()) {
    // Dev: never let a service worker shadow the live dev server. A stale SW
    // left over from a previous session serves an old index.html pointing at
    // hashed chunks that no longer exist → they 404 → the app boots partially
    // and things like tree zoom/pan silently stop working. Unregister strays.
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
