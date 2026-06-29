import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopBarComponent } from './top-bar';
import { SearchService } from '../../core/search/search.service';

describe('TopBarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopBarComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should render the wordmark', () => {
    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.wordmark')?.textContent?.trim()).toBe('Kaliwat');
  });

  it('should render List and Tree tabs', () => {
    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent?.trim()).toBe('List');
    expect(tabs[1].textContent?.trim()).toBe('Tree');
  });

  it('should render the Import button', () => {
    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.import-btn');
    expect(btn?.textContent?.trim()).toBe('Import');
  });

  it('writes the search box value into the shared SearchService', () => {
    const search = TestBed.inject(SearchService);
    search.query.set('');
    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-field');
    input.value = 'maria';
    input.dispatchEvent(new Event('input'));
    expect(search.query()).toBe('maria');
  });

  it('reflects the SearchService query back into the input', () => {
    const search = TestBed.inject(SearchService);
    search.query.set('reyes');
    const fixture = TestBed.createComponent(TopBarComponent);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-field');
    expect(input.value).toBe('reyes');
  });
});
