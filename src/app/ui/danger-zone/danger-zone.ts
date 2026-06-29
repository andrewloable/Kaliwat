import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-danger-zone',
  template: `
    @if (confirmMode()) {
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="dz-title">
        <div class="confirm-box">
          <p id="dz-title" class="confirm-msg">{{ confirmMessage() }}</p>
          <div class="confirm-actions">
            <button class="btn-cancel" (click)="cancel.emit()">Cancel</button>
            <button class="btn-confirm" (click)="confirm.emit()">{{ confirmLabel() }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .confirm-modal {
      position: fixed; inset: 0;
      background: rgba(43,36,32,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    .confirm-box {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 1.5rem;
      max-width: 360px;
      width: 90%;
    }
    .confirm-msg { margin: 0 0 1.25rem; color: var(--ink); font-size: 1rem; }
    .confirm-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-cancel {
      padding: 0.4rem 1rem; background: transparent;
      border: 1px solid var(--line); border-radius: 8px;
      font-family: var(--font-sans); cursor: pointer; color: var(--ink);
    }
    .btn-confirm {
      padding: 0.4rem 1rem; background: #b53030; color: #fff;
      border: none; border-radius: 8px;
      font-family: var(--font-sans); font-weight: 500; cursor: pointer;
      min-height: 44px;
    }
  `],
})
export class DangerZoneComponent {
  readonly confirmMode = input(false);
  readonly confirmMessage = input('Are you sure? This cannot be undone.');
  readonly confirmLabel = input('Confirm');
  readonly confirm = output<void>();
  readonly cancel = output<void>();
}
