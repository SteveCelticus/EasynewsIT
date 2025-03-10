require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
const fetch = require("node-fetch");
const ptt = require("parse-torrent-title");
const UTILS = require("../utils");
// const cookieParser = require("cookie-parser");


const {
  removeDuplicate,
  containEandS,
  containE_S,
  containsAbsoluteE,
  containsAbsoluteE_,
  getFlagFromName,
  qualities,
  filterBasedOnQuality,
  cleanName,
  getQuality,
} = require("../helper");

let cache = { lastInvalidatedAt: Date.now(), data: {} };
const cacheMaxDuration = 1000 * 60 * 60 * 24 * 1; // 1 giorno

// 🔹 Sostituito: ora il login genera un link con `auth` nel percorso invece che nei parametri di query
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Authentication</title>
    </head>
    <body>
      <h2>Enter Credentials</h2>
      <input type="text" id="user" placeholder="Username">
      <input type="password" id="pass" placeholder="Password">
      <button id="generateManifestButton">Generate Manifest Link</button>
      <p id="manifestLink"></p>
      <p><button id="installStremioButton" style="display:none;">Install in Stremio</button></p>
      <script>
        document.getElementById('generateManifestButton').addEventListener('click', function() {
          var user = document.getElementById('user').value;
          var pass = document.getElementById('pass').value;
          if (!user || !pass) {
              alert('Please enter credentials');
              return;
          }
          var auth = btoa(user + ":" + pass);
          var manifestUrl = window.location.origin + "/auth/" + auth + "/manifest.json";
          document.getElementById('manifestLink').innerHTML = "<a href='" + manifestUrl + "' target='_blank'>" + manifestUrl + "</a>";
          var installUrl = "stremio://" + manifestUrl.replace("https://", "").replace("http://", "");
          var installButton = document.getElementById('installStremioButton');
          installButton.style.display = "block";
          installButton.onclick = function() {
            window.location.href = installUrl;
          };
        });
      </script>
    </body>
    </html>
  `);
});

// 🔹 Sostituito: il manifest ora si trova sotto `/auth/:auth/manifest.json`
app.get("/auth/:auth/manifest.json", function (req, res) {
  const auth = req.params.auth;
  if (!auth || !UTILS.isValidAuth(auth)) {
    return res.status(403).send({ error: "Invalid or missing authentication" });
  }

  const json = {
    id: "stremio.web.stream",
    version: "2.0.0",
    name: "StremioItaliaGroup Easynews v2",
    description: "Search streams from your Easynews",
    logo: "https://i.imgur.com/FFbEwKi.jpeg",
    resources: [
      {
        name: "stream",
        types: ["movie", "series", "anime"],
        idPrefixes: ["tt", "kitsu"],
      },
    ],
    types: ["movie", "series"],
    catalogs: [],
  };

  return res.send(json);
});

app.get("/auth/:auth/stream/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");

// Recupera auth dalla query
const auth = req.query.auth;
if (!auth || !UTILS.isValidAuth(auth)) {
  return res.status(403).send({ error: "Missing or invalid authentication" });
}

const header = UTILS.getAuthorization(auth);
console.log("Header:", header);

  try {
    console.log(`Cache content: ${cache.data ? Object.keys(cache.data).length : 0}`);
  } catch (error) {}

  if (cache.lastInvalidatedAt < Date.now() - cacheMaxDuration) {
    cache.data = {};
    cache.lastInvalidatedAt = Date.now();
  }

  let media = req.params.type;
  let id = req.params.id.replace(".json", "");

  if (id in cache.data) {
    console.log(`Returning ${id} from cache...`);
    return res.send({ streams: [...cache.data[id]] });
  }

  let tmp = id.includes("kitsu") ? await UTILS.getImdbFromKitsu(id) : id.split(":");
  if (!tmp) return res.send({ stream: {} });

  console.log(tmp);
  let [tt, s, e, abs_season, abs_episode, abs, aliasesString] = tmp;
  let aliases = aliasesString ? aliasesString.split("||") : [];
  let meta = await UTILS.getMeta2(tt, media);

  console.log({ meta });

  let promises = media === "movie"
    ? [UTILS.fetchEasynews(`${meta?.name} ${meta.year}`, auth)]
    : [UTILS.fetchEasynews(`${meta.name} S${s.padStart(2, "0")}E${e.padStart(2, "0")}`, auth)];

  let result = (await Promise.all(promises)).flat();
  // console.log("Risultati grezzi:", result);
  result = removeDuplicate(result.filter(el => !!el && !!el["3"] && !el["5"]?.includes("sample")), "4");
  // console.log("🔍 Risultati DOPO removeDuplicate:", JSON.stringify(result, null, 2));
  // console.log({ Results: result.length });

  let streams = result
    .filter(el => {
        // Se non ha runtime, scartalo
        if (!el.runtime || el.runtime < 1200) { // Meno di 10 minuti → scartato
            // console.log(`❌ Scartato per durata insufficiente: ${el.runtime} sec | ${el["10"]}`);
            return false;
        }
 // Controlla se ha audio o sottotitoli italiani
const title = el["10"].toLowerCase();
const italianRegex = /\b(ita|italian|italiano|it)\b/i;

const hasItalianAudio = el.alangs?.some(lang => italianRegex.test(lang));
const hasItalianSubs = el.slangs?.some(lang => italianRegex.test(lang));
const isItalianInTitle = italianRegex.test(title);

if (!hasItalianAudio && !hasItalianSubs && !isItalianInTitle) {
    // console.log(`❌ Scartato per mancanza di italiano: ${el["10"]}`);
    return false;
}
    return true;
})
.map(el => {
 let subs = getFlagFromName(el["10"], el["slangs"] ?? []);
 let audios = getFlagFromName(el["10"], el["alangs"] ?? []);

 const isItalian = el.alangs?.includes("ita") || el.slangs?.includes("ita");


       // Prova a ottenere un URL valido tra primaryURL, fallbackURL o url
      let url = el.primaryURL && el.primaryURL !== "//" ? el.primaryURL :
      el.fallbackURL && el.fallbackURL !== "//" ? el.fallbackURL :
      el.url && el.url.startsWith("http") ? el.url : null;

      if (!url) {
        // console.log("❌ ERRORE: Nessun URL disponibile per lo stream!", el);
        return null;
    }
        // Aggiunge "https:" se manca
    if (url.startsWith("//")) url = "https:" + url;
    
        // Assicura che l'URL sia completo
        const finalUrl = `${url}?auth=${encodeURIComponent(auth)}`;
        
       // console.log("✅ URL dello stream (corretto):", finalUrl);
       // console.log("✅ Passato il filtro:", el["10"], "| URL:", finalUrl);
      
        const duration = el["runtime"] ? `(${Math.floor(el["runtime"] / 60)} min)` : "";
      return {
        // title: `${el["10"]}\n${el["4"]} ${audios ? "🗣️" + audios : ""} ${subs ? " \n 💬: " + subs : ""}`,
        title: `${el["10"]} ${duration}\n${el["4"]} ${audios ? "🗣️" + audios : ""} ${subs ? "\n💬: " + subs : ""}`,
        url: finalUrl,  // Usa l'URL corretto
        name: `Easy 2 ${getQuality(el["10"])} | ${el["5"]}`,
        toTheTop:
        el["alangs"]?.includes("ita") ||
        el["slangs"]?.includes("eng") ||
        `${el["10"]}`.toLowerCase().includes("multi"),
        type: media,
        behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
                request: {
                    Authorization: UTILS.getAuthorization(auth),
                    "User-Agent": "Stremio",
                },
            },
        },
    };
}).filter(Boolean);

streams = filterBasedOnQuality(streams, qualities);
streams.sort((a, b) => {
  const qualityOrder = ["4K", "1080p", "720p", "480p", "SD"];

  const qualityA = getQuality(a.name) || "SD";
  const qualityB = getQuality(b.name) || "4K";

  const hasItalianAudioA = a.alangs?.includes("ita") || a.title.toLowerCase().includes("ita");
  const hasItalianAudioB = b.alangs?.includes("ita") || b.title.toLowerCase().includes("ita");

  // 🔹 Prima i file con audio italiano
  if (hasItalianAudioA && !hasItalianAudioB) return -1;
  if (!hasItalianAudioA && hasItalianAudioB) return 1;

  // 🔹 Se entrambi (o nessuno) hanno audio italiano, ordiniamo per qualità
  return qualityOrder.indexOf(qualityA) - qualityOrder.indexOf(qualityB);
});
  
streams.forEach(stream => { /* Operazioni aggiuntive se necessarie */ });
cache.data[id] = streams;

  // console.log("🚀 Streams inviati a Stremio:", JSON.stringify(streams, null, 2));

  return res.send({ streams });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`working on ${process.env.PORT || 3000}`);
});

module.exports = app;
