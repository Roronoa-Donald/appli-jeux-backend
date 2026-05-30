import cors from "cors";
import crypto from "crypto";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { pool } from "./db";
import {
  generateToken,
  hashPassword,
  comparePassword,
  requireAuth,
  optionalAuth,
  checkOwnership,
  AuthRequest
} from "./auth";
import { forceHTTPS, securityHeaders, getCORSOptions } from "./security";

const app = express();
const port = Number(process.env.PORT || 3001);

app.set("trust proxy", 1);

// Security middleware (first)
app.use(forceHTTPS);
app.use(securityHeaders);
app.use(cors(getCORSOptions()));
app.use(express.json({ limit: "1mb" }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const { method, url } = req;
  const body = Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : "empty";
  console.log(`[${timestamp}] ${method} ${url} | Body: ${body}`);
  next();
});

// Global rate limit (by IP for unauthenticated)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: AuthRequest) => {
      // Use user_id for authenticated users, IP for others
      return req.user?.user_id
        ? `user:${req.user.user_id}`
        : ipKeyGenerator(req.ip || "0.0.0.0");
    }
  })
);

// Strict rate limit for auth endpoints (prevent brute force)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

const asyncHandler =
  (
    handler: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => Promise<void>
  ) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res, next).catch(next);
  };

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isValidTimestamp = (value: string) => !Number.isNaN(Date.parse(value));

const parseNonNegativeNumber = (value: unknown) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

type AdminUserRow = {
  user_id: string;
  name: string;
  answered_count: number | string;
  last_session_id: string | null;
};

app.post(
  "/auth/identify",
  asyncHandler(async (req, res) => {
    const { display_name } = req.body || {};

    if (!isNonEmptyString(display_name)) {
      res.status(400).json({ error: "missing_display_name" });
      return;
    }

    const normalizedName = display_name.trim();

    // Search for exactly one user with this name to avoid collisions
    const { rows } = await pool.query(
      "SELECT user_id FROM users WHERE display_name = $1",
      [normalizedName]
    );

    let userId: string;
    if (rows.length === 1) {
      userId = rows[0].user_id;
    } else {
      // Create a new user if no user or multiple users have this name
      userId = `user-${crypto.randomUUID()}`;
      await pool.query(
        "INSERT INTO users (user_id, display_name) VALUES ($1, $2)",
        [userId, normalizedName]
      );
    }

    const token = generateToken(userId, normalizedName);

    res.json({
      user_id: userId,
      display_name: normalizedName,
      token
    });
  })
);

