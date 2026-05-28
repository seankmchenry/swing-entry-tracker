// public/index.js

// 1. CONFIGURATION LOADER
const firebaseConfig = window.APP_CONFIG.firebaseConfig;
const POLYGON_API_KEY = window.APP_CONFIG.polygonApiKey;
const TURNSTILE_SITEKEY = window.APP_CONFIG.turnstileSiteKey;

// Initialize Firebase Engine Instance
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let unsubscribeWatchlist = null;
let turnstileWidgetId = null; // Track programmatic widget instances securely

// INTERFACE THEME HANDLER
window.toggleTheme = function() {
  const isLight = document.body.classList.toggle("light-mode");
  const btn = document.getElementById("themeBtn");

  if (isLight) {
    btn.innerText = "🌙 Dark Mode";
    localStorage.setItem("theme", "light");
  } else {
    btn.innerText = "☀️ Light Mode";
    localStorage.setItem("theme", "dark");
  }
}

// HELPER FUNCTION TO FORMAT MARKET CAP VALUATIONS CLEANLY
function formatMarketCap(num) {
  if (!num || isNaN(num) || num <= 0) return "N/A";
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
}

// 2. REAL-TIME WATCHLIST SNAPSHOT STREAM
window.updateWatchlistListener = function() {
  if (unsubscribeWatchlist) {
    unsubscribeWatchlist();
  }

  const sortVal = document.getElementById("sortSelect").value;
  const [field, direction] = sortVal.split("-");

  unsubscribeWatchlist = db.collection("watchlists")
    .orderBy(field, direction)
    .onSnapshot((snapshot) => {
      const tbody = document.getElementById("watchlistBody");

      // Wipe structural table clean before drawing mutations to prevent ghosts
      tbody.innerHTML = "";

      if (snapshot.empty) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-gray-500 italic">No tickers added yet. Enter a symbol above to run the math engine.</td></tr>`;
        return;
      }

      snapshot.forEach((doc) => {
        const data = doc.data();

        const isReady = data.percentToEntry >= 0;
        const badgeClass = isReady
          ? "bg-emerald-800 text-emerald-400 border border-emerald-800"
          : "bg-amber-900 text-amber-400 border border-amber-800";
        const badgeText = isReady ? "In Entry Zone" : `${data.percentToEntry}% to Top`;

        const horizonText = data.lookbackDays === 25 ? "🔥 25d Momentum" : "📊 90d Macro";
        const horizonClass = data.lookbackDays === 25 ? "text-amber-400 font-bold" : "text-gray-400";

        // Process dynamic text strings for market cap column display
        const marketCapDisplay = formatMarketCap(data.marketCap);

        const rowHtml = `
          <tr class="hover:bg-gray-850/50 transition-colors">
            <td class="px-6 py-4 whitespace-nowrap font-mono font-bold text-lg text-white">${data.ticker}</td>
            <td class="px-6 py-4 whitespace-nowrap text-gray-300 font-mono">$${data.currentPrice.toFixed(2)}</td>
            <td class="px-6 py-4 whitespace-nowrap font-mono text-emerald-400 font-semibold bg-emerald-800/10">$${data.supportBaseMin.toFixed(2)} – $${data.supportBaseMax.toFixed(2)}</td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span class="px-2.5 py-1 text-xs font-semibold rounded-full ${badgeClass}">${badgeText}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
              Set alert below <strong class="text-white font-mono bg-gray-950 px-2 py-1 rounded border border-gray-800">$${data.supportBaseMax.toFixed(2)}</strong>
            </td>
            <td class="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-300">${marketCapDisplay}</td>
            <td class="px-6 py-4 whitespace-nowrap text-xs ${horizonClass}">${horizonText}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
              <button onclick="handleDeleteTicker('${data.ticker}')" class="text-gray-500 hover:text-red-400 font-semibold text-sm transition-colors px-3 py-1 rounded hover:bg-red-950/20">
                Delete
              </button>
            </td>
          </tr>
        `;
        tbody.innerHTML += rowHtml;
      });
    }, (error) => {
      console.error("Firestore transaction sync failed: ", error);
    });
}

// RUNTIME ENGINE INITIALIZATION BLOCK
function startupWorkspaceEngine() {
  const input = document.getElementById("tickerInput");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCalculateLocal();
      }
    });
  }

  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-mode");
    document.getElementById("themeBtn").innerText = "🌙 Dark Mode";
  }

  // Hardened programmatic loading fallback engine for Cloudflare
  let retryCount = 0;
  function tryRenderTurnstile() {
    if (window.turnstile && typeof turnstile.render === "function") {
      if (!TURNSTILE_SITEKEY) {
        console.warn("Turnstile Error: sitekey parameter is blank in config.js");
        return;
      }

      try {
        turnstileWidgetId = turnstile.render("#turnstile-container", {
          sitekey: TURNSTILE_SITEKEY
        });
        console.log("Cloudflare Turnstile security perimeter successfully armed.");
      } catch (renderErr) {
        console.error("Turnstile explicit injection failed:", renderErr);
      }
    } else if (retryCount < 10) {
      retryCount++;
      setTimeout(tryRenderTurnstile, 250);
    } else {
      console.error("Turnstile Error: Cloudflare API script timed out and failed to load.");
    }
  }

  tryRenderTurnstile();
  window.updateWatchlistListener();
}

