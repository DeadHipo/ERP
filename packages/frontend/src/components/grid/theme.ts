import { themeQuartz } from 'ag-grid-community';

/**
 * The one grid theme (17 §5). Every colour is a CSS variable from index.css, which in turn follows the HeroUI tokens,
 * so `html.dark` switches the grids with the page and no second JS theme is needed.
 */
export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: 'var(--grid-bg)',
  foregroundColor: 'var(--foreground)',
  accentColor: 'var(--accent)',
  borderColor: 'var(--grid-border)',
  chromeBackgroundColor: 'var(--grid-chrome)',
  headerBackgroundColor: 'var(--grid-chrome)',
  headerTextColor: 'var(--muted)',
  headerFontWeight: 600,
  rowHoverColor: 'var(--grid-row-hover)',
  selectedRowBackgroundColor: 'var(--grid-selected)',
  oddRowBackgroundColor: 'transparent',
  fontFamily: 'inherit',
  cellHorizontalPadding: 10,
  rowHeight: 36,
  headerHeight: 38,
  wrapperBorderRadius: 12,
  borderRadius: 8,
});
