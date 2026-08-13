import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Remove the scratch directories the test files created.
 *
 * This runs in the main process once every worker has finished, which is the only
 * point where it can succeed: the directories are made inside workers that Vitest
 * terminates without running exit handlers, and on Windows the SQLite file is
 * still open until the worker is gone.
 */
export function teardown(): void {
  const tmp = os.tmpdir();
  const prefixes = [
    'family-cinema-tests-',
    'family-cinema-render-',
    'family-cinema-startup-',
    'family-cinema-empty-',
  ];

  let removed = 0;
  for (const entry of fs.readdirSync(tmp)) {
    if (!prefixes.some((prefix) => entry.startsWith(prefix))) continue;
    try {
      fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
      removed += 1;
    } catch {
      // A lingering handle is not worth failing the run over; the OS clears temp.
    }
  }

  if (removed > 0) {
    console.log(`\ncleaned up ${removed} test scratch director${removed === 1 ? 'y' : 'ies'}`);
  }
}
