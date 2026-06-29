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

export const UNION_R = 14; // union dot radius — keep in sync with dag-layout.ts

@Component({
  selector: 'app-tree-view',
  templateUrl: './tree.html',
  styleUrl: './tree.scss',
})
export class TreeViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('svgEl') private svgEl!: ElementRef<SVGSVGElement>;
  @ViewChild('chartLayer') private chartLayerEl!: ElementRef<SVGGElement>;

  protected readonly store = inject(TreeStore);

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

  displayName(p: Individual): string {
    const n = p.names[0];
    if (!n) return 'Unknown';
    const full = n.full || [n.given, n.surname].filter(Boolean).join(' ');
    return full.length > 22 ? full.slice(0, 21) + '…' : (full || 'Unknown');
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

  readonly CARD_W = CARD_W;
  readonly CARD_H = CARD_H;
  readonly UNION_R = UNION_R;
}
