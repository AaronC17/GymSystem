# Auditoría de Kyon+ / GymSystem

Fecha: 8 de octubre de 2026. Alcance: código local descargado de `AaronC17/GymSystem`, rama `main`, base inicial `2810b6d`. No se han desplegado cambios ni modificado registros de producción durante la auditoría.

## Contexto

Kyon+ es un registro personal de entrenamiento, no un sistema completo de administración de gimnasios. Su flujo principal es importar/revisar una rutina PDF, entrenar y registrar cada serie, recuperar sesiones interrumpidas y consultar calendario y progreso.

- Cliente: React 18, TypeScript, Vite, Lucide y PDF.js cargado bajo demanda.
- Servidor: funciones de Vercel con sesiones firmadas en cookies `HttpOnly`.
- Persistencia: MongoDB, colecciones `users` y `userStates`; estado por correo con revisiones e IDs de mutación.
- Acceso: cuentas heredadas y cuentas registradas; prueba de 14 días y activación manual de pago único mediante SINPE. No se cambió el precio ni el modelo de acceso.
- Localhost está configurado para la base real `kyon`. No debe usarse para pruebas destructivas.
- La carpeta fue descargada como ZIP: no contiene `.git`. Para publicar cambios se necesita recuperar el vínculo Git y revisar un diff antes de hacer push.

## Metodología y límites

Tres revisiones delegadas cubren backend/seguridad, sincronización/entrenamientos e interfaz/PDF. Una revisión adicional prioriza oportunidades de producto. La integración y las comprobaciones de dependencias, build, exportación y aislamiento de pruebas se realizan por separado.

Las pruebas automatizadas usan datos sintéticos y mocks. `vitest.config.ts` desactiva la carga de archivos de entorno, vacía `MONGODB_URI` y usa una base/secreto de prueba. La revisión en navegador utiliza un servidor temporal aislado con API en memoria, sin importar el backend real ni abrir una conexión a MongoDB.

Esto no equivale a un pentest, a una certificación de accesibilidad ni a probar todos los modelos de teléfono. El workflow de GitHub está preparado, pero no se ha ejecutado en GitHub.

## Cambios ya comprobados

