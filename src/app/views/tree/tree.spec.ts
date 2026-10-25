import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { TreeViewComponent } from './tree';
import { TreeStore } from '../../core/tree-store/tree.store';
import type { Individual } from '../../core/model/types';
import { CARD_W, CARD_H } from '../../layout/pedigree-layout';

const person = (id: string, name: string): Individual => ({
  id, names: [{ full: `${name} Cruz`, given: name, surname: 'Cruz' }], sex: 'U', events: [], unions: [], mediaIds: [], notes: [],
});

describe('TreeViewComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  // The zoom is set up when the drawing is shown. It must not depend on the SVG's viewBox or width (jsdom and some
  // browsers do not give them), so the visible area is measured from the element instead.
  it('renders the drawing and sets up pan and zoom without an SVG viewBox', () => {
    TestBed.configureTestingModule({ imports: [TreeViewComponent] });
    const store = TestBed.inject(TreeStore);
    store.setTreeId('tree-view-test');
    store.setIndividuals([person('a', 'Rosa')]);
    const f = TestBed.createComponent(TreeViewComponent);
    expect(() => f.detectChanges()).not.toThrow();
    const svg = f.nativeElement.querySelector('svg.tree-svg') as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect((svg as unknown as { __zoom?: unknown }).__zoom).toBeDefined();
    expect(svg.querySelector('g')!.getAttribute('transform')).toContain('translate(40,40)');
  });

  // Rosa and Pedro are married with a child Juan. The layout follows each person's own list of families, so both
  // spouses name the family.
  function setupFamily() {
    TestBed.configureTestingModule({ imports: [TreeViewComponent] });
    const store = TestBed.inject(TreeStore);
    store.setTreeId('tree-click-test');
    const withFamily = (p: Individual): Individual => ({ ...p, unions: [{ unionId: 'F1' }] });
    store.setIndividuals([withFamily(person('a', 'Rosa')), withFamily(person('b', 'Pedro')), person('c', 'Juan')]);
    store.setUnions([{ id: 'F1', spouseIds: ['a', 'b'], events: [], childLinks: [{ childId: 'c', citations: [], notes: [] }] }]);
    const f = TestBed.createComponent(TreeViewComponent);
    f.detectChanges();
    const svg = f.nativeElement.querySelector('svg.tree-svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) });
    const card = (name: string) =>
      (Array.from(f.nativeElement.querySelectorAll('g.card-node')) as HTMLElement[]).find((c) => c.getAttribute('aria-label') === name)!;
    const expectCentredOnFocus = () => {
      const focus = f.componentInstance.layout().nodes.find((n) => n.isFocus)!;
      const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(svg.querySelector('g')!.getAttribute('transform')!)!;
      expect([+m[1], +m[2]]).toEqual([400 - (focus.x + CARD_W / 2), 300 - (focus.y + CARD_H / 2)]);
    };
    return { f, card, expectCentredOnFocus };
  }

  it('clicking a card focuses that person and centres the drawing on them', () => {
    const { f, card, expectCentredOnFocus } = setupFamily();
    card('Pedro Cruz').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.focusId()).toBe('b');
    expectCentredOnFocus();
  });

  it('pressing Enter on a card centres it too', () => {
    const { f, card, expectCentredOnFocus } = setupFamily();
    card('Pedro Cruz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.focusId()).toBe('b');
    expectCentredOnFocus();
  });
});
