import { Request, Response, NextFunction } from "express";

// Force HTTPS in production
export const forceHTTPS = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "production" && !req.secure && req.get("x-forwarded-proto") !== "https") {
    return res.redirect(301, `https://${req.get("host")}${req.url}`);
  }
  next();
};

// Security headers
export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  // HSTS - Force HTTPS for 1 year
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // XSS Protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"
  );

  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  next();
};

// CORS configuration
export const getCORSOptions = () => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [
        "http://localhost:19006", // Expo web dev
        "http://localhost:8081",  // Expo dev
        "exp://",                 // Expo Go
        "https://your-app-domain.com" // Production (change this)
      ];

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin starts with allowed patterns (for Expo Go)
      const isAllowed = allowedOrigins.some(
        (allowed) => origin === allowed || origin.startsWith(allowed)
      );

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`Blocked CORS request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true
  };
};
