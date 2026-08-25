import {
  DEFAULT_THEME,
  TENANT_THEMES,
  type TenantTheme,
} from '../vendor/theme-config.ts';

export const TENANT_KEYS = Object.keys(TENANT_THEMES);

export interface ResolvedTheme {
  theme: TenantTheme;
  /** Fields we had to reject, so the Diagnostics panel can list them. */
  problems: { field: string; value: string; usedInstead: string }[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

function isRadius(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24;
}

/**
 * FR-8: turn a tenant config into a theme we can actually use.
 *
 * The brief says these configs come from customers and can't be trusted, and
 * the `meridian` one proves it — `primary` is "#ZZ8800" (not a colour) and
 * `radius` is the string "huge".
 *
 * I check each field on its own rather than throwing out the whole config if
 * one field is bad. Meridian gets a valid background and surface, so it seemed
 * unfair to ignore those just because two other fields are broken.
 *
 * I only accept plain hex colours. Things like `url(...)` or a value with a
 * semicolon in it could break out of the CSS property, and there's no good
 * reason a theme colour would need them.
 */
export function resolveTheme(tenantKey: string): ResolvedTheme {
  const config = TENANT_THEMES[tenantKey] as Partial<TenantTheme> | undefined;
  const theme: TenantTheme = { ...DEFAULT_THEME };
  const problems: ResolvedTheme['problems'] = [];

  if (config === undefined) {
    // Unknown tenant. Not an error — just use the defaults for everything.
    return { theme, problems };
  }

  const colorFields = ['primary', 'onPrimary', 'background', 'surface', 'text'] as const;
  for (const field of colorFields) {
    const value = config[field];
    if (value === undefined) continue;
    if (isHexColor(value)) theme[field] = value.trim();
    else {
      problems.push({
        field,
        value: String(value),
        usedInstead: DEFAULT_THEME[field],
      });
    }
  }

  if (typeof config.appName === 'string' && config.appName.trim() !== '') {
    theme.appName = config.appName.trim();
  } else if (config.appName !== undefined) {
    problems.push({ field: 'appName', value: String(config.appName), usedInstead: DEFAULT_THEME.appName });
  }

  if (config.radius !== undefined) {
    if (isRadius(config.radius)) theme.radius = config.radius;
    else {
      problems.push({
        field: 'radius',
        value: String(config.radius),
        usedInstead: `${DEFAULT_THEME.radius}px`,
      });
    }
  }

  return { theme, problems };
}

/**
 * Write the theme into CSS variables on <html>.
 *
 * Doing it this way means switching tenant doesn't re-render the grid at all —
 * the browser just repaints with the new values. I use `setProperty` rather
 * than building a stylesheet string, so a weird value can't turn into extra CSS.
 */
export function applyTheme(resolved: ResolvedTheme, element: HTMLElement): void {
  const { theme } = resolved;
  const set = (name: string, value: string) => element.style.setProperty(name, value);

  set('--primary', theme.primary);
  set('--on-primary', theme.onPrimary);
  set('--background', theme.background);
  set('--surface', theme.surface);
  set('--text', theme.text);
  set('--radius', `${theme.radius}px`);

  // A few shades worked out from the theme, so a dark tenant theme doesn't end
  // up with invisible borders.
  const dark = isDark(theme.background);
  set('--muted', dark ? '#9aa7b4' : '#6b7684');
  set('--border', dark ? '#39424d' : '#e2e7ee');
  set('--border-strong', dark ? '#54606d' : '#b9c1cc');
  set('--row-hover', dark ? '#232a33' : '#f5f7fa');
  set('--selected-row', dark ? '#233448' : '#e6effa');
}

/** Rough brightness check so we can pick sensible greys. */
export function isDark(hexColor: string): boolean {
  const hex = hexColor.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Standard luminance formula.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
