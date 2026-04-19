import bcrypt from "bcryptjs";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

const BCRYPT_COST = 12;

export interface JwtPayload {
  userId: string;
  email: string;
}

function getJwtSecret(): Secret {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set and at least 16 characters");
  }
  return secret;
}

function getJwtExpiresIn(): SignOptions["expiresIn"] {
  return (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string, email: string): string {
  const payload: JwtPayload = { userId, email };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: getJwtExpiresIn() });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as JwtPayload).userId !== "string" ||
    typeof (decoded as JwtPayload).email !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  const { userId, email } = decoded as JwtPayload;
  return { userId, email };
}
