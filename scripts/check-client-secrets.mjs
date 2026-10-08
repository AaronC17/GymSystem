import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(process.argv[2] || 'dist');
let fileEnv = {};
try {
  fileEnv = parseEnv(await readFile('.env', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('No fue posible leer la configuracion local para comprobar el build.');
}

const candidates = [];
for (const env of [process.env, fileEnv]) {
  for (const name of ['MONGODB_URI', 'SESSION_SECRET']) {
    const value = env[name];
    if (value && value !== '[SENSITIVE]' && value.length >= 8) candidates.push({ name, value });
    if (name === 'MONGODB_URI' && value) {
      try {
        const password = new URL(value).password;
        for (const secret of [password, decodeURIComponent(password)]) {
          if (secret && secret.length >= 8) candidates.push({ name: 'MongoDB password', value: secret });
        }
      } catch {
        // Invalid connection strings are handled by the API, never printed here.
      }
    }
  }
}

async function scan(directory) {
  const findings = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) findings.push(...await scan(path));
    else if (entry.isFile()) {
      const content = await readFile(path, 'utf8');
      for (const { name, value } of candidates) {
        if (content.includes(value)) findings.push(`${name}: ${relative(root, path)}`);
      }
    }
  }
  return findings;
}

try {
  const findings = [...new Set(await scan(root))];
  if (findings.length) {
    console.error('El build contiene credenciales de servidor. No publicar estos archivos.');
    for (const finding of findings) console.error(finding);
    process.exitCode = 1;
  } else {
    console.log(candidates.length
      ? 'Build comprobado: no incluye las credenciales de MongoDB ni el secreto de sesion configurados.'
      : 'Build comprobado sin credenciales locales; esta verificacion no reemplaza un escaner general de secretos.');
  }
} catch {
  console.error('No fue posible comprobar el directorio de build. Ejecuta vite build primero.');
  process.exitCode = 1;
}
