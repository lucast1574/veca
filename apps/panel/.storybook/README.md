# Vistas de trabajo de VECA

Desde la raíz: `npm run storybook -w @veca/panel`.

Incluye Obras con actividad, una obra con pendientes y dos estados del margen por obra. Se usan los componentes reales del panel, con datos ficticios interceptados por MSW en `veca-storybook.invalid`. No requiere una API, cuentas ni datos de producción. Las acciones sin un escenario definido muestran un error de vista de ejemplo.

`npm run typecheck-storybook -w @veca/panel` valida los escenarios. `npm run build-storybook -w @veca/panel` genera la vista estática local en `storybook-static`, excluida de Git y del panel desplegado.

El archivo `public/mockServiceWorker.js` pertenece exclusivamente a Storybook. No copiarlo al directorio público de la aplicación.