// Auth endpoints
app.post(
  "/auth/register",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password, display_name } = req.body || {};

    if (
      !isNonEmptyString(email) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(display_name)
    ) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "password_too_short" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userId = `user-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const passwordHash = await hashPassword(password);

    try {
      await pool.query(
        "INSERT INTO users (user_id, display_name, email, password_hash) VALUES ($1, $2, $3, $4)",
        [userId, display_name.trim(), normalizedEmail, passwordHash]
      );

      const token = generateToken(userId, display_name.trim());

      res.status(201).json({
        user_id: userId,
        display_name: display_name.trim(),
        email: normalizedEmail,
        token
      });
    } catch (error: any) {
      if (error.code === "23505") {
        // Unique violation
        res.status(409).json({ error: "email_exists" });
      } else {
        throw error;
      }
    }
  })
);

app.post(
  "/auth/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await pool.query(
      "SELECT user_id, display_name, password_hash FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const user = rows[0];
    const isValid = await comparePassword(password, user.password_hash);

    if (!isValid) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const token = generateToken(user.user_id, user.display_name);

    res.json({
      user_id: user.user_id,
      display_name: user.display_name,
      email: normalizedEmail,
      token
    });
  })
);

app.post(
  "/sessions",
  requireAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const { person_name, session_id, started_at, total_active_ms } =
      req.body || {};
    const userId = req.user!.user_id;

    if (
      !isNonEmptyString(person_name) ||
      !isNonEmptyString(session_id) ||
      !isNonEmptyString(started_at)
    ) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    const normalizedStartedAt = started_at.trim();
    if (!isValidTimestamp(normalizedStartedAt)) {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }
    const totalActiveMs = parseNonNegativeNumber(total_active_ms);
    if (total_active_ms !== undefined && totalActiveMs === null) {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }

    const normalizedPersonName = person_name.trim();
    const normalizedSessionId = session_id.trim();
    const initialActiveMs = totalActiveMs ?? 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users (user_id, display_name) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name",
        [userId, normalizedPersonName]
      );
      await client.query(
        "INSERT INTO sessions (session_id, user_id, started_at, total_active_ms) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id) DO UPDATE SET user_id = EXCLUDED.user_id, started_at = EXCLUDED.started_at, total_active_ms = GREATEST(sessions.total_active_ms, EXCLUDED.total_active_ms)",
        [
          normalizedSessionId,
          userId,
          normalizedStartedAt,
          initialActiveMs
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ session_id: normalizedSessionId });
  })
);

app.get(
  "/users/:id/last-session",
  optionalAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.params.id;
    if (!isNonEmptyString(userId)) {
      res.status(400).json({ error: "missing_user_id" });
      return;
    }

    const { rows } = await pool.query(
      "SELECT s.* FROM sessions s WHERE s.user_id = $1 ORDER BY s.started_at DESC LIMIT 1",
      [userId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "no_session_found" });
      return;
    }

    res.json(rows[0]);
  })
);

app.get(
  "/sessions/:id",
  optionalAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = req.params.id;
    const { rows } = await pool.query(
      "SELECT session_id, user_id, started_at, ended_at, total_active_ms FROM sessions WHERE session_id = $1",
      [sessionId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json(rows[0]);
  })
);

app.get(
  "/progress",
  optionalAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) {
      res.status(400).json({ error: "missing_session_id" });
      return;
    }

    const { rows } = await pool.query(
      "SELECT s.session_id, COALESCE(SUM(CASE WHEN a.skipped THEN 0 ELSE 1 END), 0) AS answered_count, MAX(s.total_active_ms) AS total_active_ms FROM sessions s LEFT JOIN answers a ON a.session_id = s.session_id WHERE s.session_id = $1 GROUP BY s.session_id",
      [sessionId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      answered_count: toNumber(rows[0].answered_count),
      total_active_ms: toNumber(rows[0].total_active_ms)
    });
  })
);

// Batch answers endpoint
app.post(
  "/answers/batch",
  requireAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const { answers } = req.body || {};
    const userId = req.user!.user_id;

    if (!Array.isArray(answers) || answers.length === 0) {
      res.status(400).json({ error: "missing_answers" });
      return;
    }

    if (answers.length > 100) {
      res.status(400).json({ error: "too_many_answers" });
      return;
    }

    const results: { successful_ids: string[]; failed_count: number } = {
      successful_ids: [],
      failed_count: 0
    };

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const answer of answers) {
        try {
          const {
            reponse_id,
            session_id,
            question_id,
            selected_option,
            free_text,
            reponse,
            timestamp,
            skipped,
            total_active_ms
          } = answer;

          if (!reponse_id || !session_id || !question_id) {
            results.failed_count++;
            continue;
          }

          // Validate session ownership
          const sessionCheck = await client.query(
            "SELECT 1 FROM sessions WHERE session_id = $1 AND user_id = $2",
            [session_id, userId]
          );
          if (sessionCheck.rows.length === 0) {
            results.failed_count++;
            continue;
          }

          const freeTextValue = typeof free_text === "string" ? free_text : "";
          if (freeTextValue.length > 200) {
            results.failed_count++;
            continue;
          }

          // Get question details for verification if needed, but we rely on the questions table
          // Insert answer (Normalized: no section_id, question_text, or reponse)
          await client.query(
            "INSERT INTO answers (reponse_id, user_id, session_id, question_id, selected_option, free_text, skipped, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (reponse_id) DO NOTHING",
            [
              reponse_id,
              userId,
              session_id,
              question_id,
              selected_option || null,
              freeTextValue,
              Boolean(skipped),
              timestamp
            ]
          );

          if (total_active_ms !== undefined && total_active_ms !== null) {
            const totalActiveMs = parseNonNegativeNumber(total_active_ms);
            if (totalActiveMs !== null) {
              await client.query(
                "UPDATE sessions SET total_active_ms = GREATEST(total_active_ms, $1) WHERE session_id = $2",
                [totalActiveMs, session_id]
              );
            }
          }

          results.successful_ids.push(reponse_id);
        } catch {
          results.failed++;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json(results);
  })
);

app.post(
  "/answers",
  requireAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const {
      reponse_id,
      session_id,
      question_id,
      selected_option,
      free_text,
      timestamp,
      skipped,
      total_active_ms
    } = req.body || {};
    const userId = req.user!.user_id;

    if (
      !isNonEmptyString(reponse_id) ||
      !isNonEmptyString(session_id) ||
      !isNonEmptyString(question_id) ||
      !isNonEmptyString(timestamp)
    ) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }

    const normalizedTimestamp = timestamp.trim();
    if (!isValidTimestamp(normalizedTimestamp)) {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }

    if (
      selected_option !== undefined &&
      selected_option !== null &&
      typeof selected_option !== "string"
    ) {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }
    if (free_text !== undefined && free_text !== null && typeof free_text !== "string") {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }
    if (skipped !== undefined && typeof skipped !== "boolean") {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }

    const normalizedReponseId = reponse_id.trim();
    const normalizedSessionId = session_id.trim();
    const normalizedQuestionId = question_id.trim();
    const freeTextValue = typeof free_text === "string" ? free_text : "";
    const selectedOptionValue =
      typeof selected_option === "string" ? selected_option : null;
    const skippedValue = Boolean(skipped);
    const totalActiveMs = parseNonNegativeNumber(total_active_ms);
    if (total_active_ms !== undefined && totalActiveMs === null) {
      res.status(400).json({ error: "invalid_fields" });
      return;
    }

    if (freeTextValue.length > 200) {
      res.status(400).json({ error: "free_text_too_long" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Validate session ownership
      const sessionCheck = await client.query(
        "SELECT 1 FROM sessions WHERE session_id = $1 AND user_id = $2",
        [normalizedSessionId, userId]
      );
      if (sessionCheck.rows.length === 0) {
        res.status(403).json({ error: "session_not_owned" });
        await client.query("ROLLBACK");
        return;
      }

      await client.query(
        "INSERT INTO answers (reponse_id, user_id, session_id, question_id, selected_option, free_text, skipped, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (reponse_id) DO NOTHING",
        [
          normalizedReponseId,
          userId,
          normalizedSessionId,
          normalizedQuestionId,
          selectedOptionValue,
          freeTextValue,
          skippedValue,
          normalizedTimestamp
        ]
      );
      if (totalActiveMs !== null) {
        await client.query(
          "UPDATE sessions SET total_active_ms = GREATEST(total_active_ms, $1) WHERE session_id = $2",
          [totalActiveMs, normalizedSessionId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  })
);

app.get(
  "/recap",
  optionalAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const sessionId = String(req.query.session_id || "");
    const limit = Math.min(toNumber(req.query.limit) || 200, 500);
    const offset = Math.max(toNumber(req.query.offset) || 0, 0);

    if (!sessionId) {
      res.status(400).json({ error: "missing_session_id" });
      return;
    }

    const { rows } = await pool.query(
      "SELECT reponse_id, user_id, session_id, question_id, section_id, question_text, reponse, selected_option, free_text, skipped, timestamp FROM answers WHERE session_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3",
      [sessionId, limit, offset]
    );

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM answers WHERE session_id = $1",
      [sessionId]
    );

    res.json({
      answers: rows,
      total: toNumber(countResult.rows[0].count),
      limit,
      offset
    });
  })
);

app.get(
  "/admin/users",
  requireAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const limit = Math.min(toNumber(req.query.limit) || 50, 200);
    const offset = Math.max(toNumber(req.query.offset) || 0, 0);
    const search = String(req.query.search || "").trim();

    let query = `
      SELECT u.user_id, u.display_name AS name,
        COALESCE(COUNT(a.*) FILTER (WHERE a.skipped = false), 0) AS answered_count,
        (SELECT s.session_id FROM sessions s WHERE s.user_id = u.user_id ORDER BY s.started_at DESC LIMIT 1) AS last_session_id
      FROM users u
      LEFT JOIN answers a ON a.user_id = u.user_id
    `;

    const params: (string | number)[] = [];

    if (search) {
      query += ` WHERE u.display_name ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY u.user_id, u.display_name ORDER BY u.display_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    const countQuery = search
      ? "SELECT COUNT(*) FROM users WHERE display_name ILIKE $1"
      : "SELECT COUNT(*) FROM users";
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      users: (rows as AdminUserRow[]).map((row) => ({
        ...row,
        answered_count: toNumber(row.answered_count)
      })),
      total: toNumber(countResult.rows[0].count),
      limit,
      offset
    });
  })
);

