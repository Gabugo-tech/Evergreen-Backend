/**
 * Python analytics proxy — forwards authenticated requests to the internal
 * Python microservice, injecting X-Internal-Secret so the Python service
 * rejects any direct calls that bypass this gateway.
 *
 * All routes: /api/analytics/* and /api/investments/* are proxied here.
 */
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

const PYTHON_URL      = (process.env.PYTHON_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

async function proxy(req: Request, res: Response, basePath: string) {
  const target = `${PYTHON_URL}${basePath}${req.path === "/" ? "" : req.path}${
    req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""
  }`;

  const headers: Record<string, string> = {
    "Content-Type":      "application/json",
    "Authorization":     req.headers.authorization ?? "",
    "X-Internal-Secret": INTERNAL_SECRET,
  };

  const options: RequestInit = {
    method:  req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    options.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(target, options);
    const json     = await upstream.json().catch(() => ({ success: false, message: "Upstream error" }));
    res.status(upstream.status).json(json);
  } catch {
    res.status(503).json({ success: false, message: "Analytics service unavailable" });
  }
}

router.all("/analytics*", (req, res) => proxy(req, res, "/api/analytics"));
router.all("/investments*", (req, res) => proxy(req, res, "/api/investments"));

export default router;
