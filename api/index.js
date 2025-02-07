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

app.get("/", (req, res) => {
  if (req.query.auth && req.query.auth.endsWith("/manifest.json")) {
    // Estrae le credenziali rimuovendo la parte "/manifest.json"
    const authWithSuffix = req.query.auth;
    const auth = authWithSuffix.replace("/manifest.json", "");
    if (!UTILS.isValidAuth(auth)) {
      return res.status(403).send({ error: "Invalid or missing authentication" });
    }
  
  return res.redirect("/manifest.json?auth=" + auth);
}

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
          var manifestUrl = window.location.origin + "/manifest.json?auth=" + encodeURIComponent(auth);
          console.log("Manifest URL:", manifestUrl);
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

app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  const auth = req.query.auth;
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

app.get("/stream/:type/:id", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");


const auth = req.query.auth;
if (!auth || !UTILS.isValidAuth(auth)) {
  return res.status(403).send({ error: "Missing or invalid authentication" });
}

const header = UTILS.getAuthorization(auth);

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
  let promises = media === "movie"
    ? [UTILS.fetchEasynews(`${meta?.name} ${meta.year}`, auth)]
    : [UTILS.fetchEasynews(`${meta.name} S${s.padStart(2, "0")}E${e.padStart(2, "0")}`, auth)];

  let result = (await Promise.all(promises)).flat();
   result = removeDuplicate(result.filter(el => !!el && !!el["3"] && !el["5"]?.includes("sample")), "4");
   let streams = result
    .filter(el => {
        
        if (!el.runtime || el.runtime < 1200) { // Meno di 10 minuti → scartato
            
            return false;
        }
 
const title = el["10"].toLowerCase();
const italianRegex = /\b(ita|italian|italiano|it)\b/i;

const hasItalianAudio = el.alangs?.some(lang => italianRegex.test(lang));
const hasItalianSubs = el.slangs?.some(lang => italianRegex.test(lang));
const isItalianInTitle = italianRegex.test(title);

if (!hasItalianAudio && !hasItalianSubs && !isItalianInTitle) {
    
    return false;
}
    return true;
})
.map(el => {
 let subs = getFlagFromName(el["10"], el["slangs"] ?? []);
 let audios = getFlagFromName(el["10"], el["alangs"] ?? []);

 const isItalian = el.alangs?.includes("ita") || el.slangs?.includes("ita");


       
      let url = el.primaryURL && el.primaryURL !== "//" ? el.primaryURL :
      el.fallbackURL && el.fallbackURL !== "//" ? el.fallbackURL :
      el.url && el.url.startsWith("http") ? el.url : null;

      if (!url) {
        
        return null;
    }
        
    if (url.startsWith("//")) url = "https:" + url;
    
        
        const finalUrl = `${url}?auth=${encodeURIComponent(auth)}`;
      
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

  if (hasItalianAudioA && !hasItalianAudioB) return -1;
  if (!hasItalianAudioA && hasItalianAudioB) return 1;

  return qualityOrder.indexOf(qualityA) - qualityOrder.indexOf(qualityB);
});
  
streams.forEach(stream => {});
cache.data[id] = streams;
  return res.send({ streams });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`working on ${process.env.PORT || 3000}`);
});

module.exports = app;
