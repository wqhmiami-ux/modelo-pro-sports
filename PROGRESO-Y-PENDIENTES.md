# Modelo PRO Sports — estado y continuación

Actualizado: 2026-10-23

## Protección de la versión publicada
- Repo: `wqhmiami-ux/modelo-pro-sports`.
- Rama de pruebas: `mejoras-modelo-pro`.
- GitHub Pages sigue publicando desde `main`. No cambiarlo ni fusionar automáticamente hasta completar la revisión manual en navegador.
- Último cambio de la app en pruebas: `99a1ef89e611e4e777b00b0bb2d08fe048038a84`.
- Validación automatizada de un commit anterior cercano pasó: IDs HTML únicos, destinos de enlaces internos y sintaxis de los 3 bloques JavaScript. La validación del último commit está ejecutándose en GitHub Actions.

## Mejoras en la rama de pruebas
- Se tomó como base el index.html más reciente de `main` para no perder las funciones avanzadas que ya estaban allí (calendario global, filtros de eventos, mejores cuotas, resultados, calculadora, notificaciones e historial).
- Se añadió un pulido visual al tema oscuro premium, navegación adaptable y estados visuales claros para datos antiguos.
- Carga automática al abrir: calendario, cuotas del deporte seleccionado y resultados de fútbol.
- Al cambiar de deporte, la app vuelve a consultar las cuotas.
- Actualización automática de las cuotas del deporte seleccionado cada 30 minutos mientras la página está visible. No se repite el calendario completo para reducir llamadas a la API.
- Caché local por deporte para cuotas; si falla la API, se muestra la última copia con fecha y botones de uso desactivados.
- Caché local del calendario global; si no llegan eventos actuales, se muestra la última copia con aviso y acciones desactivadas.
- Caché local de resultados finalizados de fútbol por competición, equipo y límite; se marca si la respuesta es antigua.
- Seleccionar un partido de fútbol desde el calendario llena automáticamente local/visitante y ejecuta la estimación estadística.
- Normalización de nombres y alias comunes de equipos de fútbol para reducir errores de coincidencia.
- Los botones de cuotas no rellenan la probabilidad como si el consenso de casas fuera una predicción independiente. El usuario debe tener una probabilidad independiente y verificable antes de calcular EDGE.
- Se añadió workflow de GitHub Actions `.github/workflows/validate.yml` para comprobar IDs HTML, enlaces internos y sintaxis JavaScript.

## Limitaciones reales
- No es posible garantizar datos en vivo 100% del tiempo. Cuando una fuente falla, la app debe indicar el fallo y diferenciar caché antigua de datos actuales.
- La cobertura del calendario de fútbol que admite el servidor de cuotas está limitada a Premier League hasta que el backend habilite otras competiciones.
- La cobertura de NFL, NBA, MLB, NHL y UFC depende de lo que devuelva el proveedor en ese momento. El catálogo de mercados no garantiza que todos existan en la API.
- No se debe afirmar que las cuotas son de Hard Rock Bet salvo que la respuesta identifique esa casa.
- La predicción Poisson es preliminar y no validada. No llamarla calibrada ni usarla como recomendación profesional sin backtesting.
- El navegador de herramientas no permitió verificar directamente los endpoints de Cloudflare; por eso no afirmar que todas las APIs estén comprobadas desde esta sesión.

## Próximos pasos obligatorios antes de publicar
1. Confirmar que el último workflow de GitHub Actions termina en éxito.
2. Abrir la página de la rama en un entorno de prueba sin cambiar GitHub Pages, probar los 6 deportes, calendario, filtros, cuotas, botón “USAR ESTA CUOTA”, predicción, registro, cierre de resultado, exportación CSV y caché sin conexión.
3. Probar manualmente el Worker `/api/odds` para cada deporte y `/api/football?competition=PL`; confirmar los nombres de equipo, mercados, casas y cuotas devueltos.
4. Verificar que el proveedor no agote la cuota/plan por las llamadas automáticas. La actualización periódica se limita a un deporte seleccionado; el calendario consulta las fuentes al abrir o al pulsar cargar.
5. Añadir estadísticas específicas y modelos por deporte solo con fuentes verificadas. Confirmar lesiones, alineaciones, clima, cuotas de apertura/cierre únicamente si la fuente lo ofrece.
6. Hacer backtesting reproducible y registrar calibración, Brier/log loss y ROI antes de afirmar precisión.
7. Publicar en `main` solo después de revisar en navegador y obtener aprobación explícita del usuario.

## Seguridad
- Mantener las claves API solo en Cloudflare Secrets. Nunca ponerlas en `index.html`, GitHub Pages, commits o logs.
