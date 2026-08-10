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
      name: 'Parakeet — S&P 500',
      description:
        'Watchlist app for the S&P 500. Selectable return ' +
        'window, risk-adjusted ranking, per-ticker charts.',
    },
    code,
    dependencies: DEPENDENCIES,
  };

  // Snack ids are random and may start or end with `_` or `-`. A trailing one
  // is routinely swallowed when the link is auto-linked in a message or chat
  // app, and the shortened id 404s with "we couldn't find the Snack". A
  // *leading* one is worse: the client builds the experience name by joining
  // the sdk version to the id with a hyphen, so `-Abc` becomes
  // `sdk.57.0.0--Abc` and the double separator is one more thing between the
  // link and the app. Publishing is cheap, so keep drawing until both ends of
  // the id are alphanumeric.
  let hashId;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://exp.host/--/api/v2/snack/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Snack save failed: HTTP ${res.status} ${await res.text()}`);
    }
    ({ hashId } = await res.json());
    if (/^[A-Za-z0-9].*[A-Za-z0-9]$/.test(hashId)) break;
    console.log(`  id "${hashId}" starts or ends in punctuation; republishing`);
    if (attempt >= 10) throw new Error('could not get a paste-safe snack id');
  }

  const size = (JSON.stringify(payload).length / 1024).toFixed(0);
  console.log(`  published ${files.length} files (${size} KB), SDK ${SDK}`);
  console.log(`\n  https://snack.expo.dev/${hashId}\n`);
  console.log('  Open that on a phone and choose "Open in Expo Go".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
