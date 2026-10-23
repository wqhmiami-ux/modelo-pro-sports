# Modelo PRO Sports — punto de continuación

Última actualización: 2026-10-23

## Estado de la rama
- Rama de trabajo: `mejoras-modelo-pro`.
- No publicar a `main` ni cambiar GitHub Pages hasta que se revise la app y el usuario autorice.
- Último cambio de interfaz: rediseño visual oscuro premium, tarjetas, métricas, navegación adaptable a móvil y escritorio.
- Último commit de interfaz: `c6933bd6567bb504c895ff6f1ae19a584227d010`.

## Funciones presentes en la rama de pruebas
- Carga automática de cuotas al abrir.
- Botones de deporte y selector desplegable actualizan las cuotas.
- Actualización periódica cada 15 minutos mientras la pestaña está visible.
- Guarda localmente la última respuesta correcta por deporte.
- Si falla la consulta o vuelve vacía, intenta mostrar caché con aviso de antigüedad; no inventa cuotas.
- Comparación de cuotas y consenso del mercado; el propio informe advierte que consenso no equivale a probabilidad independiente ni a EDGE validado.
- Registro local de pronósticos, cálculo manual, resultados de fútbol y exportación CSV.

## Pendiente antes de llamar a la app “avanzada y lista”
1. Probar la interfaz en navegador y móvil; revisar consola, carga de datos, selector, botones “USAR ESTA CUOTA”, registro e historial.
2. Confirmar el estado real de los endpoints del Worker `/api/odds` y `/api/football` sin mostrar ni modificar secretos.
3. Revisar la respuesta de la API de cuotas: cobertura real de fútbol, NFL, NBA, MLB, NHL y UFC, mercados y casas disponibles.
4. Añadir proveedores de estadísticas/resultados por deporte solo después de confirmar cobertura, límites y credenciales disponibles. No asumir que una API de cuotas incluye lesiones, alineaciones o estadísticas avanzadas.
5. Separar con claridad datos actuales, caché antigua y datos no disponibles; añadir fecha/hora de cada fuente.
6. Implementar modelos específicos por deporte y validar con backtesting real antes de describir cualquier probabilidad como calibrada.
7. Añadir pruebas automáticas y verificar los cambios antes de publicar.
8. Revisar cuotas de Hard Rock Bet únicamente si la fuente las identifica/verifica; no etiquetar otras casas como Hard Rock Bet.

## Límites conocidos
- Ningún proveedor garantiza disponibilidad permanente de datos en vivo. El objetivo es recuperación segura, caché etiquetada y mensajes claros cuando la fuente falla.
- El nivel gratuito de los proveedores suele limitar deportes, mercados o llamadas. Consultar los planes antes de consumir créditos o activar pagos.
- La rama de pruebas no está verificada en navegador y no debe considerarse lista para producción.
