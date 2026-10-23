# Publicación de Modelo PRO Sports API en Cloudflare

Este repositorio contiene el frontend de GitHub Pages y el código fuente del Worker en `cloudflare-worker-oddslink.js`.

## Importante

Guardar cambios en GitHub **no publica automáticamente** el Worker de Cloudflare. GitHub Pages publica la interfaz; el Worker se despliega por separado desde Cloudflare.

## Antes de publicar

1. Abre Cloudflare Dashboard y entra en **Workers & Pages → modelo-pro-api**.
2. Abre el editor del Worker y conserva el nombre y la URL de producción actuales.
3. Sustituye el código del Worker por el contenido completo de `cloudflare-worker-oddslink.js` de este repositorio.
4. En **Settings → Variables and Secrets**, confirma que existe el secreto `ODDSLINK_API_KEY` y que pertenece al proveedor **OddsLink**. No pegues la clave en GitHub ni en el chat. El secreto `ODDS_API_KEY` de otro proveedor no debe darse por válido automáticamente para OddsLink.
5. Para los resultados históricos de fútbol, configura también `FOOTBALL_DATA_TOKEN` solo si dispones de una clave válida de football-data.org. Este token es independiente de `ODDSLINK_API_KEY`.
6. Guarda y despliega el Worker desde Cloudflare.

## Comprobación posterior al despliegue

- Abre `https://modelo-pro-api.wqhmiami.workers.dev/`. Debe responder JSON con `"ok": true` y enumerar las rutas disponibles.
- Abre `https://modelo-pro-api.wqhmiami.workers.dev/api/odds?sport=basketball_nba&markets=h2h`. Debe devolver una lista JSON de eventos o un error explícito del proveedor; no consideres la API operativa si devuelve un error de configuración o autenticación.
- Abre `https://modelo-pro-api.wqhmiami.workers.dev/api/football?competition=PL&status=FINISHED`. Debe devolver resultados o un error explícito. Si indica que falta `FOOTBALL_DATA_TOKEN`, esa función no está configurada.
- Abre `https://wqhmiami-ux.github.io/modelo-pro-sports/`, entra en **Estado de datos** y pulsa **COMPROBAR CONEXIÓN Y LOS 6 DEPORTES**. Luego pulsa **CARGAR CUOTAS** y confirma que se muestran eventos y cuotas recibidos de la API. Un deporte puede responder correctamente con cero eventos.

## Cobertura real

El Worker solo solicita los deportes y mercados codificados en `cloudflare-worker-oddslink.js`. Que la interfaz muestre un deporte o mercado no significa que el proveedor tenga cuotas disponibles para él. No se deben inventar partidos, precios, probabilidades estimadas ni EDGE. La probabilidad implícita de una cuota no es una predicción independiente.

## Publicación de la interfaz

GitHub Pages debe seguir publicando desde la rama `main`. No cambies Pages a una rama de pruebas para desplegar el Worker.
