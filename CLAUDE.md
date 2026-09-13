# Guía de trabajo para Claude (FRWEB)

## Autonomía — no pedir permiso de más

Este repo es del dueño, sin otros colaboradores tocando el código. No hace
falta preguntar antes de:

- Editar, crear o borrar archivos del proyecto (reversible con git).
- `git commit` y `git push` a `master` — Netlify publica solo con cada push,
  no hace falta pedir permiso cada vez.
- Crear ramas, abrir y mergear PRs propias del trabajo pedido.
- Correr el servidor local de preview, leer/navegar el código, probar la
  app en el navegador.

Sí seguir confirmando antes de (esto no cambia):

- Cualquier escritura o borrado contra el **Firestore de producción real**
  (crear/editar/borrar gastos, cierres, ideas, votos, etc. de datos reales
  del negocio) — solo lectura para verificar, salvo que el dueño pida
  explícitamente cargar/borrar algo puntual.
- `force-push`, borrar ramas, o cualquier operación destructiva/irreversible
  en git.
- Decisiones de alcance grande con más de una opción razonable (ej.: por
  dónde arrancar un refactor de varias horas, o qué arquitectura usar en
  otro proyecto) — ahí sí preguntar, pero una sola vez y de forma concisa,
  no repetir la misma pregunta.

## Por qué existe esta nota

El dueño marcó que pedirle autorización para cada paso durante una sesión
larga de trabajo fue molesto (2026-09-12). Esta nota evita repetir esa
fricción en sesiones futuras: el trabajo de rutina sobre este repo fluye
sin cortes: las preguntas quedan para lo que de verdad es decisión suya o
toca datos reales de producción.
