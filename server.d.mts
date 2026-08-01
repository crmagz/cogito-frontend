import type { Express } from "express";

export function createRelay(options: {
  upstreamUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs?: number;
}): Express;

export function createDevelopmentServer(options: {
  upstreamUrl: string;
  token: string;
  staticDirectory?: string;
  healthcheck?: boolean;
  environment?: string;
  upstreamTimeoutMs?: number;
}): Express;

export function createSessionRelay(options: {
  sessionRelayUrl: string;
  readinessUrl?: string;
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs?: number;
}): Express;

export function createProductionServer(options: {
  sessionRelayUrl: string;
  readinessUrl?: string;
  staticDirectory: string;
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs?: number;
}): Express;

export function startServer(app: Express, options?: {
  port?: number | string;
  host?: string;
  shutdownTimeoutMs?: number;
}): import("node:http").Server;
