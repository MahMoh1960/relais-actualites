// Worker Cloudflare : relais de flux RSS + résumés IA pour l'application « Actualités du jour ».
//  - GET /?url=ADRESSE_DU_FLUX            -> relaie un flux RSS (sites de la liste uniquement)
//  - GET /resume?t=TITRE&e=EXTRAIT&l=LANG&s=SOURCE -> résumé IA (Workers AI, sans clé API)
const AUTORISES = new Set(["2m.ma","arabic.euronews.com","arabic.rt.com","english.alarabiya.net","feeds.bbci.co.uk","feeds.bloomberg.com","feeds.nbcnews.com","feeds.skynews.com","foreignpolicy.com","fr.euronews.com","fr.hespress.com","fr.le360.ma","information.tv5monde.com","medias24.com","moxie.foxnews.com","news.un.org","rss.cnn.com","rss.dw.com","rss.nytimes.com","telquel.ma","www.aa.com.tr","www.abc.net.au","www.alarabiya.net","www.aljazeera.com","www.aljazeera.net","www.bfmtv.com","www.cbc.ca","www.cbsnews.com","www.cgtn.com","www.cnbc.com","www.courrierinternational.com","www.economist.com","www.euronews.com","www.france24.com","www.francetvinfo.fr","www.ft.com","www.hespress.com","www.jeuneafrique.com","www.lemonde.fr","www.mapexpress.ma","www.medi1tv.com","www.mediapart.fr","www.monde-diplomatique.fr","www.nature.com","www.newscientist.com","www.pbs.org","www.rfi.fr","www.rt.com","www.sciencedaily.com","www.scientificamerican.com","www.skynewsarabia.com","www.theafricareport.com","www.trtworld.com"]);

const MODELE = '@cf/google/gemma-3-12b-it';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const ORIGINES_OK = ['https://mahmoh1960.github.io', 'https://localhost', 'http://localhost', 'capacitor://localhost'];

// Plusieurs « profils » d'en-têtes : si un site refuse le premier (403 ou 406), on essaie le suivant.
const PROFILS = [
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'fr,en;q=0.8,ar;q=0.6'
  },
  {
    'User-Agent': 'Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)',
    'Accept': '*/*'
  },
  {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9'
  }
];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });

async function resume(request, env, ctx) {
  const origine = request.headers.get('Origin');
  if (origine && !ORIGINES_OK.includes(origine)) return json({ erreur: 'Origine non autorisée' }, 403);
  if (!env.AI) return json({ erreur: 'IA non configurée sur le relais' }, 503);

  const u = new URL(request.url);
  const titre = (u.searchParams.get('t') || '').trim().slice(0, 300);
  const extrait = (u.searchParams.get('e') || '').trim().slice(0, 600);
  const lang = u.searchParams.get('l') || 'fr';
  const source = (u.searchParams.get('s') || '').trim().slice(0, 80);
  if (!titre) return json({ erreur: 'Titre manquant' }, 400);

  const cache = caches.default;
  const deja = await cache.match(request);
  if (deja) return deja;

  const langue = { fr: 'français', en: 'anglais', ar: 'arabe' }[lang] || 'français';
  const consigne =
    "Résume l'information d'actualité ci-dessous en 2 ou 3 phrases courtes, claires et factuelles. " +
    'Écris le résumé en ' + langue + ', la langue du texte. ' +
    "N'ajoute aucun fait absent du texte ; si le texte est trop bref, reformule-le simplement sans rien inventer. " +
    'Réponds uniquement par le résumé.\n\n' +
    'Source : ' + source + '\nTitre : ' + titre + '\nExtrait : ' + (extrait || '(aucun extrait fourni)');

  let sortie;
  try {
    sortie = await env.AI.run(MODELE, {
      messages: [{ role: 'user', content: consigne }],
      max_tokens: 220,
      temperature: 0.2
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/limit|neuron|quota|capacity|4006/i.test(msg)) {
      return json({ erreur: 'Limite quotidienne atteinte, réessayez demain' }, 429);
    }
    return json({ erreur: 'Service IA indisponible' }, 502);
  }

  let texte = sortie && (sortie.response ?? (sortie.choices && sortie.choices[0] && sortie.choices[0].message && sortie.choices[0].message.content) ?? (sortie.result && sortie.result.response));
  texte = (texte || '').toString().replace(/^\s*(résumé|summary|الملخص)\s*[:：]\s*/i, '').trim();
  if (!texte) return json({ erreur: 'Réponse vide du modèle' }, 502);

  const rep = json({ resume: texte }, 200, { 'Cache-Control': 'public, max-age=604800' });
  ctx.waitUntil(cache.put(request, rep.clone()));
  return rep;
}

async function relais(request, ctx) {
  const u = new URL(request.url);
  const cible = u.searchParams.get('url');
  if (!cible) return new Response('Paramètre url manquant', { status: 400, headers: CORS });
  let t;
  try { t = new URL(cible); } catch { return new Response('Adresse invalide', { status: 400, headers: CORS }); }
  if (!AUTORISES.has(t.hostname)) return new Response('Site non autorisé : ' + t.hostname, { status: 403, headers: CORS });

  const cache = caches.default;
  let rep = await cache.match(request);
  if (rep) return rep;

  let r = null;
  for (const profil of PROFILS) {
    try {
      r = await fetch(t.toString(), { headers: profil, redirect: 'follow' });
    } catch (e) {
      r = null;
      continue;
    }
    if (r.ok || (r.status !== 403 && r.status !== 406)) break;
  }
  if (!r) return new Response('Flux injoignable', { status: 502, headers: CORS });

  const corps = await r.text();
  rep = new Response(corps, {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }
  });
  if (r.ok) ctx.waitUntil(cache.put(request, rep.clone()));
  return rep;
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === '/resume') return resume(request, env, ctx);
    return relais(request, ctx);
  }
};
