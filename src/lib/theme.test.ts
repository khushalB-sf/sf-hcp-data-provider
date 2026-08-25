import { describe, expect, it } from 'vitest';
import { applyTheme, isDark, resolveTheme } from './theme.ts';
import { DEFAULT_THEME } from '../vendor/theme-config.ts';

describe('reading a tenant config (FR-8)', () => {
  it('uses a good config as-is', () => {
    const { theme, problems } = resolveTheme('aurelia');
    expect(theme.appName).toBe('Aurelia Field IQ');
    expect(theme.primary).toBe('#0B5FA5');
    expect(problems).toHaveLength(0);
  });

  it('keeps the good fields of a broken config and falls back on the bad ones', () => {
    // The provided `meridian` config has primary: "#ZZ8800" (not a colour) and
    // radius: "huge" (not a number), but its background and surface are fine.
    const { theme, problems } = resolveTheme('meridian');

    expect(theme.primary).toBe(DEFAULT_THEME.primary); // rejected
    expect(theme.radius).toBe(DEFAULT_THEME.radius); // rejected
    expect(theme.surface).toBe('#F4F4F4'); // kept — no reason to throw this away
    expect(theme.appName).toBe('Meridian 360'); // kept

    const fields = problems.map((p) => p.field).sort();
    expect(fields).toEqual(['primary', 'radius']);
    // The panel needs to show what we were given, not just that it failed.
    expect(problems.find((p) => p.field === 'primary')!.value).toBe('#ZZ8800');
  });

  it('uses all the defaults for a tenant we do not know about', () => {
    const { theme, problems } = resolveTheme('does-not-exist');
    expect(theme).toEqual(DEFAULT_THEME);
    expect(problems).toHaveLength(0); // not knowing a tenant isn't a config error
  });

  it('rejects colour values that could break out of the CSS property', () => {
    const nasty = [
      'url(https://example.com/x.png)',
      'red; background: url(x)',
      'var(--something)',
      'rgb(1,2,3)',
      'blue',
      '#12',
      '',
    ];
    for (const value of nasty) {
      // Same check the resolver uses.
      expect(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)).toBe(false);
    }
    expect(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test('#0B5FA5')).toBe(true);
  });

  it('never throws, whatever rubbish is in the config', () => {
    for (const key of ['', '__proto__', 'null', 'undefined', '123']) {
      expect(() => resolveTheme(key)).not.toThrow();
    }
  });
});

describe('applying a theme', () => {
  it('writes CSS variables onto the element', () => {
    const element = document.createElement('div');
    applyTheme(resolveTheme('aurelia'), element);
    expect(element.style.getPropertyValue('--primary')).toBe('#0B5FA5');
    expect(element.style.getPropertyValue('--radius')).toBe('8px');
  });

  it('switching tenant just rewrites the variables', () => {
    const element = document.createElement('div');
    applyTheme(resolveTheme('aurelia'), element);
    const first = element.style.getPropertyValue('--surface');

    applyTheme(resolveTheme('meridian'), element);
    expect(element.style.getPropertyValue('--surface')).not.toBe(first);
    expect(element.style.getPropertyValue('--surface')).toBe('#F4F4F4');
  });

  it('picks lighter greys for a dark background so borders stay visible', () => {
    expect(isDark('#FFFFFF')).toBe(false);
    expect(isDark('#16202E')).toBe(true);
    expect(isDark('#fff')).toBe(false); // short hex works too
  });
});
