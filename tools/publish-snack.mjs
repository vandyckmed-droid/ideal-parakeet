// Publish snack/ to Expo Snack and print the link.
//
// Anonymous publishing needs no Expo account, so this works from anywhere.
// Each run mints a *new* snack id rather than updating the old one; paste the
// new link wherever the previous one was shared.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'snack';
const SDK = '57.0.0';

// Snack resolves these itself, but pinning them keeps the runtime in step with
// the versions the native app is built against.
const DEPENDENCIES = {
  'react-native-svg': { version: '15.15.4' },
  '@react-native-async-storage/async-storage': { version: '2.2.0' },
  'expo-haptics': { version: '~57.0.1' },
};

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
  if (!files.includes('App.js')) {
    throw new Error(`${DIR}/App.js is required as the Snack entry point`);
  }

  const code = {};
  for (const f of files) {
    code[f] = { contents: readFileSync(join(DIR, f), 'utf8'), type: 'CODE' };
  }

  const payload = {
    manifest: {
      sdkVersion: SDK,
      name: 'Parakeet — 500 US equities',
      description:
        'Watchlist app for the 500 largest US-traded equities. Selectable return ' +
        'window, risk-adjusted ranking, per-ticker charts.',
    },
    code,
    dependencies: DEPENDENCIES,
  };

  const res = await fetch('https://exp.host/--/api/v2/snack/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Snack save failed: HTTP ${res.status} ${await res.text()}`);
  }

  const { hashId } = await res.json();
  const size = (JSON.stringify(payload).length / 1024).toFixed(0);
  console.log(`  published ${files.length} files (${size} KB), SDK ${SDK}`);
  console.log(`\n  https://snack.expo.dev/${hashId}\n`);
  console.log('  Open that on a phone and choose "Open in Expo Go".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
