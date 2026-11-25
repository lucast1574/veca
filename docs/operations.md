# Operación comercial y almacén

La landing registra consultas en `POST /public/consultations`. Nombre, teléfono, correo, distrito, tipo de trabajo e idea son obligatorios. El identificador de envío hace seguro reintentar sin duplicar una oportunidad. Las etiquetas comerciales se asignan en el servidor y solo se muestran al equipo: reparación/hogar → low; residencia integral → high; edificio → large. El administrador puede corregirlas.

## Flujo

Prelead → Lead contactado → Coordinación → Obra en ejecución → Obra realizada. El servidor exige, respectivamente, resultado del contacto, cita en hora de Lima, dirección y alcance, y nota de cierre. Se puede descartar con motivo o reabrir un descartado como prelead. No se omiten etapas. Cada guardado usa una revisión optimista para no sobrescribir cambios de otro operador.

La ficha contiene contacto, responsable, alcance, cita, estado y referencia del contrato, notas, fotos privadas, contratos PDF y movimientos de materiales. El estado “firmado” es un registro del equipo, no una firma electrónica. Subir fotos a la ficha no publica un proyecto editorial.

## Inventario

Cada material tiene código único, familia, unidad, ubicación y mínimo. Comienza con saldo cero: el saldo inicial se registra como entrada, con motivo. El consumo se vincula a una obra en ejecución o realizada y descuenta al confirmarlo. Las devoluciones reintegran existencias. Terminar la obra no vuelve a descontar. No se modifican ni eliminan movimientos históricos; se registra un movimiento compensatorio.

Las cantidades usan enteros de milésimas en MongoDB. Una actualización atómica de un documento confirma a la vez stock y evento pendiente. Una bandeja durable entrega los eventos al historial de forma idempotente, al arrancar, al consultar movimientos y cada 15 segundos. Esto funciona en MongoDB standalone sin exigir un replica set. El identificador de operación evita doble cargo ante reintentos. La revisión y el filtro de saldo impiden consumos simultáneos que dejen stock negativo.

El panel recibe avisos por SSE autenticado y refresca cada 15 segundos como respaldo. Los avisos no contienen datos personales. Una ficha con cambios sin guardar conserva el borrador y avisa si su versión ha cambiado en otra sesión.

## Acceso y archivos

Todo `/admin/crm` usa el administrador existente y CSRF en escrituras. La ruta pública devuelve solo una referencia; no permite leer datos. Las fotos se validan y normalizan con Sharp; los PDF se descargan como adjuntos. Todos los archivos se sirven por rutas autenticadas y se guardan bajo `veca/leads/`. No se crean nuevos usuarios ni se mezclan archivos públicos con contratos privados.

## Pruebas

Después de `npm run build`, ejecutar `node scripts/local-qa.mjs` en un proceso independiente y `node tests/crm-flow.mjs`. Los datos y S3 de QA son locales y desechables. La prueba cubre captura idempotente, etiquetas, privacidad, CSRF, etapas, revisiones, adjuntos privados, saldos decimales, concurrencia, reintentos y recuperación de un evento pendiente. CI también ejecuta el flujo editorial existente.

## Extensiones previstas

Reservas para cotizaciones, presupuestos y costos, proveedores y compras, cortes/mermas de vidrio, roles del equipo y firma electrónica se incorporan como módulos separados. No deben confundirse las reservas con el consumo físico ni publicar contratos o contactos en los proyectos de la web.

## Compras de SUNAT y registro interno

En **Contabilidad → Compras y gastos**, Materiales por completar reúne las solicitudes de compra de Obras y las facturas clasificadas como materiales. Contabilidad registra proveedor, productos, cantidades compradas y precios unitarios sin IGV. El detalle de una factura debe sumar exactamente su importe neto. Al guardar se envía un aviso a Almacén; no aumenta stock. Desde una factura recién incorporada o un registro manual de materiales se abre este detalle automáticamente. Los registros pendientes permanecen visibles para completarlos después.

En **Inventario → Pedidos y recepciones**, Almacén consulta lo comprado y confirma la cantidad que llegó físicamente, incluyendo entregas parciales. No registra ni modifica cantidades compradas o precios. Si falta el detalle, la vista indica Pendiente de Contabilidad; únicamente quien puede escribir en Contabilidad recibe un acceso para completarlo allí. La confirmación conserva la cantidad pendiente y protege el stock ante reintentos. La cancelación del pedido también corresponde a Contabilidad y conserva el comprobante.

El documento de entrega es opcional tanto en el panel como en la API. Si el proveedor no entregó uno, Almacén puede confirmar la recepción sin inventar una referencia. Se conservan material, cantidad, responsable, fecha y operación; el historial muestra Recepción sin documento y los reintentos mantienen la protección del stock.

La API exige `accounting` y `accounting_write` para crear, preparar y cancelar compras, incluso en las rutas anteriores de Almacén. Los endpoints de Contabilidad para pedidos y catálogo no exigen acceso a Inventario. Confirmar la entrega física exige `inventory` e `inventory_receive`. La etiqueta de una pantalla o un permiso antiguo de administración de compras no permite saltar esa separación.

En Contabilidad → Compras y gastos, **Compras por registrar** es una bandeja persistente de facturas de proveedores, no un registro de pagos. El servidor consulta el mes actual y el anterior cada 15 minutos, reanuda trabajos pendientes y reintenta fallos con una espera de 5 minutos. El panel refresca la bandeja visible cada 30 segundos. Actualizar compras permite consultar otro periodo; cerrar el modal conserva el trabajo para que el servidor lo termine. No hay presentación fiscal automática.

