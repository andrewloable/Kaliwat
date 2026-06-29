import {
  Component, ViewChild, ElementRef, AfterViewInit, OnDestroy,
  computed, signal, effect, inject,
} from '@angular/core';
import { select } from 'd3-selection';
import { zoom, ZoomBehavior, zoomIdentity } from 'd3-zoom';
import { TreeStore } from '../../core/tree-store/tree.store';
import { buildLayout, CARD_W, CARD_H, LayoutNode, LayoutEdge } from '../../layout/pedigree-layout';
import { buildDagLayout, DagNode, DagEdge } from '../../layout/dag-layout';
import { Individual } from '../../core/model/types';
import { MediaService } from '../../media/media.service';
import { PersonEditorComponent } from '../../ui/person-editor/person-editor';
import { wrapToLines } from './wrap-text';

export const UNION_R = 14; // union dot radius — keep in sync with dag-layout.ts

@Component({
  selector: 'app-tree-view',
  imports: [PersonEditorComponent],
  templateUrl: './tree.html',
  styleUrl: './tree.scss',
})
export class TreeViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('svgEl') private svgEl!: ElementRef<SVGSVGElement>;
  @ViewChild('chartLayer') private chartLayerEl!: ElementRef<SVGGElement>;

  protected readonly store = inject(TreeStore);
  protected readonly media = inject(MediaService);

  readonly mode = signal<'pedigree' | 'descendants' | 'family'>('pedigree');
  readonly focusId = signal<string | null>(null);

  private zoomBehavior?: ZoomBehavior<SVGSVGElement, unknown>;

  // Auto-select first person when tree loads
  private readonly _autoFocus = effect(() => {
    const people = this.store.individuals();
    if (people.length > 0 && !this.focusId()) {
      this.focusId.set(people[0].id);
    }
  });

  readonly layout = computed(() => {
    const focusId = this.focusId();
    const individuals = this.store.individuals();
    const unions = this.store.unions();
    if (!focusId || individuals.length === 0) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[] };
    const iMap = new Map(individuals.map(i => [i.id, i]));
    const uMap = new Map(unions.map(u => [u.id, u]));
    const mode = this.mode();
    if (mode === 'family') return { nodes: [], edges: [] }; // handled by dagLayout
    return buildLayout(focusId, mode, iMap, uMap);
  });

  readonly dagLayout = computed(() => {
    const focusId = this.focusId();
    const individuals = this.store.individuals();
    const unions = this.store.unions();
    if (this.mode() !== 'family' || !focusId || individuals.length === 0) {
      return { nodes: [] as DagNode[], edges: [] as DagEdge[] };
    }
    const iMap = new Map(individuals.map(i => [i.id, i]));
    const uMap = new Map(unions.map(u => [u.id, u]));
    return buildDagLayout(focusId, iMap, uMap);
  });

  ngAfterViewInit(): void {
    const svgNative = this.svgEl.nativeElement;
    const layer = this.chartLayerEl.nativeElement;
    const svg = select<SVGSVGElement, unknown>(svgNative);

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on('zoom', e => { layer.setAttribute('transform', e.transform.toString()); });

    svg.call(this.zoomBehavior);
    this.zoomBehavior.transform(svg, zoomIdentity.translate(40, 40));
  }

  ngOnDestroy(): void {
    if (this.svgEl) {
      select<SVGSVGElement, unknown>(this.svgEl.nativeElement).on('.zoom', null);
    }
  }

  recenter(): void {
    if (!this.svgEl || !this.zoomBehavior) return;
    this.zoomBehavior.transform(
      select<SVGSVGElement, unknown>(this.svgEl.nativeElement),
      zoomIdentity.translate(40, 40),
    );
  }

  setFocus(id: string): void { this.focusId.set(id); }

  edgePath(e: LayoutEdge): string {
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

  dagEdgePath(e: DagEdge): string {
    const my = (e.y1 + e.y2) / 2;
    return `M${e.x1},${e.y1} C${e.x1},${my} ${e.x2},${my} ${e.x2},${e.y2}`;
  }

  personNodes(nodes: DagNode[]): DagNode[] { return nodes.filter(n => n.type === 'person'); }
  unionNodes(nodes: DagNode[]): DagNode[] { return nodes.filter(n => n.type === 'union'); }

  // DESIGN.md: union node is labeled with the marriage year.
  unionYear(node: DagNode): string {
    if (!node.unionId) return '';
    const union = this.store.unions().find(u => u.id === node.unionId);
    return union?.events.find(e => e.type === 'MARR')?.date?.match(/\d{4}/)?.[0] ?? '';
  }

  readonly CARD_W = CARD_W;
  readonly CARD_H = CARD_H;
  readonly UNION_R = UNION_R;
}
