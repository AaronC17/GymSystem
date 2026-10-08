# Amigos: diseño y referencias

## Referencias consultadas

- [Strava: comunidad, retos y kudos](https://support.strava.com/en-us/collections/19657598-clubs-challenges-and-community): celebrar el esfuerzo mediante resultados elegidos y felicitaciones.
- [Strava: rachas semanales](https://support.strava.com/en-us/articles/15401580-streaks-on-strava): constancia por semana, en vez de exigir entrenamiento diario.
- [Strava: retos e insignias](https://support.strava.com/en-us/articles/15401916-strava-challenges): metas medibles, barras de progreso y vitrina de logros.
- [Duolingo: Friend Streak](https://blog.duolingo.com/friend-streak/): aceptación explícita y responsabilidad compartida. Su dato de retención es propio de Duolingo; no predice resultados de Kyon.

## Adaptación a Kyon

Amigos reúne comunidad privada, solicitudes dirigidas por correo, metas e insignias. No hay clasificación pública por peso, presión para entrenar todos los días, compra de insignias ni publicación automática del historial. El descanso forma parte de la constancia.

- **Buscar → seleccionar → invitar → aceptar → compartir → celebrar:** se escribe el correo completo de una cuenta existente, se selecciona en un combobox y la persona recibe/acepta dentro de la app. No se envían emails. El identificador sigue siendo el correo normalizado usado por `users._id` y las sesiones.
- **Metas:** número de entrenamientos en un intervalo; privadas o compartidas con amigos. El progreso proviene de sesiones sincronizadas, no de un contador editable.
- **Insignias:** colección Kyo de seis hitos: primer entrenamiento, 10 y 25 entrenamientos, mejor racha de 2 y 4 semanas y mejora personal. Se conserva el reconocimiento de la mejor racha al descansar; editar/eliminar los registros que lo justifican recalcula los logros. Identificadores estables y catálogo compartido en `src/badgeCatalog.ts`.
- **Resultados:** cada publicación es explícita y puede incluir una descripción de hasta 500 caracteres. Publicar un entrenamiento autoriza compartir la copia de esa sesión, con ejercicios, series y cargas, mediante el modal de calendario; nunca el historial entero. La pantalla explica esto antes de publicar. Se puede eliminar.
- **Privacidad:** estadísticas privadas por defecto; amistades aceptadas, no seguidores públicos. Eliminar una amistad retira el acceso social a esa persona en consultas posteriores.
- **Errores honestos:** las acciones esperan confirmación del servidor. No se puede enviar sin seleccionar una cuenta encontrada; editar el correo invalida la selección y cancela búsquedas anteriores.

## Alcance y pendientes

La capa social utiliza MongoDB y requiere conexión para leer/escribir; no tiene outbox offline propio. Las métricas usan calendario UTC sobre las fechas guardadas. La estimación de mejora no sustituye una identidad estable de ejercicio ni asesoramiento deportivo.

### Detalle de publicaciones

`GET /api/social?postId=...` requiere sesión, owner header y autoría o amistad aceptada vigente. La copia se obtiene del estado del autor en servidor al publicar, conserva unidades y no se sobrescribe al repetir la solicitud. El feed no devuelve la copia completa. Retirar amistad o borrar publicación bloquea consultas posteriores. Copias superiores a 500 KB se rechazan sin truncar.

Las publicaciones antiguas carecen de copia; no se recuperan datos del historial sin nuevo consentimiento. El detalle responde 410 en ese caso, y la UI explica que el autor puede eliminar y volver a compartir. Insignias no abren un registro de entrenamiento. Descripciones se renderizan como texto, sin HTML ejecutable, y se conservan saltos de línea.

No hay proveedor de email ni configuración SMTP. Las búsquedas exactas tienen una cuota MongoDB de 30/minuto por cuenta; invitaciones, 10/día y cooldown de 24 horas al reinvitar después de rechazar/cancelar. La búsqueda revela nombre/correo de la cuenta coincidente por diseño, nunca historial. La verificación de correo de registro, bloqueo/denuncia de abuso, moderación, paginación a gran escala, retos cooperativos y notificaciones push son mejoras posteriores, no funcionalidades simuladas. El dashboard procesa hasta 100 relaciones y 50 publicaciones recientes.

Antes de escalar, revisar índices de `socialRelationships` (members/state/updatedAt), `socialPosts` (ownerEmail/createdAt) y un índice TTL para `socialInviteQuotas.expiresAt`. No se crearon índices ni modificaron colecciones de producción durante esta revisión.

### Identidad y movimiento de Kyo

Kyo es un lince carbón con mechones lima, ojos expresivos y un pañuelo deportivo. La colección usa seis poses originales en SVG, con bordes de esmalte y acentos lima/menta/melocotón/lavanda. La interfaz sirve los SVG; los PNG transparentes de 1024 px se conservan en `docs/design/kyo` como entregables de diseño, fuera del bundle público.

Amigos incorpora hero ilustrado, avatares con iniciales reales, feed con arte de insignias, detalle ampliado con Escape/foco restaurado y entradas/transiciones finitas. No utiliza fotos ajenas ni actividad simulada. Los efectos respetan `prefers-reduced-motion`. El centrado móvil continúa limitado a Amigos, con campos editables y descripciones personales alineados a la izquierda.

El campo opcional `SocialPost.badgeId` se deriva del hash determinista de autor/tipo/ID de insignia que ya identifica las publicaciones; no se infiere del título ni se consulta historial privado adicional. Las publicaciones de 50 entrenamientos y 8 semanas siguen siendo legibles, pero esas insignias no forman parte de la nueva colección. No se migran ni reescriben publicaciones históricas. Clientes anteriores aceptan las seis métricas; clientes nuevos toleran publicaciones sin badgeId.

El rediseño de Kyo se valida con datos sintéticos; no se envían invitaciones a personas reales ni se modifican registros de Atlas durante las pruebas.
