import type { Express } from "express";

export function createRelay(options: {
  upstreamUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Express;

export function createDevelopmentServer(options: {
  upstreamUrl: string;
  token: string;
  staticDirectory?: string;
  healthcheck?: boolean;
  environment?: string;
}): Express;

export function createSessionRelay(options: {
  sessionRelayUrl: string;
  fetchImpl?: typeof fetch;
}): Express;

export function createProductionServer(options: {
  sessionRelayUrl: string;
  staticDirectory: string;
  fetchImpl?: typeof fetch;
}): Express;