| Área | Situación inicial | Cambio local |
| --- | --- | --- |
| Dependencias | Una vulnerabilidad alta en `source-map-js`, herramienta de desarrollo | Actualización a `1.2.2`; auditoría de npm sin vulnerabilidades conocidas al comprobarla |
| Compatibilidad | El motor declarado permitía Node 20.0, inferior al mínimo del driver | Mínimo `20.19`; recomendación Node 24 LTS |
| Actualizaciones | Vite `6.4.3`, MongoDB `7.6.0` | Vite `6.4.4`, MongoDB `7.7.0`, sin migraciones de versión mayor |
| Comprobación de tipos | El build no comprobaba `api/` | Configuración separada para backend y pruebas, incluida en `npm run typecheck` |
| Pruebas | No había runner ni script de pruebas | Vitest `4.1.11`, pruebas de regresión aisladas y scripts `test`/`test:watch` |
| Desarrollo | Diferencia entre Vite solo y Vercel con API poco clara | `dev:full`, `.env.example` sin secretos y documentación del uso de `.env` |
| CI | Sin workflow de calidad | Tipos, pruebas, build y auditoría; acciones fijadas por SHA, sin despliegue ni secretos |
| Secretos del cliente | Sin comprobación de salida | El build busca la URI, contraseña de MongoDB y secreto de sesión configurados; falla sin imprimirlos si los encuentra |
| Portabilidad de datos | Sin módulo de descarga | Exportación JSON versionada y CSV por serie; conserva unidades, sesiones incompletas y nombres, y neutraliza fórmulas de hojas de cálculo |
| Validación | Objetos/arrays incompletos podían causar excepciones; fechas imposibles y negativos aceptados | Schema null-safe, fechas reales y números finitos no negativos; no se trunca historial |
| Memoria del entrenamiento | Un pequeño payload podía pedir un array de miles de millones de series | Máximo de 100 series planificadas por ejercicio, sin limitar/truncar las series históricas |
| API de estado | JSON malformado terminaba como error interno | Respuesta 400 antes de acceder a la colección; métodos no soportados devuelven 405 |
| MongoDB | Una promesa de conexión rechazada quedaba cacheada | Liberación de la caché fallida con protección frente a rechazos obsoletos |
| Autenticación heredada | `scryptSync` bloqueaba el event loop | Mismo algoritmo/sales/hashes, ahora con derivación asíncrona; aún falta limitar intentos |
| Sincronización | Las colas y respuestas antiguas podían sobrevivir al cambio de usuario | Épocas de sesión, cancelación y carriles por cuenta; cambios de cookies ordenados; API comprueba el propietario antes de leer/escribir estado |
| Guardado local | Los cambios fallidos no tenían una cola duradera ni recuperación fiable al recargar | Base y pendientes persistidos juntos antes de confirmar; reconciliación reaplica pendientes y reintenta al recuperar conexión/enfocar la app |
| Mensajes de sincronización | Un toast temporal no permitía saber si quedaban cambios sin enviar | Aviso persistente con conteo, explicación y botón Reintentar; no se afirma guardado remoto mientras hay pendientes |
| Borrador | Finalizar podía eliminar el único borrador aunque no se guardara el registro | Conservación del borrador si falla el almacenamiento duradero y cierre solo tras encolar correctamente |
| Respuestas HTTP | El cliente confiaba en casts incluso ante HTML, null o estado inválido | Decodificación explícita de sesión/estado/admin, revisión/propietario y límites de tiempo; fallos conservan la cola |
| PDF | Sin límites suficientes de carga o complejidad; errores podían dejar recursos abiertos | 15 MB, 50 páginas y presupuestos de texto/tablas; limpieza del loading task en éxito y error, sin truncar resultados grandes silenciosamente |
| PDF: formatos | Algunas tablas con encabezados largos/ingleses no se detectaban | Reconocimiento de Repeticiones, Exercise y Sets; series inválidas producen errores claros |
| Accesibilidad | Textos secundarios sin contraste, controles sin nombre/estado, avisos sin región live | Contraste medido corregido, nombre permanente de selector/salida, `aria-pressed`, `aria-current`, alertas y estados anunciables |
| Diálogos modales | Sin gestión consistente de foco/teclas/fondo | Gestor compartido con foco inicial, trampa Tab, Escape selectivo, restauración y fondo inerte para seis flujos |
| Login | Límites de contraseña se aplicaban tarde o solo a cuentas registradas | Límites de email/password antes de buscar cuentas o hacer hash; mantiene topes anteriores de cuentas legacy y registradas |
| Paywall | Propuestas adicionales confundían el flujo de cobro manual | El paywall ofrece WhatsApp; Admin verifica el SINPE y activa; el usuario recarga la app. No incluye exportación, consulta de estado ni activación automática |
| Progreso | Cargas de cero desaparecían, el objetivo asumía cuatro semanas y Inicio ocultaba historial sin rutina | Sets de peso corporal visibles, días reales del mes y dashboard histórico cuando se elimina la rutina |

La exportación es una copia local, no una restauración. Puede contener cambios que aún no se enviaron al servidor. Los archivos incluyen datos personales y deben almacenarse de forma segura.

**Compatibilidad del contrato:** el nuevo cliente requiere `userEmail` en la respuesta de `/api/state` y envía `X-Kyon-User-Email`. El servidor autentica por cookie, no por ese encabezado; el encabezado solo detecta un cambio de cuenta. Los clientes anteriores sin encabezado mantienen el contrato previo. No publicar el nuevo cliente contra un backend anterior: se conservaría la cola, pero la sincronización quedaría bloqueada hasta actualizar ambos.

**Límite de series y estados antiguos:** una rutina planificada anterior con más de 100 series por ejercicio deja de cumplir la validación. No se saneó ningún documento real. El backend permite recuperar ese caso reemplazando/eliminando la rutina, conservando logs, y esa recuperación se probó en memoria; el cliente no ofrece todavía un flujo completo de reparación de estados inválidos. Verificar esos casos y conservar copia antes de desplegar. Las series históricas no se recortan.

## Hallazgos estructurales pendientes

