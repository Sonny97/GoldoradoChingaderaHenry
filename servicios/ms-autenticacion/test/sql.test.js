/**
 * Pruebas ESTATICAS de los scripts SQL (sin SQL Server): lo que se puede
 * romper sin que nadie lo note hasta el dia de la sustentacion.
 *   - el partidor de lotes deja cada GO fuera,
 *   - ninguna restriccion queda sin nombre,
 *   - los hashes del seed corresponden a las claves documentadas,
 *   - la consulta del login de 03_consultas.sql es la MISMA del repositorio.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { partirEnLotes } from '../db/setup.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8');
const sinComentarios = (sql) => sql.replace(/--.*$/gm, '');
const compacto = (texto) => texto.replace(/\s+/g, ' ').trim();

test('partirEnLotes: ningun lote conserva un GO', () => {
  for (const archivo of ['db/01_esquema.sql', 'db/02_datos.sql', 'db/03_consultas.sql']) {
    const lotes = partirEnLotes(leer(archivo));
    assert.ok(lotes.length > 3, `${archivo} deberia tener varios lotes`);
    for (const lote of lotes) assert.doesNotMatch(lote, /^\s*GO\s*$/im, `${archivo}: GO dentro de un lote`);
  }
  assert.deepEqual(partirEnLotes('SELECT 1\ngo  -- fin\n-- solo comentario\nGO\nSELECT 2'), ['SELECT 1', 'SELECT 2']);
});

test('01_esquema.sql: toda restriccion tiene nombre con su prefijo', () => {
  const lineas = sinComentarios(leer('db/01_esquema.sql')).split('\n');
  const palabra = /\b(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|DEFAULT)\b/;
  const nombrada = /CONSTRAINT\s+(PK|FK|UQ|CHK|DF)_\w+\s+(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|DEFAULT)\b/;

  const anonimas = lineas.filter(
    (linea) => palabra.test(linea) && !/^\s*CREATE\b/.test(linea) && !nombrada.test(linea)
  );
  assert.deepEqual(anonimas, [], 'restricciones sin CONSTRAINT <PREFIJO>_<nombre>');

  const indices = [...leer('db/01_esquema.sql').matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:NON)?CLUSTERED\s+INDEX\s+(\w+)/g)].map(
    (m) => m[1]
  );
  assert.ok(indices.length >= 4);
  for (const nombre of indices) assert.match(nombre, /^(IX|UQ)_/);
});

test('02_datos.sql: los hashes bcrypt son de las claves documentadas (CONVENCIONES §5)', async () => {
  const datos = leer('db/02_datos.sql');
  const hashes = [...datos.matchAll(/'(\$2a\$10\$[./A-Za-z0-9]{53})'/g)].map((m) => m[1]);
  assert.equal(hashes.length, 5, '3 claves + 2 codigos de recuperacion');

  const [demo, vale, admin, otp1, otp2] = hashes;
  assert.ok(await bcrypt.compare('Demo1234!', demo));
  assert.ok(await bcrypt.compare('Vale2024*', vale));
  assert.ok(await bcrypt.compare('Admin2026#', admin));
  assert.ok(await bcrypt.compare('482913', otp1));
  assert.ok(await bcrypt.compare('482913', otp2));
});

test('03_consultas.sql: la consulta del login es EXACTAMENTE la del repositorio', () => {
  const repo = leer('src/repositorios/usuarioRepo.js');
  const selectPerfil = repo.match(/const SELECT_PERFIL = `([\s\S]*?)`;/)[1];
  const filtro = repo.match(/\$\{SELECT_PERFIL\}\s*([\s\S]*?)`\);/)[1];
  const consultaLogin = compacto(`${selectPerfil} ${filtro}`);

  assert.match(consultaLogin, /WHERE u\.email = @email OR c\.numero_documento = @documento$/);
  assert.ok(
    compacto(sinComentarios(leer('db/03_consultas.sql'))).includes(consultaLogin),
    '03_consultas.sql debe traer la consulta del login tal como la corre usuarioRepo.buscarPorIdentificador()'
  );
});