app.get(
  "/admin/users/:id/questions",
  requireAuth as any,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.params.id;
    const { rows } = await pool.query(
      "SELECT DISTINCT a.question_id, COALESCE(a.question_text, q.question_text) AS question_text FROM answers a LEFT JOIN questions q ON q.question_id = a.question_id WHERE a.user_id = $1 ORDER BY a.question_id",
      [userId]
    );

    res.json(rows);
  })
);

app.post(
  "/admin/pairings",
    requireAuth as any,
    asyncHandler(async (req: AuthRequest, res) => {
      const { user_id_a, user_id_b, session_id } = req.body || {};
      if (!isNonEmptyString(user_id_a) || !isNonEmptyString(user_id_b)) {
        res.status(400).json({ error: "missing_fields" });
        return;
      }
      if (
        session_id !== undefined &&
        session_id !== null &&
        !isNonEmptyString(session_id)
      ) {
        res.status(400).json({ error: "invalid_fields" });
        return;
      }

      const normalizedUserA = user_id_a.trim();
      const normalizedUserB = user_id_b.trim();
      const normalizedSessionId = isNonEmptyString(session_id)
        ? session_id.trim()
        : null;

      if (normalizedUserA === normalizedUserB) {
        res.status(400).json({ error: "cannot_pair_same_user" });
        return;
      }

    const pairingId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pair-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

      await pool.query(
        "INSERT INTO pairings (pairing_id, user_id_a, user_id_b, session_id) VALUES ($1, $2, $3, $4)",
        [pairingId, normalizedUserA, normalizedUserB, normalizedSessionId]
      );

    res.status(201).json({ pairing_id: pairingId });
  })
);

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "server_error" });
});

app.listen(port, () => {
  console.log(`RD Reponses backend running on ${port}`);
});
