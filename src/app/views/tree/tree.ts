import {
  Component, ViewChild, ElementRef, AfterViewInit, OnDestroy,
  computed, signal, effect, inject, Injector, afterNextRender, HostListener,
  ChangeDetectionStrategy
} from '@angular/core';
import { select } from 'd3-selection';
import { zoom, ZoomBehavior, zoomIdentity } from 'd3-zoom';
import { TreeStore } from '../../core/tree-store/tree.store';
import { buildCompleteLayout, CARD_W, CARD_H, LayoutNode, LayoutEdge } from '../../layout/pedigree-layout';
import { Individual } from '../../core/model/types';
import { MediaService } from '../../media/media.service';
import { SearchService } from '../../core/search/search.service';
import { fold, matchesTerms } from '../../core/search/search-util';
import { PersonEditorComponent } from '../../ui/person-editor/person-editor';
import { wrapToLines } from './wrap-text';
import { ExportService } from '../../export/export.service';


@Component({
  selector: 'app-tree-view',
  imports: [PersonEditorComponent],
  templateUrl: './tree.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tree.scss',
})
export class TreeViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('svgEl') private svgEl!: ElementRef<SVGSVGElement>;
  @ViewChild('chartLayer') private chartLayerEl!: ElementRef<SVGGElement>;

  protected readonly store = inject(TreeStore);
  protected readonly media = inject(MediaService);
  protected readonly search = inject(SearchService);
  private readonly exportService = inject(ExportService);

  readonly focusId = signal<string | null>(null);
  /** The person the drawing is centred on, named above it so the reader knows whose tree this view is around. */
  readonly focusPerson = computed(() => {
    const id = this.focusId();
    return id ? this.store.individuals().find((i) => i.id === id) ?? null : null;
  });

  // Search in tree mode is a "jump to person": matches surface in a dropdown,
  // and picking one focuses the tree on them.
  readonly searchMatches = computed(() => {
    const q = fold(this.search.query().trim());
    if (!q) return [];
    return this.store.individuals()
      .filter((i) => matchesTerms(fold(i.names[0]?.full ?? ''), q))
      .slice(0, 8)
      .map((i) => ({ id: i.id, name: i.names[0]?.full || '(no name)', years: this.years(i) }));
  });

  selectResult(id: string): void {
    this.setFocus(id);
    this.search.query.set('');
    this.search.open.set(false); // phones: the search over the top bar closes once a person is picked
    this.centerOnFocus();
  }

  /** A card chosen in the drawing: focus that person and centre the view on them. */
  onCardChosen(id: string): void {
    this.setFocus(id);
    this.centerOnFocus();
  }

  /** Pan (at scale 1) so the focused person sits in the viewport centre; with nobody focused, the drawing's corner. */
  private centerOnFocus(): void {
    if (!this.svgEl || !this.zoomBehavior) return;
    const svg = this.svgEl.nativeElement;
    const focus = this.layout().nodes.find((n) => n.isFocus);
    let t = zoomIdentity.translate(40, 40);
    if (focus) {
      const rect = svg.getBoundingClientRect();
      t = zoomIdentity.translate(rect.width / 2 - (focus.x + CARD_W / 2), rect.height / 2 - (focus.y + CARD_H / 2));
    }
    this.zoomBehavior.transform(select<SVGSVGElement, unknown>(svg), t);
    this.panned = false;
  }

  private zoomBehavior?: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef);
  // True once the reader drags, wheels or pinches; a resize then leaves their position alone.
  private panned = false;
  private resizeObserver?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;

  // Auto-select first person when the tree loads, and re-select if the focused
  // person goes away (e.g. was deleted); the new focus is centred once it is drawn.
  private readonly _autoFocus = effect(() => {
    const people = this.store.individuals();
    if (people.length === 0) return;
    const fid = this.focusId();
    if (!fid || !people.some((p) => p.id === fid)) {
      this.focusId.set(people[0].id);
      afterNextRender(() => this.centerOnFocus(), { injector: this.injector });
    }
  });

  readonly layout = computed(() => {
    const focusId = this.focusId();
    const individuals = this.store.individuals();
    const unions = this.store.unions();
    if (!focusId || individuals.length === 0) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[] };
    const iMap = new Map(individuals.map(i => [i.id, i]));
    const uMap = new Map(unions.map(u => [u.id, u]));
    const orientation = this.familyOrientation();
    const vertical = orientation === 'vertical';
    const compact = orientation === 'compact' ? this.compactRows() : false;
    return buildCompleteLayout(focusId, iMap, uMap, undefined, vertical, compact);
  });

  /** Family view direction: generations left→right (default) or top→bottom. */
  readonly familyOrientation = signal<'horizontal' | 'vertical' | 'compact'>('horizontal');
  /** Compact view: how many generations run top to bottom before the cascade starts. */
  readonly compactRows = signal(4);

  // The layout choices: open in the toolbar row on wide screens, a popover under "View options" on phones.
  @ViewChild('viewOptions') private viewOptionsEl?: ElementRef<HTMLDetailsElement>;
  protected readonly viewOptionsOpen = !this.isPhone();

  private isPhone(): boolean {
    return typeof matchMedia === 'function' && !matchMedia('(min-width: 601px)').matches;
  }

  /** Pick a layout; on phones the popover closes, except for Compact, whose Rows setting is in it. */
  chooseOrientation(o: 'horizontal' | 'vertical' | 'compact'): void {
    this.familyOrientation.set(o);
    if (o !== 'compact') this.closeViewOptions();
  }

  /** Close the phone popover (wide screens keep the choices in the row). Escape returns focus to its button. */
  closeViewOptions(focusSummary = false): void {
    const d = this.viewOptionsEl?.nativeElement;
    if (!d?.open || !this.isPhone()) return;
    d.open = false;
    if (focusSummary) d.querySelector('summary')?.focus();
  }

  // Jump-to-person results from the keyboard: ArrowDown in the top-bar search field moves into them.
  @HostListener('document:keydown', ['$event'])
  onDocumentKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (e.key !== 'ArrowDown' || !target?.classList.contains('search-field') || !this.searchMatches().length) return;
    e.preventDefault();
    this.resultButtons()[0]?.focus();
  }

  /** Up/Down move between results (wrapping), Escape clears the search and returns to the field. */
  onResultsKey(e: KeyboardEvent): void {
    const items = this.resultButtons();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.search.query.set('');
      document.querySelector<HTMLInputElement>('input.search-field')?.focus();
    }
  }

  private resultButtons(): HTMLButtonElement[] {
    return [...(this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.tsr-item')];
  }

  // A tap anywhere outside the phone popover closes it.
  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    const d = this.viewOptionsEl?.nativeElement;
    if (d?.open && !d.contains(e.target as Node)) this.closeViewOptions();
  }


  ngAfterViewInit(): void {
    const svgNative = this.svgEl.nativeElement;
    const layer = this.chartLayerEl.nativeElement;
    const svg = select<SVGSVGElement, unknown>(svgNative);

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      // The visible area, measured here: d3's default reads the SVG's viewBox and width, which not every environment has.
      .extent((): [[number, number], [number, number]] => {
        const r = svgNative.getBoundingClientRect();
        return [[0, 0], [r.width, r.height]];
      })
      .on('zoom', e => {
        layer.setAttribute('transform', e.transform.toString());
        // A change made by the reader (drag, wheel, pinch) carries the DOM event; our own centring does not.
        if (e.sourceEvent) this.panned = true;
      });

    svg.call(this.zoomBehavior);
    this.zoomBehavior.transform(svg, zoomIdentity.translate(40, 40));
    this.exportService.chart.set(layer); // the Export menu renders PDF/SVG/JPG from it

    // The canvas can change size (window resize, rotation): centre again, unless the reader moved the drawing.
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => { if (!this.panned) this.centerOnFocus(); }, 100);
      });
      this.resizeObserver.observe(svgNative);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    clearTimeout(this.resizeTimer);
    this.exportService.chart.set(null);
    if (this.svgEl) {
      select<SVGSVGElement, unknown>(this.svgEl.nativeElement).on('.zoom', null);
    }
  }

  /** The Recenter button: back to the focused person (the drawing can be panned far away from them). */
  recenter(): void {
    this.centerOnFocus();
  }

  setFocus(id: string): void { this.focusId.set(id); }

  edgePath(e: LayoutEdge): string {
    if (e.ladder) {
      // down the spine beside the parent, then straight across into the child
      return `M${e.x1},${e.y1} V${e.y2} H${e.x2}`;
    }
    if (e.elbow) {
      // straight segments: down from the parent, across at the halfway line, down to the child
      const my = (e.y1 + e.y2) / 2;
      return `M${e.x1},${e.y1} V${my} H${e.x2} V${e.y2}`;
    }
    if (e.vertical) {
      const my = (e.y1 + e.y2) / 2;
      return `M${e.x1},${e.y1} C${e.x1},${my} ${e.x2},${my} ${e.x2},${e.y2}`;
    }
    const mx = (e.x1 + e.x2) / 2;
    return `M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`;
  }

  // Full, untruncated name — used for the card's aria-label.
  displayName(p: Individual): string {
    const n = p.names[0];
    if (!n) return 'Unknown';
    return (n.full || [n.given, n.surname].filter(Boolean).join(' ')) || 'Unknown';
  }

  // Pixel width of name text at the card's 14px serif, measured via canvas
  // (accurate per-glyph); falls back to a char estimate where canvas is absent
  // (unit tests / SSR). Built once.
  private readonly _measure = (() => {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = "14px 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";
    } catch {
      ctx = null;
    }
    return (s: string): number => (ctx ? ctx.measureText(s).width : s.length * 7.1);
  })();

  // text starts at x=64 (after the avatar); leave ~12px right padding.
  readonly NAME_MAX_W = CARD_W - 64 - 12;

  /** Person name wrapped to fit the card — at most 2 lines, ellipsis if longer. */
  nameLines(p: Individual): string[] {
    const lines = wrapToLines(this.displayName(p), this._measure, this.NAME_MAX_W, 2);
    return lines.length ? lines : ['Unknown'];
  }

  initials(p: Individual): string {
    const n = p.names[0];
    return ((n?.given?.[0] ?? '') + (n?.surname?.[0] ?? '')).toUpperCase() || '?';
  }

  years(p: Individual): string {
    const y = (type: string) => p.events.find(e => e.type === type)?.date?.match(/\d{4}/)?.[0];
    const b = y('BIRT');
    const d = y('DEAT');
    return b || d ? `${b ?? '?'}–${d ?? ''}`.replace(/–$/, '') : '';
  }

  readonly CARD_W = CARD_W;
  readonly CARD_H = CARD_H;
}
