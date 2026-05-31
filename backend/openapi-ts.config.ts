import { defineConfig } from '@hey-api/openapi-ts';

const outputPath =
  process.env.GC_SUPERVISOR_HEY_API_OUTPUT ??
  './backend/src/generated/gc-supervisor-client';

export default defineConfig({
  input: './backend/openapi/gc-supervisor.openapi.json',
  output: {
    path: outputPath,
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      bundle: false,
    },
    '@hey-api/typescript',
    {
      name: '@hey-api/sdk',
      validator: {
        request: false,
        response: 'zod',
      },
    },
    {
      name: 'zod',
      requests: false,
      responses: true,
    },
  ],
});
