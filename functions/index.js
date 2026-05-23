const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");

// Initialize Firebase Admin SDK to communicate with Firestore
admin.initializeApp();
const db = admin.firestore();

// Replace this with your actual free Polygon.io API key
const POLYGON_API_KEY = "YOUR_POLYGON_API_KEY";

/**
 * Cloud Function to calculate the structural support base for a ticker.
 * Expects a query parameter or JSON body: { "ticker": "CIFR" }
 */
exports.calculateSupportBase = onRequest({ cors: true }, async (req, res) => {
  try {
    const ticker = (req.query.ticker || req.body.ticker || "").toUpperCase();

    if (!ticker) {
      return res.status(400).json({ error: "Missing 'ticker' parameter." });
    }

    // 1. Calculate date window: Last 90 days
    const endDate = new Date().toISOString().split("T")[0];
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - 90);
    const startDate = startDateObj.toISOString().split("T")[0];

    logger.info(`Fetching data for ${ticker} from ${startDate} to ${endDate}`);

    // 2. Query Polygon.io Daily Aggregates API
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`;
    const response = await axios.get(url);

    if (!response.data || !response.data.results || response.data.results.length === 0) {
      return res.status(404).json({ error: `No historical data found for ticker: ${ticker}` });
    }

    const candles = response.data.results; // Array of candle objects: { c: close, v: volume, h: high, l: low }
    const currentPrice = candles[candles.length - 1].c;

    // 3. Math Engine: Volume Profile Clustering to find the Structural Base
    // We group prices into $0.50 bins to find out where the heavy institutional accumulation happened.
    const binSize = 0.50;
    const volumeBins = {};

    candles.forEach(candle => {
      const avgPrice = (candle.h + candle.l + candle.c) / 3;
      const binnedPrice = Math.floor(avgPrice / binSize) * binSize;

      if (!volumeBins[binnedPrice]) {
        volumeBins[binnedPrice] = 0;
      }
      volumeBins[binnedPrice] += candle.v; // Aggregate volume for this price level
    });

    // Find the price bin with the absolute maximum accumulated volume (Point of Control)
    let highestVolumeBin = 0;
    let maxVolume = 0;

    Object.keys(volumeBins).forEach(bin => {
      if (volumeBins[bin] > maxVolume) {
        maxVolume = volumeBins[bin];
        highestVolumeBin = parseFloat(bin);
      }
    });

    // Define the structural support floor boundary around that high-volume cluster
    const supportBaseMin = highestVolumeBin;
    const supportBaseMax = highestVolumeBin + binSize;

    // Calculate how far away current price is from the top of our entry floor
    const percentToEntry = parseFloat((((supportBaseMax - currentPrice) / currentPrice) * 100).toFixed(1));

    const payload = {
      ticker,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      supportBaseMin: parseFloat(supportBaseMin.toFixed(2)),
      supportBaseMax: parseFloat(supportBaseMax.toFixed(2)),
      percentToEntry,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    // 4. Save/Update the structural layout in Firestore
    await db.collection("watchlists").doc(ticker).set(payload, { merge: true });

    logger.info(`Successfully processed ${ticker}. Base: $${supportBaseMin}-$${supportBaseMax}`);

    return res.status(200).json({ success: true, data: payload });

  } catch (error) {
    logger.error("Error calculating support base:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
