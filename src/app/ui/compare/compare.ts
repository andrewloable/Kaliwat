import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { TreeStore } from '../../core/tree-store/tree.store';
import { fold, matchesTerms } from '../../core/search/search-util';
import { relationship, traceLayout, TRACE_W, TRACE_H } from '../../core/relate/relate';
import { Individual } from '../../core/model/types';

type Slot = 'a' | 'b';

function nameOf(p: Individual | undefined): string {
  return p?.names[0]?.full || '(no name)';
}

function yearsOf(p: Individual): string {
  const y = (t: string) => p.events.find((e) => e.type === t)?.date?.match(/\d{4}/)?.[0];
  const b = y('BIRT');
  const d = y('DEAT');
  return b || d ? `${b ?? '?'}–${d ?? ''}`.replace(/–$/, '') : '';
}

/**
 * "How are they related?" dialog: pick two people, get the kinship term (1st cousin,
 * 2nd cousin once removed, sibling-in-law…) and the chain linking them drawn as a
 * small tree, with their common ancestor(s) at the top.
 */
@Component({
  selector: 'app-compare',
  template: `
    @if (isOpen()) {
      <div class="backdrop" (click)="close()" aria-hidden="true"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
        <h2 id="cmp-title">How are they related?</h2>
        <div class="pickers">
          @for (slot of slots; track slot) {
            <div class="picker">
              <span class="picker-label">{{ slot === 'a' ? 'First person' : 'Second person' }}</span>
              @if (person(slot); as p) {
                <button type="button" class="chosen" (click)="chosen[slot].set(null)" [attr.aria-label]="'Change ' + name(p)">
                  <span>{{ name(p) }}</span><span aria-hidden="true">✕</span>
                </button>
              } @else {
                <input #q type="search" class="field" autocomplete="off" placeholder="Search a name…"
                  [attr.aria-label]="slot === 'a' ? 'First person' : 'Second person'"
                  [value]="query[slot]()" (input)="query[slot].set(q.value)" />
                @if (query[slot]().trim()) {
                  <ul class="results">
                    @for (m of matches[slot](); track m.id) {
                      <li><button type="button" (click)="pick(slot, m.id)">
                        <span>{{ name(m) }}</span><span class="years">{{ years(m) }}</span>
                      </button></li>
                    } @empty {
                      <li class="empty">No matching people</li>
                    }
                  </ul>
                }
              }
            </div>
          }
        </div>

        @if (result(); as r) {
          <p class="verdict" role="status">
            @switch (r.term) {
              @case ('self') { That's the same person. }
              @case ('not connected') { {{ name(person('a')) }} and {{ name(person('b')) }} aren't connected in this tree. }
              @case ('related by marriage') { <b>{{ name(person('b')) }}</b> is related to <b>{{ name(person('a')) }}</b> by marriage. }
              @default { <b>{{ name(person('b')) }}</b> is <b>{{ name(person('a')) }}</b>'s <b class="term">{{ r.term }}</b>. }
            }
          </p>
          @if (trace(); as t) {
            <div class="trace-scroll">
              <div class="trace" [style.width.px]="t.width" [style.height.px]="t.height">
                <svg [attr.width]="t.width" [attr.height]="t.height" aria-hidden="true">
                  @for (l of t.links; track $index) {
                    <line [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" />
                    @if (l.spouse) {
                      <circle [attr.cx]="(l.x1 + l.x2) / 2" [attr.cy]="l.y1" r="10" />
                      <text [attr.x]="(l.x1 + l.x2) / 2" [attr.y]="l.y1">⚭</text>
                    }
                  }
                </svg>
                @for (c of t.cards; track c.id) {
                  @let p = byId().get(c.id);
                  <div class="card" [class.end]="c.id === chosen.a() || c.id === chosen.b()"
                    [style.left.px]="c.x" [style.top.px]="c.y" [style.width.px]="W" [style.height.px]="H">
                    @if (r.lca && (c.id === r.lca || c.partner)) { <span class="tag">common ancestor</span> }
                    <span class="card-name" [title]="name(p)">{{ name(p) }}</span>
                    @if (p && years(p)) { <span class="years">{{ years(p) }}</span> }
                  </div>
                }
              </div>
            </div>
          }
        }

        <div class="actions"><button type="button" class="close-btn" (click)="close()">Close</button></div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.32); z-index: 100; }
    .panel {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 101;
      width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem;
      display: flex; flex-direction: column; gap: 0.9rem;
    }
    h2 { font-family: var(--font-serif); font-size: 1.25rem; margin: 0; color: var(--ink); }
    .pickers { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
    .picker { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
    .picker-label { font-size: 0.75rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
    .field {
      padding: 0.4rem 0.6rem; border: 1px solid var(--line); border-radius: 6px;
      background: var(--paper-2); font-size: 0.9375rem; color: var(--ink);
    }
    .chosen {
      display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.4rem 0.6rem; text-align: left;
      border: 1px solid var(--accent); border-radius: 6px; background: var(--card); color: var(--ink);
      font-family: var(--font-serif); font-size: 0.95rem; cursor: pointer;
    }
    .results {
      list-style: none; margin: 0; padding: 0; max-height: 180px; overflow-y: auto;
      border: 1px solid var(--line); border-radius: 6px; background: var(--card);
      button {
        display: flex; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 0.4rem 0.6rem;
        background: none; border: none; border-bottom: 1px solid var(--line); text-align: left; cursor: pointer;
        font-family: var(--font-serif); color: var(--ink);
        &:hover { background: var(--paper-2); }
      }
    }
    .empty { padding: 0.5rem 0.6rem; font-size: 0.875rem; color: var(--ink-soft); font-style: italic; }
    .years { font-family: var(--font-sans); font-size: 0.8125rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
    .verdict { margin: 0; font-size: 1rem; color: var(--ink); }
    .term { color: var(--accent); }
    .trace-scroll { overflow: auto; padding: 1rem 0 0.5rem; } /* top room for the "common ancestor" tags */
    .trace { position: relative; margin: 0 auto; }
    svg { position: absolute; inset: 0; overflow: visible; }
    line { stroke: var(--line); stroke-width: 1.5; }
    circle { fill: var(--paper-2); stroke: var(--accent); stroke-width: 1.5; }
    text { fill: var(--accent); font-size: 12px; text-anchor: middle; dominant-baseline: central; }
    .card {
      position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 2px;
      padding: 0 0.6rem; background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    }
    .card.end { border: 2px solid var(--accent); }
    .card-name {
      font-family: var(--font-serif); font-size: 0.875rem; line-height: 1.2; color: var(--ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .tag {
      position: absolute; top: -0.75rem; left: 0.5rem; padding: 0 0.35rem; border-radius: 4px;
      background: var(--paper); font-size: 0.6875rem; color: var(--accent);
    }
    .actions { display: flex; justify-content: flex-end; }
    .close-btn {
      padding: 0.4rem 1rem; background: transparent; color: var(--ink);
      border: 1px solid var(--line); border-radius: 7px; cursor: pointer;
    }
  `],
})
export class CompareComponent {
  private readonly store = inject(TreeStore);