| Prioridad | Hallazgo comprobado en fixtures | Tratamiento propuesto |
| --- | --- | --- |
| Alta: datos | La API deduplica solo los últimos 100 IDs de mutación. Un ID antiguo puede volver a aplicarse; una edición retrasada puede sustituir un entrenamiento más reciente | Versiones por entidad, deduplicación duradera y resolución explícita de conflictos. No declarar que la cola local elimina los conflictos entre dispositivos |
| Alta: acceso | Logout elimina la cookie, pero un token copiado sigue siendo válido hasta expirar | Sesiones revocables persistentes e invalidación al cambiar contraseña. Requiere diseño y despliegue coordinados |
| Alta: disponibilidad | No hay limitador distribuido de intentos de login/registro en el código de aplicación | Rate limiting real en edge o persistencia compartida, con límites por cuenta/origen y protección frente a creación masiva. El hashing asíncrono no sustituye esta medida |
| Media: frontera de confianza | La comprobación de origen admite ausencia de Origin y compara hosts con `x-forwarded-host` | Verificar cómo Vercel sanea el proxy y establecer orígenes/protocolos permitidos antes de endurecer el contrato |
| Media: datos | Documentos de usuario con hashes, sales o fechas malformed pueden hacer fallar login/listado admin | Validar documentos, aislar filas inválidas y añadir observabilidad sin secretos |
| Media: escala | Cada mutación reescribe/devuelve el historial completo y el listado de cuentas no tiene paginación | Separar sesiones por entidad, respuestas incrementales y cursores de administración |
| Media: presupuesto | El límite de series planificadas evita la asignación masiva, pero no es un presupuesto general de arrays/textos/estado | Definir límites de payload y crecimiento por operación sin rechazar o truncar historial válido existente |
| Media: pestañas | Dos pestañas de la misma cuenta pueden sobrescribir su outbox local compartido | Serialización por cuenta mediante Web Locks o almacenamiento transaccional y notificación entre pestañas. El aislamiento de usuarios no resuelve este caso |
| Media: recuperación | Las cachés anteriores no distinguen datos obsoletos de cambios sin enviar | Las copias se respaldan, pero falta una vista para comparar/recuperar y descartar mutaciones rechazadas permanentemente |

Los fixtures no demuestran explotación en producción ni permiten asegurar qué protecciones externas ofrece actualmente el despliegue. No se realizaron ataques, barridos de cuentas ni pruebas de carga contra Vercel o Atlas.

## Interfaz, PDF y métricas: pendientes verificables

- **Interacción completa de modales:** el gestor de foco y la trampa Tab ahora tienen pruebas sintéticas; falta probar manualmente teclado/lectores de pantalla y Safari/iOS real. Una puntuación Lighthouse alta no sustituye esa revisión.
- **Importación parcial de PDF:** el fallback es global; si una sección se reconoce como tabla y otra como texto lineal, la segunda puede omitirse. Hace falta cobertura por sección y advertencias antes de guardar.
- **Bloques repetidos:** el parser deduplica ejercicios por nombre y puede eliminar un segundo bloque intencional. Deben distinguirse filas/bloques en vez de deduplicar únicamente por nombre.
- **Instrucciones de repeticiones:** patrones todavía pueden convertir `12 por pierna`, `30 s` o números de tres dígitos de forma incorrecta. Conservar instrucciones originales y evitar coincidencias parciales antes de ampliar formatos.
- **Cancelación y extracción de PDF:** los presupuestos se comprueban después de que PDF.js extraiga el texto de cada página. Falta timeout/cancelación; los límites no garantizan controlar toda la memoria interna del worker.
- **Responsive:** revisar tablas a 721/961 px, información que se oculta en Mi rutina a 320/390 px y distinción de estados en el calendario. No se probaron dispositivos físicos.
- **Contraste restante:** se corrigieron los selectores medidos, no todos los microtextos de todas las vistas. Revisar especialmente encabezados de tablas.
- **Métricas restantes:** mejor racha limitada a 180 días; distribución con denominador que incluye logs de rutinas anteriores no representadas; el historial de planificación cambia al reemplazar una rutina. La cuenta mensual corregida usa la rutina activa, no versiones históricas de planificación.
- **Temporizador y borrador:** revisar tiempos en segundo plano/Safari y reducir escrituras redundantes; no atribuir a esta ronda una mejora de cronómetro que no se implementó.
- **Conflictos pendientes:** el outbox evita perder cambios al fallar la red, pero no compara ediciones simultáneas entre dispositivos/pestañas ni permite resolver mutaciones rechazadas permanentemente.

