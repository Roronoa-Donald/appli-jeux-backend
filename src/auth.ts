import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_IN_PRODUCTION";
const JWT_EXPIRES_IN = "7d";

export type JWTPayload = {
  user_id: string;
  display_name: string;
};

export type AuthRequest = Request & {
  user?: JWTPayload;
};

// Generate JWT token
export const generateToken = (user_id: string, display_name: string): string => {
  return jwt.sign({ user_id, display_name }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

// Verify JWT token
export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
};

// Hash password
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10);
};

// Compare password
export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// Auth middleware - optional (sets user if token present)
export const optionalAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      req.user = verifyToken(token);
    } catch {
      // Token invalid but continue (optional auth)
    }
  }

  next();
};

// Auth middleware - required
export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.substring(7);

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
};

// Check ownership - user can only access their own resources
export const checkOwnership = (userIdField: string = "user_id") => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const resourceUserId =
      req.body[userIdField] ||
      req.query[userIdField] ||
      req.params[userIdField];

    if (resourceUserId && resourceUserId !== req.user.user_id) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    next();
  };
};
