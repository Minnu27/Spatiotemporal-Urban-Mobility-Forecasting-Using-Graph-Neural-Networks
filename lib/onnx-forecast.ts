import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { z } from 'zod';
import { tripHorizons } from './horizons';
import type { Forecast } from './types';

const metadataSchema = z.object({
  model: z.string().min(1),
  horizons: z.tuple([z.literal(1), z.literal(3), z.literal(6), z.literal(12), z.literal(24)]),
  zones: z.array(z.object({ id: z.number().int().min(1).max(263) })).length(263),
  history_hours: z.number().int().positive(),
  context_columns: z.array(z.string()).min(1),
});
const exampleSchema = z.object({
  origin: z.iso.datetime({ offset: true }),
  demand: z.array(z.array(z.number().nonnegative().finite())),
  context: z.array(z.array(z.number().finite())),
});

let cached: Promise<Forecast> | undefined;
const modelDirectory = join(process.cwd(), 'model');

async function runHistoricalForecast(): Promise<Forecast> {
  const encoded = process.env.COLAB_HISTORICAL_INPUT_GZIP;
  if (!encoded) throw new Error('Historical input is not configured');
  const exampleText = gunzipSync(Buffer.from(encoded, 'base64'), {
    maxOutputLength: 1024 * 1024,
  }).toString('utf8');
  const metadataText = await readFile(join(modelDirectory, 'metadata.json'), 'utf8');
  const metadata = metadataSchema.parse(JSON.parse(metadataText));
  const example = exampleSchema.parse(JSON.parse(exampleText));
  if (new Set(metadata.zones.map(zone => zone.id)).size !== metadata.zones.length) {
    throw new Error('Duplicate model zone IDs');
  }
  const tensor = (values: number[][], columns: number) => {
    if (values.length !== metadata.history_hours || values.some(row => row.length !== columns)) {
      throw new Error('Historical inputs do not match model dimensions');
    }
    return new Tensor('float32', Float32Array.from(values.flat()), [1, metadata.history_hours, columns]);
  };
  const demand = tensor(example.demand, metadata.zones.length);
  const context = tensor(example.context, metadata.context_columns.length);
  const session = await InferenceSession.create(join(modelDirectory, 'forecast.onnx'), {
    executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1,
  });
  try {
    const { pickups } = await session.run({ demand, context });
    if (!pickups || pickups.dims.join(',') !== `1,${tripHorizons.length},${metadata.zones.length}` ||
        !(pickups.data instanceof Float32Array)) {
      throw new Error('Unexpected forecast tensor dimensions or type');
    }
    const values = pickups.data;
    if (values.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('Invalid model forecast');
    }
    return {
      mode: 'historical',
      model: metadata.model,
      issuedAt: example.origin,
      historySource: 'Held-out 2025 NYC TLC pickup and context observations',
      rows: metadata.horizons.flatMap((horizon, index) => metadata.zones.map((zone, column) => ({
        zoneId: zone.id, horizon, value: values[index * metadata.zones.length + column],
      }))),
      message: 'Replay of a held-out observation window from the Colab export.',
    };
  } finally {
    await session.release();
  }
}

export function getHistoricalForecast() {
  cached ??= runHistoricalForecast().catch(error => {
    cached = undefined;
    throw error;
  });
  return cached;
}
