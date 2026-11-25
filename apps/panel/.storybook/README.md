# Vistas de trabajo de VECA

Desde la raíz: `npm run storybook -w @veca/panel`.

Incluye Obras con actividad, las pestañas internas de una obra (coordinación y equipo, solicitudes, pendientes, materiales y equipos, guías/facturas y cierre), el margen por obra y las compras de proveedores. Almacén y stock recorre las solicitudes desde Obras, los pedidos derivados desde Contabilidad, el detalle de productos, cantidades compradas y precios en Contabilidad, el modal de confirmación en Almacén y el historial de un pedido recibido. Se usan los componentes reales del panel, con datos ficticios interceptados por MSW en `veca-storybook.invalid`. No requiere una API, cuentas ni datos de producción. Las acciones sin un escenario definido muestran un error de vista de ejemplo.

`npm run typecheck-storybook -w @veca/panel` valida los escenarios. `npm run build-storybook -w @veca/panel` genera la vista estática local en `storybook-static`, excluida de Git y del panel desplegado.

El archivo `public/mockServiceWorker.js` pertenece exclusivamente a Storybook. No copiarlo al directorio público de la aplicación.

Sugerencias del equipo muestra el foro interno, la conversación y los modales de publicación y comentario. Los escenarios verifican publicar y comentar, reintentar conservando el borrador y cambiar el estado con una cuenta de Administración. Se usan únicamente datos ficticios.

Los escenarios de confirmación y registro del detalle abren los modales reales y comprueban que el catálogo y las acciones estén disponibles. El escenario de material nuevo simula el alta con saldo cero, su selección automática y la conservación de cantidad y precio en el borrador de compra. Las cantidades y las facturas son ejemplos; las acciones no definidas no guardan ni modifican datos.

Las compras de proveedores también incluyen la actualización directa con compras nuevas, el aviso sin novedades, el reintento tras un error y la comparación separada con sus resultados. Se comprueban el estado de carga, la ausencia de modal al actualizar, una única consulta y el foco en la primera compra nueva.

Contabilidad por secciones incluye Impuestos con comparación de seis meses, barras de ventas/compras y distribución por categoría; Todas con resumen compacto y facturas del mismo periodo, actualización conjunta, diferencias de SUNAT en modal con retorno de foco y TXT del RVIE; guías mensuales en su sección y accesos desde Impuestos conservando el mes. También cubre los enlaces anteriores, las bandejas Solicitadas y Por cobrar sin filtro mensual, el modal de nueva factura, un periodo vacío y error/reintento sin presentar ceros como si la consulta hubiera terminado bien. Todos los importes son ficticios.
