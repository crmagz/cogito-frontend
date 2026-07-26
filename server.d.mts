import type { Express } from "express";

export function createRelay(options: {
  upstreamUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Express;
