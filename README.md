# Kyon+ Training Journal

Aplicación web para convertir rutinas de gimnasio en PDF en un registro de entrenamiento medible durante todo el año.

## Funciones

- Importación local de PDF con detección de días, ejercicios, series y repeticiones.
- Pantalla de acceso con sesión recordada y cierre de sesión.
- Editor para revisar o crear una rutina manualmente.
- Registro por serie de peso, repeticiones y unidad en kg o lb.
- Unidad kg/lb independiente por ejercicio durante el entrenamiento; se conserva al recuperar un borrador y no modifica la preferencia general.
- Inicio, pausa, recuperación y finalización controlada del entrenamiento.
- Recuperación automática de una sesión activa tras recargar la página.
- Calendario mensual y anual con historial de entrenamientos.
- Métricas de sesiones, consistencia, rachas y progresión basada en registros reales.
- Estado inicial vacío: no se generan rutinas ni estadísticas de demostración.
- Persistencia por usuario en MongoDB Atlas, sincronizada entre navegadores.
- Recarga sin pantalla de comprobación: vista local inmediata en la misma pestaña y validación de sesión en segundo plano. Sin copia previa, se muestra el acceso; la copia no autoriza operaciones de servidor.
- Migración protegida de los datos locales existentes antes de activar la sincronización.
- Cola persistente por usuario para conservar y reintentar cambios pendientes, con comprobación del propietario en la API.
- Exportación local desde Progreso: respaldo JSON de rutina e historial y CSV por serie.
- Perfil: preferencias kg/lb, compra anticipada durante la prueba, comprobación de activación y cambio de contraseña con invalidación de sesiones anteriores.
- Amigos: solicitudes dirigidas por correo, aceptación explícita, metas, resultados compartidos e insignias por constancia y mejoras.

## Acceso

El inicio de sesión se valida en el servidor. Las contraseñas no se incluyen en el cliente ni en esta documentación.

## Variables de entorno

- `MONGODB_URI`: conexión privada a MongoDB Atlas.
- `SESSION_SECRET`: secreto aleatorio para firmar las sesiones.
- `MONGODB_DB`: nombre opcional de la base de datos; por defecto se usa `kyon`.

Para ejecutar las funciones de servidor localmente, si aún no existe `.env`, copia `.env.example` a `.env` y completa las variables (sin subir credenciales a Git). No sobrescribas una configuración existente. Vercel CLI carga `.env` para estas funciones. Si la conexión apunta a producción, los cambios hechos desde localhost afectarán los datos reales.

## Desarrollo

Requiere Node.js 20.19 o posterior; se recomienda Node.js 24 LTS, también usado en Vercel.

```bash
npm ci
npm run dev:full
```

`dev:full` usa Vercel CLI 63.1.0 y sirve la interfaz y la API en `http://localhost:3000`. La primera vez requiere autorizar la cuenta y vincular el proyecto de Vercel. Las variables sensibles de producción no se pueden descargar; configura la conexión de Atlas directamente en `.env`.

Para trabajar solo en la interfaz sin las funciones de servidor se puede usar `npm run dev`; no permite iniciar sesión ni sincronizar datos sin una API.

## Comprobaciones

```bash
npm run typecheck
npm test
npm audit
```

La comprobación de TypeScript incluye la interfaz, las funciones de `api/` y las pruebas. Las pruebas no cargan `.env`, usan datos sintéticos y no necesitan MongoDB ni credenciales de Vercel. `npm run test:watch` ejecuta las pruebas en modo continuo.

El workflow `.github/workflows/ci.yml` ejecuta instalación, comprobación de tipos, pruebas, build y auditoría de dependencias al subir cambios o abrir un pull request. No despliega ni requiere secretos.

El build también comprueba que los archivos del cliente no incluyan las credenciales de MongoDB ni el secreto de sesión configurados. Este control no sustituye una revisión general de secretos.

## Límites y copias de datos

El importador acepta PDF de texto seleccionable de hasta 15 MB y 50 páginas, con límites de texto y complejidad de tablas. No realiza OCR y requiere revisar el resultado antes de guardar. Las series importadas deben ser de 1 a 10; una rutina manual admite hasta 100 series planificadas por ejercicio.

