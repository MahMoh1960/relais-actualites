// Worker Cloudflare : relais de flux RSS pour l'application « Actualités du jour ».
// Utilisation : https://VOTRE-WORKER.workers.dev/?url=ADRESSE_DU_FLUX (adresse encodée)
// Seuls les sites de la liste ci-dessous sont autorisés (le relais n'est pas ouvert à tous).
const AUTORISES = new Set([
  "2m.ma",
  "arabic.euronews.com",
  "arabic.rt.com",
  "english.alarabiya.net",
  "feeds.bbci.co.uk",
  "feeds.bloomberg.com",
  "feeds.nbcnews.com",
  "feeds.skynews.com",
  "foreignpolicy.com",
  "fr.euronews.com",
  "fr.hespress.com",
  "fr.le360.ma",
  "information.tv5monde.com",
  "medias24.com",
  "moxie.foxnews.com",
  "news.un.org",
  "rss.cnn.com",
  "rss.dw.com",
  "rss.nytimes.com",
  "telquel.ma",
  "www.aa.com.tr",
  "www.abc.net.au",
  "www.alarabiya.net",
  "www.aljazeera.com",
  "www.aljazeera.net",
  "www.bfmtv.com",
  "www.cbc.ca",
  "www.cbsnews.com",
  "www.cgtn.com",
  "www.cnbc.com",
  "www.courrierinternational.com",
  "www.economist.com",
  "www.euronews.com",
  "www.france24.com",
  "www.francetvinfo.fr",
  "www.ft.com",
  "www.hespress.com",
  "www.jeuneafrique.com",
  "www.lemonde.fr",
  "www.mapexpress.ma",
  "www.medi1tv.com",
  "www.mediapart.fr",
  "www.monde-diplomatique.fr",
  "www.nature.com",
  "www.newscientist.com",
  "www.pbs.org",
  "www.rfi.fr",
  "www.rt.com",
  "www.sciencedaily.com",
  "www.scientificamerican.com",
  "www.skynewsarabia.com",
  "www.theafricareport.com",
  "www.trtworld.com"
]);

const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const cible = u.searchParams.get('url');
    if (!cible) return new Response('Paramètre url manquant', { status: 400, headers: CORS });
    let t;
    try { t = new URL(cible); } catch { return new Response('Adresse invalide', { status: 400, headers: CORS }); }
    if (!AUTORISES.has(t.hostname)) return new Response('Site non autorisé : ' + t.hostname, { status: 403, headers: CORS });

    const cache = caches.default;
    let rep = await cache.match(request);
    if (rep) return rep;

    let r;
    try {
      r = await fetch(t.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language': 'fr,en;q=0.8,ar;q=0.6'
        },
        redirect: 'follow'
      });
    } catch (e) {
      return new Response('Flux injoignable', { status: 502, headers: CORS });
    }
    const corps = await r.text();
    rep = new Response(corps, {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }
    });
    if (r.ok) ctx.waitUntil(cache.put(request, rep.clone()));
    return rep;
  }
};