Se conservaron la carga lazy de PDF, el worker, `lang="es"`, el zoom y `prefers-reduced-motion` ya existentes. No se cambió el diseño de marca.

## Riesgos operativos que requieren intervención

1. **Credencial de Atlas compartida en el chat.** El usuario decidió conservar la configuración de Atlas; no roté la contraseña ni modifiqué variables de Vercel. La credencial no se incluye en este informe. Permanece el riesgo de que el secreto compartido se considere expuesto.
2. **No probar altas, entrenamientos o borrados con la base de producción.** Los archivos `.env` y `.vercel` permanecen ignorados. `.env.example` es la única excepción prevista.
3. **Verificadores de cuentas heredadas en un repositorio público.** `api/_lib/accounts.ts` contiene hashes y sales, no contraseñas en texto plano. Su publicación permite intentos de adivinación fuera de línea. Migrar/rotar esas credenciales requiere un procedimiento que no bloquee las cuentas actuales; no se retiraron automáticamente.
4. **Mantener separación entre revisión local y despliegue.** Estas mejoras no protegen el sitio remoto hasta que se revisen y se desplieguen expresamente.

## Funciones siguientes, por impacto

Antes de ampliar producto, resolver los pendientes P1 de acceso, conflictos de datos, foco de modales y fidelidad de importación. Las funciones siguientes requieren criterios y pruebas propios; no se implementaron automáticamente en esta ronda.

| Orden | Mejora | Esfuerzo | Criterio de aceptación |
| --- | --- | --- | --- |
| 1 | Restauración controlada de un respaldo JSON | Medio | Vista previa, validación de versión/formato, elección explícita de combinar o reemplazar y copia previa. Nunca reemplazar datos automáticamente |
| 2 | Versiones de rutinas e historial de planificación | Grande | Cambiar una rutina no reinterpreta la planificación histórica; una sesión iniciada conserva su contexto original |
| 3 | Recuperación de contraseña y verificación de correo | Medio/grande | Token de un solo uso con expiración y límites de intentos; mensajes sin revelar si un correo existe; migración segura de cuentas heredadas |
| 4 | Revisión y resolución de conflictos de sincronización | Medio/grande | El aviso persistente y reintento ya existen; falta comparar versiones por dispositivo y revisar/descartar pendientes sin perder series |
| 5 | Descanso opcional integrado | Pequeño/medio | Utilizar `Exercise.rest`, no bloquear el registro y calcular el tiempo correctamente al volver del segundo plano; no depender de avisos móviles |
| 6 | Progresión con identidad fiable de ejercicio | Medio/grande | Evitar unir ejercicios distintos por compartir nombre, conservar unidades y mostrar fecha/contexto de la referencia. No recomendar aumentos automáticos |
| 7 | Importación PDF con indicación de confianza y OCR opcional | Grande | Señalar valores inferidos y días no detectados; revisar antes de guardar; OCR solo con decisión explícita y explicación de privacidad/coste |
| 8 | Gestión de activaciones con historial de acciones | Medio | Mantener SINPE manual; registrar operador/fecha/referencia mínima, evitar duplicados y confirmar la cuenta antes de activar |

Antes de construir nuevas funciones hay que contrastar estas prioridades con el uso real. Las vistas de cargas anteriores, edición, recuperación de entrenamiento y panel de cuentas ya existen: se proponen mejoras, no reconstruirlas como si faltaran.

## Validación final

Comprobado sobre esta ronda integrada:

- `npm test`: **310 pruebas correctas, 17 archivos**. Incluyen schema/API, recuperación MongoDB, derivación criptográfica con fixtures sintéticos, login, aislamiento/colas/cliente HTTP, PDF, exportación, métricas, foco de diálogos y prevención de secretos en el cliente.
- `npm run typecheck`: correcto. También se ejecuta como parte del build.
- `npm run build`: correcto; PDF permanece separado y bajo demanda. El bundle principal integrado es aproximadamente 276 kB (83 kB gzip), frente a 254 kB (77 kB gzip) de la base inicial.
- `npm audit`: **0 vulnerabilidades conocidas** al comprobarla. Esto no elimina riesgos de lógica, autenticación o configuración.
- `npm run check:client-secrets`: correcto con la configuración local; no se imprimieron URI, contraseña ni secreto de sesión.
- Navegador con API sintética: cuenta cargada, cambio guardado localmente durante tres fallos de envío, recuperación tras recarga y confirmación del servidor en memoria sin pendientes. Entrenamiento de peso corporal registrado con dos series; Progreso representa cero, muestra `1 / 5` en octubre y ofrece el exportador.
- Descargas JSON y CSV comprobadas en el navegador: contenido sintético, dos series y unidades conservadas; sin llamadas a una API para exportar.
- Aviso persistente comprobado tras tres fallos: mantiene un cambio pendiente, muestra la explicación y Reintentar envía el cambio al servidor en memoria, conserva el entrenamiento y elimina el aviso al confirmar.
- Borrado de rutina comprobado en QA: cero días activos, un entrenamiento conservado y dashboard histórico visible en Inicio.
- Paywall comprobado con API en memoria: enlace a WhatsApp, explicación de activación manual, sin exportador ni consultas al estado vencido; GET tras vencer responde 402 en el fixture y POST/PATCH mantienen ese bloqueo en pruebas API. Después de cambiar el fixture a acceso activo y recargar, vuelve al dashboard. Sin pagos/datos reales.
- Foco modal comprobado en navegador sintético: primer botón enfocado, Shift+Tab circula al final, Escape cierra el diálogo y restaura el foco al disparador. No se verificó con lector de pantalla/Safari.
- No se cambió Atlas, la contraseña ni variables de producción; todas las pruebas de paywall/modales usaron datos y API en memoria.
- Lighthouse sobre la misma pantalla sintética de finalización: accesibilidad **95 → 100**, buenas prácticas **100**, SEO **100**. Es una medición puntual de ese fixture, no una certificación ni una prueba de teclado completa. No se midió rendimiento de producción.

No se hicieron commits/push, cambios de credenciales ni despliegues. Los riesgos y propuestas anteriores no deben interpretarse como corregidos o implementados.

## Ampliación posterior: Perfil, Amigos y unidades por ejercicio

Esta sección actualiza el alcance de las rondas anteriores: el paywall ahora permite comprobar una activación manual y acceder a Perfil; no aprueba pagos automáticamente.

- **Perfil:** identidad, preferencias kg/lb, compra anticipada, comprobación de acceso y cambio de contraseña validado en servidor. Los overrides autoritativos de `accountCredentials` invalidan tokens anteriores al cambiar contraseña; el logout ordinario todavía no revoca un token copiado. No se modifican pagos ni historial al cambiar contraseña.
- **Amigos:** relaciones MongoDB con aceptación por destinatario, metas privadas/compartidas, publicaciones seleccionadas, felicitaciones idempotentes y ocho insignias calculadas en servidor. Estadísticas privadas por defecto; retirar una amistad elimina su visibilidad en consultas posteriores. Referencias y límites en `docs/SOCIAL.md`.
- **Corrección del flujo de invitación:** búsqueda de una cuenta existente por correo completo, selección explícita en combobox y solicitud únicamente dentro de la app. No hay envío de emails, Resend, SMTP ni variables de proveedor. El correo normalizado es el ID existente. La selección se invalida al editar; se cancelan búsquedas obsoletas. Cuotas persistentes: 30 búsquedas/minuto y 10 invitaciones/día por cuenta.
- **Corrección de unidades:** el selector dentro del entrenamiento corresponde al ejercicio activo. Convierte sus cargas manteniendo reps/completado y sin cambiar otros ejercicios ni la preferencia global. Borradores y registros finalizados conservan unidades mezcladas; nuevas series heredan la unidad de ese ejercicio y sesiones posteriores recuperan su última unidad. No se convierten todos los ejercicios al restaurar un borrador.

Comprobación integrada: **452 pruebas en 24 archivos**, tipos/build correctos y auditoría npm sin vulnerabilidades conocidas. Incluye DOM real para unidades por ejercicio, restauración/guardado mixto, combobox con selección por teclado, cancelación de búsquedas, destinatarios existentes, permisos de aceptación y límites persistentes con Mongo simulado. No se realizaron escrituras en Atlas, envíos de correo ni despliegues. Las cifras de la validación anterior son históricas.