Los respaldos JSON y CSV contienen datos personales y el estado local de este dispositivo, incluidos cambios aún pendientes de sincronizar. La exportación no cambia la cuenta ni restaura datos automáticamente. La cola persistente no resuelve conflictos entre dos dispositivos o pestañas que editan el mismo entrenamiento.

Al vencer la prueba, el paywall ofrece WhatsApp y un botón de comprobación. La persona administradora verifica el SINPE y activa manualmente la cuenta desde el panel; el usuario puede comprobar el acceso o recargar. Perfil permite comprar antes de que termine la prueba. Ningún botón aprueba pagos automáticamente.

## Amigos y motivación

Escribe el correo completo de una cuenta existente, selecciónala en el combobox y pulsa Enviar solicitud. El correo normalizado es el identificador de cuenta que ya usa la aplicación. La solicitud aparece en Amigos de la persona destinataria, quien debe aceptarla dentro de la app. **No se envían emails ni se necesita un proveedor de correo.** Se pueden rechazar/cancelar solicitudes y eliminar amistades. La búsqueda es exacta, requiere sesión y tiene un límite persistente de 30 consultas por minuto; las invitaciones tienen un límite de 10 al día. El enlace directo `?view=amigos` sigue disponible.

Los resúmenes personales son privados por defecto. Cada entrenamiento, insignia o meta se comparte voluntariamente con amistades aceptadas. **Al compartir un entrenamiento, sus amigos pueden abrir el mismo modal de registro del calendario y ver los ejercicios, series, pesos, unidades y repeticiones de esa sesión**, no del resto del historial. Se puede añadir una descripción opcional de hasta 500 caracteres antes de publicar un entrenamiento o una insignia. Las metas cuentan entrenamientos completados y sincronizados dentro de sus fechas. Los reconocimientos «Ánimo» no son rankings de fuerza.

El entrenamiento publicado es una copia del registro sincronizado en ese momento; editar el original no cambia silenciosamente lo publicado. El servidor comprueba la amistad vigente en cada consulta al detalle. Las publicaciones antiguas que solo contenían un resumen no se enriquecen automáticamente: el autor puede eliminarlas y volver a publicar para compartir el detalle. Volver a enviar una publicación existente no sustituye su descripción/copia anterior; para reemplazarla se elimina primero.

En Amigos, las pantallas móviles de hasta 720 px centran títulos, textos de tarjetas, métricas y acciones. Campos editables y descripciones personales largas conservan alineación izquierda. El resto de la app mantiene su presentación anterior.

La colección **Kyo** reúne seis insignias ilustradas: Despertar (primer entrenamiento), En la zona (10 sesiones), Garra firme (25 sesiones), Ritmo felino (2 semanas), Instinto constante (4 semanas) y Nueva forma (una mejora personal). Las rachas son **semanales**, de lunes a domingo UTC, para permitir descanso. Se calculan en el servidor desde entrenamientos válidos ya sincronizados: no certifican actividad física. El progreso de fuerza compara ejercicios por nombre normalizado y estimación Epley, convirtiendo lb/kg; no es una recomendación de carga ni une identidades de ejercicio inequívocas. Las publicaciones antiguas conservan sus datos, incluso las de las insignias retiradas de 50 sesiones y 8 semanas.

Amigos incluye una vitrina con detalle ampliado, progreso real y animaciones de entrada, brillo al interactuar y reconocimiento de Ánimo solo después de confirmarlo. Respeta `prefers-reduced-motion` y ofrece navegación por teclado y restauración de foco. Los seis SVG originales están en `public/badges/`; sus PNG transparentes de 1024 px y la guía visual están en [`docs/design/kyo/`](docs/design/kyo/README.md). La [lámina de colección](docs/kyo-collection.html) se puede abrir localmente.

Las cuentas actuales todavía no verifican la propiedad del correo al registrarse; la búsqueda solo identifica una cuenta, no acredita la identidad de una persona. Amigos requiere conexión y confirma sus operaciones en el servidor. Revisa solicitudes entrando en Amigos o con Actualizar. Cliente y API deben desplegarse juntos; las comprobaciones locales usaron únicamente datos sintéticos, sin modificar la base real.

El contexto, los cambios y las propuestas priorizadas de esta revisión están en [`docs/AUDIT.md`](docs/AUDIT.md).

Para generar la versión de producción:

```bash
npm run build
```