// SELF-CHECKING INVOKER: Runs layout data arrays instantly
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startupWorkspaceEngine);
} else {
  startupWorkspaceEngine();
}

// 3. CORE VOLUMETRIC MATH ENGINE
window.handleCalculateLocal = async function() {
  const input = document.getElementById("tickerInput");
  const btn = document.getElementById("submitBtn");
  const hotSectorMode = document.getElementById("hotSectorToggle").checked;
  const ticker = input.value.trim().toUpperCase();

  if (!ticker) return;

  // LOCAL ENVIRONMENT CONDITIONAL DETECTOR
  const isLocalhost = window.location.hostname === "localhost" ||
                        window.location.hostname === "127.0.0.1";

  // CLOUDFLARE TURNSTILE SECURITY GUARD GATING LAYER
  if (window.turnstile && turnstileWidgetId !== null) {
    const turnstileToken = turnstile.getResponse(turnstileWidgetId);

    // If we are on localhost, skip the token check. Otherwise, enforce it strictly!
    if (isLocalhost) {
      console.log("Local Environment Detected: Bypassing Cloudflare Turnstile verification shield.");
    } else if (!turnstileToken) {
      alert("Security Alert: Threat telemetry validation unfulfilled. Submission blocked.");
      return;
    } else {
      console.log("Telemetry check fulfilled. Verification Hash:", turnstileToken);
    }
  }

  btn.disabled = true;
  btn.innerText = "Analyzing...";
  btn.classList.add("opacity-50", "cursor-not-allowed");

  const lookbackDays = hotSectorMode ? 25 : 90;

  try {
    const endDate = new Date().toISOString().split("T")[0];
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - lookbackDays);
    const startDate = startDateObj.toISOString().split("T")[0];

    // Fetch Stable Unrestricted Candle Aggregates
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.results || result.results.length === 0) {
      throw new Error(`No historical ticker results found for: ${ticker}`);
    }

    const candles = result.results;
    const currentPrice = candles[candles.length - 1].c;
    const priceFloorCutoff = currentPrice * 0.70;

    // PHASE 2: Unrestricted Multiplier Engine
    let marketCap = 0;
    try {
      const detailUrl = `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_API_KEY}`;
      const detailResponse = await fetch(detailUrl);
      const detailResult = await detailResponse.json();

      if (detailResult.results) {
        // Fall back through the raw corporate share structures allowed on the free tier
        const shares = detailResult.results.weighted_shares_outstanding ||
                       detailResult.results.share_class_shares_outstanding;

        if (shares && shares > 0) {
          marketCap = shares * currentPrice;
        }
      }
    } catch (snapErr) {
      console.warn("Market Cap calculation bypassed:", snapErr);
    }

    const binSize = 0.50;
    const volumeBins = {};

    candles.forEach(candle => {
      const avgPrice = (candle.h + candle.l + candle.c) / 3;

      if (avgPrice >= priceFloorCutoff) {
        const binnedPrice = Math.floor(avgPrice / binSize) * binSize;
        if (!volumeBins[binnedPrice]) volumeBins[binnedPrice] = 0;
        volumeBins[binnedPrice] += candle.v;
      }
    });

    let highestVolumeBin = 0;
    let maxVolume = 0;

    Object.keys(volumeBins).forEach(bin => {
      if (volumeBins[bin] > maxVolume) {
        maxVolume = volumeBins[bin];
        highestVolumeBin = parseFloat(bin);
      }
    });

    if (highestVolumeBin === 0) {
      candles.forEach(candle => {
        const avgPrice = (candle.h + candle.l + candle.c) / 3;
        const binnedPrice = Math.floor(avgPrice / binSize) * binSize;
        if (!volumeBins[binnedPrice]) volumeBins[binnedPrice] = 0;
        volumeBins[binnedPrice] += candle.v;
      });
      Object.keys(volumeBins).forEach(bin => {
        if (volumeBins[bin] > maxVolume) {
          maxVolume = volumeBins[bin];
          highestVolumeBin = parseFloat(bin);
        }
      });
    }

    const supportBaseMin = highestVolumeBin;
    const supportBaseMax = highestVolumeBin + binSize;
    const percentToEntry = parseFloat((((supportBaseMax - currentPrice) / currentPrice) * 100).toFixed(1));

    const payload = {
      ticker,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      supportBaseMin: parseFloat(supportBaseMin.toFixed(2)),
      supportBaseMax: parseFloat(supportBaseMax.toFixed(2)),
      percentToEntry,
      lookbackDays,
      marketCap: (marketCap && marketCap > 0) ? marketCap : 0,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("watchlists").doc(ticker).set(payload);
    input.value = "";

    if (window.turnstile && turnstileWidgetId !== null) {
      turnstile.reset(turnstileWidgetId);
    }

  } catch (error) {
    alert("Engine Processing Error: " + error.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Add Ticker";
    btn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

// 4. ABSOLUTE HARD DELETION
window.handleDeleteTicker = async function(ticker) {
  if (!confirm(`Are you sure you want to remove ${ticker} from your dashboard?`)) return;

  try {
    await db.collection("watchlists").doc(ticker).delete();
  } catch (error) {
    alert("Error deleting ticker: " + error.message);
  }
}