Pendientes sociales: cuentas sin verificación del correo de registro, bloqueo/denuncia, índices/TTL antes de escalar, paginación más allá del límite de 100 relaciones/50 publicaciones y notificaciones push. La búsqueda exacta revela el nombre/correo de la cuenta coincidente por diseño; no expone sus registros. No afirmar que estas pruebas en memoria acreditan entregabilidad, rendimiento o comportamiento concurrente en una instancia real de MongoDB.

### Ronda posterior: presentación móvil y publicaciones detalladas

- Tras la corrección del usuario, el centrado móvil ≤720 px se limita a Amigos: tarjetas, títulos, métricas, etiquetas y acciones, con excepciones para campos editables y descripciones personales largas. Se retiraron los overrides nuevos de Perfil y de estilos globales; el resto de la app vuelve a sus alineaciones previas. Desktop/tablet sin cambios de centrado.
- Descripción opcional de hasta 500 caracteres antes de publicar entrenamientos o insignias, validada en cliente/servidor y renderizada como texto con saltos de línea, sin HTML ejecutable.
- Copia inmutable del entrenamiento seleccionado al compartirlo, tomada en servidor; el feed solo entrega resumen/disponibilidad. La pantalla avisa que esa publicación comparte ejercicios, series, pesos y repeticiones.
- Apertura mediante el mismo `WorkoutHistoryModal` del calendario, con autor/descripción, gestión de foco, Escape y restauración al botón de publicación. Unidades mixtas intactas, sin alterar el historial local.
- Permisos revisados en cada GET al detalle; desconocidos, solicitudes pendientes y antiguos amigos no acceden. Publicaciones eliminadas dejan de estar disponibles. Publicaciones históricas sin copia no se enriquecen automáticamente: se requiere eliminar y compartir de nuevo.

Validación integrada: **483 pruebas correctas en 25 archivos**, tipos/build y comprobación de secretos correctos; npm audit sin vulnerabilidades conocidas. Incluye snapshot/privacidad/idempotencia, descripciones, apertura tras confirmación, cancelación de detalles obsoletos y modal real en happy-dom. Sin escrituras en Atlas ni despliegue.

### Carga bloqueada de Amigos

Ante el reporte de «Actualizando…» persistente, se añadió un límite de 12 segundos en la vista que no depende de que el transporte respete AbortSignal. Al vencer, cancela la solicitud, libera controles y permite reintentar; no adopta respuestas tardías ni confirma mutaciones sin respuesta. Dos regresiones cubren carga y mutación que nunca resuelven. **485 pruebas pasan**. La sesión de navegador disponible para diagnóstico estaba sin autenticar y no capturó solicitudes sociales del usuario: este cambio protege la interfaz, pero no demuestra la causa de la demora en su sesión real.

### Arranque sin esperar autenticación remota

Se eliminó la pantalla «Comprobando tu sesión». En una recarga de la misma pestaña, un hint de presentación en sessionStorage (sin tokens/contraseñas, máximo 12 horas) permite dibujar inmediatamente la copia local por usuario, priorizando el outbox validado y sus pendientes. Sin hint se presenta el acceso, no una página en blanco. La autenticación permanece en servidor: la vista local no inicia sincronización ni permite mutaciones antes de confirmar la sesión; no anticipa el rol Admin. Un rechazo limpia la presentación, no el historial/outbox. Si la cookie pertenece a otra cuenta, se descarta la vista previa antes de adoptar su estado. Logout y cambio de contraseña eliminan el hint. Los datos remotos y el primer arranque en otro dispositivo siguen requiriendo red; no se promete latencia cero de red o descarga del bundle.

Validación actualizada: **492 pruebas en 26 archivos**, incluida presentación anterior a la respuesta remota, permisos sin confirmar, cambios de propietario, almacenamiento bloqueado y recuperación de pendientes sin escrituras desde la vista previa.

### Selector de unidades compacto

KG/LB se presenta en una sola pastilla de aproximadamente 80 × 38 px junto a las series, sin el bloque visible de explicación. Conserva el contexto accesible, el foco de teclado y las unidades independientes por ejercicio; no modifica preferencias generales ni la conversión de cargas. **493 pruebas en 26 archivos** y build/comprobación de secretos correctos. QA sintético de layout a 320, 390, 720 y 1024 px: selector en una línea, sin desbordamiento horizontal. Las comprobaciones se realizaron con datos sintéticos, sin escrituras en Atlas.
