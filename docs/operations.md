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

En Contabilidad → Compras y gastos, **Compras por registrar** es una bandeja persistente de facturas de proveedores, no un registro de pagos. El servidor consulta el mes actual y el anterior cada 15 minutos, reanuda trabajos pendientes y reintenta fallos con una espera de 5 minutos. El panel refresca la bandeja visible cada 30 segundos. Actualizar compras permite consultar otro periodo; cerrar el modal conserva el trabajo para que el servidor lo termine. No hay presentación fiscal automática.

Cada factura permite completar un concepto y elegir gasto general, gasto de una obra o factura de una compra de Inventario. Los datos fiscales vienen del TXT original de SUNAT. Solo las facturas en PEN, con fecha y desglose neto/IGV válido y sin otros cargos, pueden incorporarse por este flujo. Otros tipos, monedas, discrepancias y duplicados se conservan para revisión; no se convierten ni se estiman impuestos.

La incorporación crea un comprobante interno **pendiente de revisión**, con identidad estable y protección única por RUC del proveedor, serie y número. Se revisan también los registros anteriores sin clave normalizada. La creación manual sigue disponible y usa la misma protección. No genera pagos, órdenes, recepciones ni movimientos de stock. Al vincular a Inventario se usa la orden existente y el costo de materiales continúa imputándose por consumo; una referencia de recepción coincidente exige ese vínculo.

Impuestos distingue los resultados de ventas de la bandeja de compras. El modal de presentación mensual ofrece la revisión de pendientes y el acceso a SOL. **No acepta propuestas, no registra preliminares ni presenta libros desde VECA**: la generación definitiva del registro se completa en SOL, según la documentación oficial de SUNAT (https://cpe.sunat.gob.pe/node/131). La emisión directa de facturas de venta permanece en Facturas y cobros.

Validación local aislada: `VECA_GUIDE_QA_MOCK=1 VECA_SIRE_QA_MOCK=1 node scripts/local-qa.mjs`, luego `node tests/sire-flow.mjs` y `node tests/sire-purchases-flow.mjs`. No ejecutar estos flujos contra producción. Storybook incluye la bandeja, el modal y el estado de compras guardadas con datos ficticios.
