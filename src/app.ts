/**
 * The HTTP side: reports come in on /ingest, probes ask /health.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Report } from './format.ts';

export interface AppOptions {
  /** Clients send it in X-Errorbot-Key. */
  ingestKey: string;
  onReport: (body: Report) => void;
  environment: string;
}

/** Keys are compared as hashes, so the check takes as long whatever the key's length or contents. */
const digest = (value: string) => createHash('sha256').update(value).digest();

export function createApp({ ingestKey, onReport, environment }: AppOptions) {
  const ingestKeyDigest = digest(ingestKey);

  const verifyIngestAuth = (req: Request, res: Response, next: NextFunction) => {
    const providedKey = req.get('X-Errorbot-Key') ?? '';
    if (!timingSafeEqual(digest(providedKey), ingestKeyDigest)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    return next();
  };

  const handleIngest = (req: Request, res: Response) => {
    //Reply to the http request to close it
    res.send("OK");

    //Log everything to ourselves
    console.log(req.body);

    //Relay to admin chat: grouped, paced, retried (relay.ts)
    onReport(req.body ?? {});
  };

  const app = express();
  app.use(express.json());

  app.post('/ingest', verifyIngestAuth, handleIngest);

  app.get('/health', (_: Request, res: Response) => {
    res.json({ ok: true, environment });
  });

  return app;
}