Cada factura permite completar un concepto y elegir gasto general, gasto de una obra o factura de una compra de Inventario. Los datos fiscales vienen del TXT original de SUNAT. Solo las facturas en PEN, con fecha y desglose neto/IGV válido y sin otros cargos, pueden incorporarse por este flujo. Otros tipos, monedas, discrepancias y duplicados se conservan para revisión; no se convierten ni se estiman impuestos.

La incorporación crea un comprobante interno **pendiente de revisión**, con identidad estable y protección única por RUC del proveedor, serie y número. Se revisan también los registros anteriores sin clave normalizada. La creación manual sigue disponible y usa la misma protección. No genera pagos, recepciones ni movimientos de stock al clasificar. Si se marca como materiales para almacén y no hay una compra vinculada, crea una tarea durable para que Contabilidad registre los productos, cantidades y precios, con un aviso interno y push según la configuración del usuario. Si ya existe una compra, conserva ese vínculo. Una bandeja de recuperación reintenta derivaciones incompletas cada 30 segundos, sin repetir órdenes ni avisos. Al vincular a Inventario se usa la orden existente y el costo de materiales continúa imputándose por consumo; una referencia de recepción coincidente exige ese vínculo.

Impuestos distingue los resultados de ventas de la bandeja de compras. El modal de presentación mensual ofrece la revisión de pendientes y el acceso a SOL. **No acepta propuestas, no registra preliminares ni presenta libros desde VECA**: la generación definitiva del registro se completa en SOL, según la documentación oficial de SUNAT (https://cpe.sunat.gob.pe/node/131). La emisión directa de facturas de venta permanece en Facturas y cobros.

Validación local aislada: `VECA_GUIDE_QA_MOCK=1 VECA_SIRE_QA_MOCK=1 node scripts/local-qa.mjs`, luego `node tests/sire-flow.mjs` y `node tests/sire-purchases-flow.mjs`. No ejecutar estos flujos contra producción. Storybook incluye la bandeja, el modal y el estado de compras guardadas con datos ficticios.

### Clasificación y comprobación manual

La categoría distingue materiales para almacén, comidas y reuniones, servicios y los demás gastos. Solo materiales se derivan a Inventario. Contabilidad selecciona los materiales, cantidades y precios unitarios; si el material no existe, puede crearlo desde el mismo detalle, con código único y saldo cero. El nuevo material queda seleccionado sin perder las cantidades ni precios escritos. Los detalles opcionales del catálogo permanecen plegados. Almacén confirma después lo recibido; esa recepción es la que modifica el stock. Las cenas y servicios permanecen en Contabilidad y pueden asignarse a una obra o quedar como gasto general.

Al crear un gasto manual con RUC y serie/número identificables, el servidor comprueba los registros internos y los datos de SUNAT. Si no hay una coincidencia descargada, consulta el periodo de emisión y el actual; las consultas exitosas recientes se reutilizan durante 30 segundos. Una respuesta pendiente o fallida no crea un registro. La UI conserva el formulario y muestra un aviso para abrir la factura encontrada, trasladando concepto, categoría y distribución entre obras. El guardado manual de documentos aún no propuestos sigue disponible después de una comprobación sin coincidencias. Los registros internos sin identidad fiscal y los consumos de materiales no pasan por esta consulta.

Los Select y SearchableSelect compartidos usan popover flotante por defecto. El menú conserva el tema y la relación con el control, se coloca según el espacio de la pantalla y no participa en el tamaño ni el scroll del modal. Escape cierra primero las opciones y las flechas desplazan solo la lista.

Validar la clasificación con `node tests/purchase-classification-flow.mjs` en el mismo entorno aislado de QA con mocks SIRE. Cubre búsqueda fresca, redirección por duplicado, categorías sin almacén, tarea y aviso a Contabilidad, alta de catálogo con código único y sin stock, preparación por el contador sin stock, aviso a Almacén, aislamiento de permisos, recepción parcial e idempotente, caída del proveedor y registro manual sin coincidencias.

## Sugerencias del equipo

La sidebar incluye Sugerencias para todas las cuentas activas y verificadas, sin exigir un permiso de otro módulo. Es un foro interno: el equipo puede buscar por texto, filtrar por sección, publicar ideas y comentar las de otras personas. Las sugerencias y conversaciones solo están disponibles con sesión; no son contenido público de la web.

Nueva sugerencia, edición y comentarios usan los modales compartidos. El autor puede editar su idea y Administración puede editar o cambiar el estado: Nueva, En revisión, Aplicada o Cerrada. Administración conserva la misma comprobación de acceso usada en el resto del panel. Los empleados no pueden editar ideas ajenas ni cambiar estados. La identidad del autor procede de la sesión, nunca del formulario.

Los mensajes son texto simple con límites de longitud. La lista y los comentarios tienen paginación; las consultas visibles se actualizan cada 30 segundos. Los identificadores de envío evitan repetir ideas o comentarios al reintentar, y la edición y los estados comprueban la versión para evitar sobrescribir cambios simultáneos. No se generan sugerencias de ejemplo en producción.

Validar con `node tests/suggestions-flow.mjs` sobre el entorno aislado de QA. Cubre cuentas activas, pendientes, no verificadas y suspendidas, sesión y CSRF, autoría, reintentos, edición propia, estados de Administración, conflictos, búsquedas literales y paginación. Storybook incluye foro con actividad, conversación, nueva sugerencia, publicación y comentario, recuperación de errores y seguimiento de Administración con datos ficticios.
