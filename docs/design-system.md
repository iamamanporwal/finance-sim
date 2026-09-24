# Design System

MUI v7 (`apps/web/src/theme/theme.ts`) with Roboto and tabular numbers (`.num`).

- **Neutral base:** background `#F8FAFC`, surface `#FFFFFF`, text `#111827` / `#64748B`, border `#E2E8F0`.
- **Primary:** indigo `#4F46E5`. **Simulation and AI:** violet `#7C3AED`, used for the Run button, the simulated values on nodes and the selected period.
- **Semantic colors:** green = healthy, amber = warning, red = risk, blue = information.
- **Node category colors:** inputs blue, customers purple, revenue green, costs orange, resources cyan, logic gray. They appear only as a dot, the port rings and edge color, so the canvas stays calm.
- **Node borders:** red = error or part of a cycle, amber = warning, indigo = selected.
- **Type scale:** H1 30 · H2 22 · H3 18 · body 14 · secondary 12–13 · KPI 26.
- Every financial term has an ⓘ tooltip (`MetricInfo`, driven by `METRIC_DEFINITIONS`).
- Formatting (`lib/format.ts`) never shows NaN, Infinity or undefined. Undefined metrics get words such as "Not burning" or "No revenue yet".
- Desktop is the primary target (canvas at ≥1280px). The results dashboard collapses to 1–2 columns on narrow screens.
