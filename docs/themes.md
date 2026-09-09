# Themes and visual configuration

The entry-page theme picker offers three themes. Selection is stored in
`vibesim.ui.theme`; a valid `?theme=` query overrides the saved choice. The default
is `vscode`. Invalid values fall back to a valid saved choice or the default.

| ID | Theme | Character |
| --- | --- | --- |
| `vscode` | VS Code Dark | Neutral dark surfaces with blue and green accents. |
| `light` | VS Code Light | Light editor-style surfaces. |
| `warm` | Warm Paper | Warm surfaces with the current typography and layout. |

Changing themes reloads the page so module-level ECharts and Canvas colors are
initialized consistently with the MUI theme. Images and third-party embeds are
not recolored. Terminal-provided RGB values retain their hue while the renderer
adjusts their readability for the active light/dark mode.

## Source of truth

| File, relative to `app/src/` | Responsibility |
| --- | --- |
| `theme/palettes.ts` | Theme IDs, labels, modes and base palettes. |
| `theme/selection.ts` | URL/storage precedence and theme changes. |
| `theme/colors.ts` | Derived chart, terminal, syntax and surface colors. |
| `theme/metrics.ts` | Shared reading scale and page widths. |
| `theme.ts` | Public tokens, derived colors and MUI configuration. |
| `components/ThemePicker.tsx` | Theme selection control. |

Use tokens for ordinary controls and named `colors` roles for charts. Use
`withAlpha` for transparency rather than duplicating RGB literals. Legacy names
such as `teal` are compatibility aliases, not instructions to hard-code that hue.
`SurfaceCard` provides a neutral themed shell; it does not draw an accent edge.

The current shared metrics are `fontScale: 1.125`, `pageWidth: '80%'`, and
`readingWidth: '45rem'`. Numeric MUI font sizes are converted from the 16px design
baseline to rem; charts use `chartFont`. Change these centrally rather than
adding unrelated per-page scaling rules.

Kernel identities use a consistent color mapping. Optimality ladders distinguish
kernel work, imbalance, idle time and fusion with semantic roles. A decorative
color strip must not imply a measured time distribution.

## Making changes

Add a theme through the palette registry, with a complete palette and light/dark
mode. Check its URL override, persistence, entry catalog, dense charts, CostTree,
Agent text and terminal logs. Check desktop and narrow layouts when changing
fonts or widths.

Keep automated tests focused on selection behavior, persistence, meaningful color
mapping and interactions. Avoid assertions for exact RGB values or decorative
spacing. Full-page WCAG auditing is outside the maintained research test suite;
keyboard controls and meaningful interactions remain covered. Historical screenshot reviews do
not establish that the current revision passes an accessibility audit.

`npm run lint` enforces shared font-family and color references in application
TypeScript/JSX, including chart properties, Canvas assignments, conditional
values and local constants. Define literal palettes and fonts in `src/theme.ts`
or `src/theme/`; elsewhere use `tokens`, `colors`, `withAlpha`, or shared CSS
variables. Theme definitions and test fixtures are excluded. Numeric MUI sizes
and `chartFont` retain the scaling described above. This is a static check, not
runtime tracking of imported or computed values. Its regression tests run as
part of lint (`npm run test:lint` also runs them independently).
