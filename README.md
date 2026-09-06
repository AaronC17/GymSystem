# Kyon+ Training Journal

Aplicación web para convertir rutinas de gimnasio en PDF en un registro de entrenamiento medible durante todo el año.

## Funciones

- Importación local de PDF con detección de días, ejercicios, series y repeticiones.
- Pantalla de acceso con sesión recordada y cierre de sesión.
- Editor para revisar o crear una rutina manualmente.
- Registro por serie de peso, repeticiones y unidad en kg o lb.
- Inicio, pausa, recuperación y finalización controlada del entrenamiento.
- Recuperación automática de una sesión activa tras recargar la página.
- Calendario mensual y anual con historial de entrenamientos.
- Métricas de sesiones, consistencia, rachas y progresión basada en registros reales.
- Estado inicial vacío: no se generan rutinas ni estadísticas de demostración.
- Persistencia por usuario en MongoDB Atlas, sincronizada entre navegadores.
- Migración protegida de los datos locales existentes antes de activar la sincronización.

## Acceso

El inicio de sesión se valida en el servidor. Las contraseñas no se incluyen en el cliente ni en esta documentación.

## Variables de entorno

- `MONGODB_URI`: conexión privada a MongoDB Atlas.
- `SESSION_SECRET`: secreto aleatorio para firmar las sesiones.
- `MONGODB_DB`: nombre opcional de la base de datos; por defecto se usa `kyon`.

## Desarrollo

Requiere Node.js 20 o posterior.

```bash
npm install
vercel dev
```

Para trabajar solo en la interfaz sin las funciones de servidor se puede usar `npm run dev`.

Para generar la versión de producción:

```bash
npm run build
```