  protected readonly slots: Slot[] = ['a', 'b'];
  protected readonly W = TRACE_W;
  protected readonly H = TRACE_H;
  protected readonly name = nameOf;
  protected readonly years = yearsOf;

  readonly isOpen = signal(false);
  readonly chosen = { a: signal<string | null>(null), b: signal<string | null>(null) };
  readonly query = { a: signal(''), b: signal('') };

  readonly byId = computed(() => new Map(this.store.individuals().map((i) => [i.id, i])));
  private readonly unionMap = computed(() => new Map(this.store.unions().map((u) => [u.id, u])));
  private readonly folded = computed(() => this.store.individuals().map((i) => ({ i, key: fold(nameOf(i)) })));

  private search(q: string): Individual[] {
    const f = fold(q.trim());
    return f ? this.folded().filter((x) => matchesTerms(x.key, f)).slice(0, 30).map((x) => x.i) : [];
  }
  readonly matches = {
    a: computed(() => this.search(this.query.a())),
    b: computed(() => this.search(this.query.b())),
  };

  person(slot: Slot): Individual | undefined {
    const id = this.chosen[slot]();
    return id ? this.byId().get(id) : undefined;
  }

  readonly result = computed(() => {
    const a = this.chosen.a();
    const b = this.chosen.b();
    return a && b ? relationship(a, b, this.byId(), this.unionMap()) : null;
  });

  readonly trace = computed(() => {
    const path = this.result()?.path ?? [];
    return path.length > 1 ? traceLayout(path, this.store.unions()) : null;
  });

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  pick(slot: Slot, id: string): void {
    this.chosen[slot].set(id);
    this.query[slot].set('');
  }
}
