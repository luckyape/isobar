import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("/api/observations", async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const start = typeof req.query.start === "string" ? req.query.start : undefined;
    const end = typeof req.query.end === "string" ? req.query.end : undefined;
    const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;
    const apiKey = process.env.METEOSTAT_API_KEY || process.env.RAPIDAPI_KEY;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: "Missing or invalid lat/lon" });
      return;
    }

    if (!apiKey) {
      res.status(503).json({ error: "Meteostat API key missing" });
      return;
    }

    try {
      const url = new URL("https://meteostat.p.rapidapi.com/point/hourly");
      url.searchParams.set("lat", lat.toString());
      url.searchParams.set("lon", lon.toString());
      url.searchParams.set("units", "metric");
      if (start) url.searchParams.set("start", start);
      if (end) url.searchParams.set("end", end);
      if (tz) url.searchParams.set("tz", tz);

      const response = await fetch(url.toString(), {
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "meteostat.p.rapidapi.com"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).send(errorText);
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Observations proxy failed:", error);
      res.status(502).json({ error: "Failed to fetch observations" });
    }
  });

  app.get("/api/eccc/location", async (req, res) => {
    const coords = typeof req.query.coords === "string" ? req.query.coords : "";
    if (!coords) {
      res.status(400).json({ error: "Missing coords" });
      return;
    }

    try {
      const url = new URL("https://weather.gc.ca/en/location/index.html");
      url.searchParams.set("coords", coords);

      const headers: Record<string, string> = {};
      const ifNoneMatch = req.header("if-none-match");
      const ifModifiedSince = req.header("if-modified-since");
      if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
      if (ifModifiedSince) headers["If-Modified-Since"] = ifModifiedSince;

      const response = await fetch(url.toString(), { headers, redirect: "follow" });
      res.status(response.status);

      const contentType = response.headers.get("content-type");
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      const cacheControl = response.headers.get("cache-control");

      if (contentType) res.setHeader("content-type", contentType);
      if (etag) res.setHeader("etag", etag);
      if (lastModified) res.setHeader("last-modified", lastModified);
      if (cacheControl) res.setHeader("cache-control", cacheControl);

      if (response.status === 304) {
        res.end();
        return;
      }

      const body = await response.text();
      res.send(body);
    } catch (error) {
      console.error("ECCC location proxy failed:", error);
      res.status(502).json({ error: "Failed to fetch ECCC location" });
    }
  });

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.warn(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
