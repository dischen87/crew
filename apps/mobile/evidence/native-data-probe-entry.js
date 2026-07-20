import 'react-native-get-random-values';

import { migrate, migrations } from '@crew/mobile-data';
import React, { useEffect, useState } from 'react';
import {
  AppRegistry,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getOrCreateDatabaseKey } from '../src/storage/databaseKey';
import { openAccountDatabase } from '../src/storage/opSqliteAdapter';

const accountId = `usr_${'a'.repeat(32)}`;

function NativeDataProbeApp() {
  const [result, setResult] = useState({ status: 'running' });

  useEffect(() => {
    runProbe().then(setResult, error =>
      setResult({ error: probeError(error), status: 'fail' }),
    );
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>
        CREW NEXT · {Platform.OS.toUpperCase()} NATIVE PROBE
      </Text>
      <Text style={styles.title}>
        {result.status === 'running' ? 'Running…' : result.status.toUpperCase()}
      </Text>
      <View style={styles.card}>
        <Text selectable style={styles.result}>
          {JSON.stringify(result, null, 2)}
        </Text>
      </View>
    </ScrollView>
  );
}

function probeError(error) {
  if (!(error instanceof Error)) return 'unknown';
  return `${error.name}: ${error.message}`.slice(0, 240);
}

async function runProbe() {
  const key = await getOrCreateDatabaseKey(accountId);
  let database = openAccountDatabase(accountId, key);

  await migrate(database);
  await database.exec(`
CREATE TABLE IF NOT EXISTS native_data_probe (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL
);
DELETE FROM native_data_probe;
`);
  await database.run('INSERT INTO native_data_probe (value) VALUES (?)', [
    'restart',
  ]);
  await database.close();

  database = openAccountDatabase(accountId, key);
  const restart = await database.first(
    'SELECT value FROM native_data_probe WHERE value = ?',
    ['restart'],
  );

  let rollbackThrown = false;
  try {
    await database.transaction(async transaction => {
      await transaction.run(
        'INSERT INTO native_data_probe (value) VALUES (?)',
        ['rollback'],
      );
      throw new Error('rollback probe');
    });
  } catch {
    rollbackThrown = true;
  }
  const rollback = await database.first(
    "SELECT COUNT(*) AS count FROM native_data_probe WHERE value = 'rollback'",
  );

  await Promise.all([
    database.transaction(transaction =>
      transaction.run('INSERT INTO native_data_probe (value) VALUES (?)', [
        'first',
      ]),
    ),
    database.transaction(transaction =>
      transaction.run('INSERT INTO native_data_probe (value) VALUES (?)', [
        'second',
      ]),
    ),
  ]);
  const orderedRows = await database.all(
    "SELECT value FROM native_data_probe WHERE value IN ('first', 'second') ORDER BY sequence",
  );
  const migrationRow = await database.first(
    'SELECT COUNT(*) AS count FROM schema_migrations',
  );
  await database.close();

  const wrongKeyRejected = await rejectsWrongKey(key);
  database = openAccountDatabase(accountId, key);
  const finalRead = await database.first(
    'SELECT value FROM native_data_probe WHERE value = ?',
    ['restart'],
  );
  await database.close();

  const result = {
    finalReadAfterWrongKey: finalRead?.value === 'restart',
    migrationCount: Number(migrationRow?.count ?? 0),
    ordered: orderedRows.map(row => row.value).join(','),
    restartValue: restart?.value ?? null,
    rollbackCount: Number(rollback?.count ?? -1),
    rollbackThrown,
    status: 'pass',
    wrongKeyRejected,
  };
  if (
    !result.finalReadAfterWrongKey ||
    result.migrationCount !== migrations.length ||
    result.ordered !== 'first,second' ||
    result.restartValue !== 'restart' ||
    result.rollbackCount !== 0 ||
    !result.rollbackThrown ||
    !result.wrongKeyRejected
  ) {
    result.status = 'fail';
  }
  return result;
}

async function rejectsWrongKey(correctKey) {
  const wrongKey =
    correctKey === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
  let database;
  try {
    database = openAccountDatabase(accountId, wrongKey);
    await database.first('SELECT COUNT(*) AS count FROM schema_migrations');
    return false;
  } catch {
    return true;
  } finally {
    if (database) {
      try {
        await database.close();
      } catch {
        // An invalid SQLCipher key can also reject close after failed open.
      }
    }
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#2d2d2d',
    borderRadius: 16,
    borderWidth: 3,
    padding: 16,
  },
  eyebrow: {
    color: '#2d2d2d',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  result: {
    color: '#2d2d2d',
    fontFamily: 'monospace',
    fontSize: 15,
    lineHeight: 22,
  },
  screen: {
    backgroundColor: '#f5d565',
    flexGrow: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#2d2d2d',
    fontSize: 34,
    fontWeight: '900',
  },
});

AppRegistry.registerComponent('CrewNext', () => NativeDataProbeApp);
