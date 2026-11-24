# Flujos conectados de VECA

Alcance: panel web y API; Flutter queda fuera de esta entrega. Base de la iteración: `54a5593`.

## Criterios de aceptación

| Punto                | Comportamiento implementado                                                                                                                                                                                                                                     | Evidencia                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Permisos             | Roles y alcance de obra en API; acciones de Almacén y separación de consulta, gestión contable, emisión y personal. La interfaz refleja los permisos.                                                                                                           | security-flow, access-flow, work-teams-flow, connected-workflows-flow |
| Leads y Obras        | Entrega a Operaciones, aceptación por coordinador, equipo y tareas por trabajador, bloqueo con motivo, avances y revisión final.                                                                                                                                | work-teams-flow, works-flow, workflow-supply-flow, navegador          |
| Almacén              | Solicitudes, reservas sin sobrecomprometer existencias, compras, recepción, guías con varios materiales/solicitudes, recepción en obra, consumo y devolución.                                                                                                   | warehouse-flow, workflow-supply-flow, connected-workflows-flow        |
| Guías y Contabilidad | Revisión y emisión por permiso; documentos, cobros, sustento y margen reunidos por obra. Descarte local de preparaciones no emitidas; las guías aceptadas o inciertas no se descartan.                                                                          | dispatch-flow, warehouse-flow, connected-workflows-flow, navegador    |
| Inicio y cierre      | Bandejas por permiso y alcance, contadores completos y listas acotadas con enlaces directos. Cierre físico comprueba tareas, solicitudes, reservas, recepción, devolución, material en obra, equipos y guías; los pendientes económicos siguen visibles aparte. | connected-workflows-flow, works-flow, navegador                       |

## Recuperación y concurrencia

- El reparto de una guía se guarda antes de mover stock y no se recalcula al reintentar.
- La preparación bloquea las solicitudes por versión. Si aborta antes de mover stock, incrementa también las versiones aún no bloqueadas para impedir una preparación tardía.
- Cada tramo guía/material/solicitud tiene identidad estable. Los movimientos y finalizaciones se repiten sin duplicar existencias ni cantidades entregadas.
- Se probó interrupción después del primer movimiento y después de finalizar la primera solicitud.
- Se probó reanudar entregas de la versión anterior con stock ya aplicado, tanto con salida confirmada como sin ella.
- La cancelación de preparación no permite ignorar movimientos ya aplicados. Un contador de preparación en la guía impide que un intento previo vuelva a reclamarla tras cancelar.
- Las operaciones entre colecciones impiden cerrar la obra mientras se escriben; las tareas usan el mismo CAS de la ficha. Los recibos durables permiten retirar marcadores tras una respuesta perdida.
- Se probaron devolución de equipo tras su CAS, creación de guía tras insert y pérdida de respuesta, y cierre concurrente con envío a revisión/emisión.
- Descartar una preparación compite por versión/estado con emitirla. Operaciones no puede descartar borradores cuyo origen es Contabilidad.

## Comprobaciones ejecutadas

- `npm run typecheck`
- `npm run build`
- `npm test`: 16 pruebas.
- Flujos locales: `security-flow`, `access-flow`, `work-teams-flow`, `works-flow`, `crm-flow`, `warehouse-flow`, `dispatch-flow`, `workflow-supply-flow`, `connected-workflows-flow`.
- La comprobación de seguridad cubre 55 combinaciones privadas de ruta/método sin sesión.
- Chromium: formularios guardados, alcance del trabajador, selector flotante y Escape, reserva, Inicio, cierre y seguimiento económico, escritorio y móvil hasta 320 px.
- Revisión thermonuclear independiente de seguridad/corrección y de mantenibilidad; se corrigieron sus hallazgos antes de publicar.

Ejecutar los flujos con `VECA_GUIDE_QA_MOCK=1 node scripts/local-qa.mjs`, únicamente contra Mongo y almacenamiento aislados. Separar grupos de pruebas o reiniciar QA para respetar los límites de autenticación y peticiones del servidor.

## Límites de la validación

La emisión/consulta fiscal se valida con un proveedor simulado. Esta evidencia no acredita por sí sola la configuración ni la habilitación del emisor productivo, y no se emitieron facturas ni guías reales. La revisión económica conserva visibles los materiales sin valorizar y los costos de personal no confirmados.

El despliegue y la configuración de proveedores externos se comprueban por separado de las pruebas locales.
