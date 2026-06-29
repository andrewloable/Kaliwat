import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopBarComponent } from './top-bar';

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
});
